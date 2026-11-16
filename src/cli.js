// frontmost <command>: read the arguments, send one API request, print the reply.
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { apiKey, baseUrl, checkKey, KEYS_URL, projectSetting, readSignIn, removeKey, saveKey, saveSignIn } from "./config.js";
import { ApiError, UsageError } from "./errors.js";
import { commandHelp, firstWords, group, nearest, overview, usage } from "./help.js";
import { home, welcome } from "./home.js";
import { request } from "./http.js";
import { accessToken, openBrowser, signIn } from "./oauth.js";
import { clean, json, render } from "./output.js";
import { commands, GLOBALS, OPTIONAL_ARGS, VERSION } from "./spec.js";
import { PLAIN, spinner, styleFor } from "./style.js";

const SETUP_LIMIT_MS = 10 * 60_000;
const METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);

/**
 * Everything the CLI touches outside itself. Tests replace it.
 * @typedef {object} Io
 * @property {import("./config.js").Env} env
 * @property {string} cwd
 * @property {typeof fetch} fetch
 * @property {(ms: number) => Promise<unknown>} sleep
 * @property {(text: string) => void} out Results. Goes to stdout.
 * @property {(text: string) => void} note Progress and errors. Goes to stderr.
 * @property {() => Promise<string>} readStdin
 * @property {() => Promise<string>} readSecret
 * @property {(url: string) => Promise<boolean>} open Opens a page in the browser. False when no browser can open.
 * @property {boolean} tty True when stdout is a terminal.
 * @property {number} [width]
 * @property {import("./style.js").Style} [style] For stdout. Plain when it is not a terminal.
 * @property {import("./style.js").Style} [noteStyle] For stderr.
 */

/** @param {boolean} quiet No moving dots, for --json. @returns {Io} */
function realIo(quiet) {
  const { stdin, stdout, stderr, env } = process;
  const noteStyle = styleFor(stderr, env);
  const spin = !quiet && stderr.isTTY && env.TERM !== "dumb" ? spinner(stderr, noteStyle) : null;
  const readStdin = async () => {
    let text = "";
    for await (const chunk of stdin) text += chunk;
    return text;
  };
  return {
    env,
    cwd: process.cwd(),
    fetch: spin ? (url, init) => spin.around(fetch(url, init)) : fetch,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    out: (text) => (spin?.clear(), stdout.write(`${text}\n`)),
    note: (text) => (spin?.clear(), stderr.write(`${text}\n`)),
    readStdin,
    readSecret: () => (stdin.isTTY ? promptSecret() : readStdin()),
    open: openBrowser,
    tty: Boolean(stdout.isTTY),
    width: stdout.columns,
    style: styleFor(stdout, env),
    noteStyle,
  };
}

/** Ask for the key without showing it on the screen. @returns {Promise<string>} */
function promptSecret() {
  const { stdin, stderr } = process;
  stderr.write(`Paste an API key from ${KEYS_URL}: `);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let text = "";
    /** @param {() => void} then */
    const stop = (then) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      stderr.write("\n");
      then();
    };
    /** @param {Buffer} chunk */
    const onData = (chunk) => {
      for (const ch of chunk.toString("utf8")) {
        if (ch === "\r" || ch === "\n") return stop(() => resolve(text));
        if (ch === "\u0003" || ch === "\u0004") return stop(() => reject(new UsageError("Stopped. No key was saved.")));
        text = ch === "\u007f" ? text.slice(0, -1) : text + ch;
      }
    };
    stdin.on("data", onData);
  });
}

/** One parser for all commands, so flags can go before or after the command words. */
const OPTIONS = /** @type {Record<string, { type: "string" | "boolean", short?: string }>} */ ({});
for (const c of commands.values()) for (const f of c.flags.values()) OPTIONS[f.name] = { type: f.type === "boolean" ? "boolean" : "string" };
for (const [name, g] of Object.entries(GLOBALS)) OPTIONS[name] = { type: g.type, ...("short" in g ? { short: g.short } : {}) };

/** @param {string[]} argv */
function parse(argv) {
  try {
    return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, allowNegative: true, strict: true });
  } catch (e) {
    const unknown = e instanceof Error && /^Unknown option '--([^']+)'/.exec(e.message)?.[1];
    const close = unknown && nearest(unknown.replace(/^no-/, ""), Object.keys(OPTIONS));
    if (unknown) throw new UsageError(`--${unknown} is not an option.${close ? ` Did you mean --${close}?` : ""} Run "frontmost --help" to see the commands.`);
    const reason = e instanceof Error ? e.message.split(". ")[0].replace(/\.$/, "") : "Wrong arguments";
    throw new UsageError(`${reason}. Run "frontmost --help" to see the commands.`);
  }
}

/**
 * Run the CLI. Returns the exit code: 0 success, 1 API or network error, 2 wrong command.
 * @param {string[]} argv @param {Io} [io]
 */
export async function run(argv, io = realIo(argv.includes("--json"))) {
  try {
    await main(argv, io);
    return 0;
  } catch (e) {
    if (!(e instanceof ApiError || e instanceof UsageError)) throw e;
    const wrongCommand = e instanceof UsageError;
    if (argv.includes("--json")) {
      const body = e instanceof ApiError && e.body ? e.body : { error: { code: wrongCommand ? "usage" : (e instanceof ApiError && e.code) || "network", message: e.message } };
      io.note(json(body));
    } else {
      const s = io.noteStyle ?? PLAIN;
      // On a terminal, the commands in a message stand out: Run "frontmost login" shows frontmost login in bold.
      const message = s.on ? clean(e.message).replace(/"(frontmost [^"]+)"/g, (_, c) => s.bold(c)) : clean(e.message);
      io.note(`${s.errorDot()} ${message}`);
      if (e instanceof ApiError && e.code) io.note(s.dim(clean(`Code: ${e.code}${e.requestId ? `. Request ID: ${e.requestId}` : ""}`)));
    }
    return wrongCommand ? 2 : 1;
  }
}

/** @param {string[]} argv @param {Io} io */
async function main(argv, io) {
  const { values, positionals } = parse(argv);
  if (values.version) return io.out(VERSION);
  if (positionals[0] === "help") {
    positionals.shift();
    values.help = true;
  }
  const s = io.style ?? PLAIN;
  if (!positionals.length) return values.help ? io.out(overview(s)) : start(values, io);

  const two = positionals.slice(0, 2).join(" ");
  const name = commandHelp(two) !== null && positionals.length > 1 ? two : positionals[0];
  const args = positionals.slice(name === two ? 2 : 1);
  const help = commandHelp(name, s);
  if (help === null) {
    const choices = group(name);
    if (choices && values.help) return io.out(group(name, s) ?? choices);
    if (choices) throw new UsageError(`"frontmost ${name}" needs one more word:\n${choices}`);
    const close = nearest(name, firstWords());
    throw new UsageError(`"${name}" is not a command. ${close ? `Did you mean "frontmost ${close}"?` : 'Run "frontmost --help" to see the commands.'}`);
  }
  if (values.help) return io.out(help);

  if (name === "logout") return logout(io);
  if (name === "login") return login(values, io);
  const client = signedIn(values, io);
  if (!client) throw new UsageError('Not signed in. Run "frontmost login", or set FRONTMOST_API_KEY.');
  if (name === "api") return api(client, args, values, io);
  return execute(client, /** @type {import("./spec.js").Command} */ (commands.get(name)), args, values, io);
}

/** The API client, or null when nothing is signed in. @param {Record<string, unknown>} values @param {Io} io */
function signedIn(values, io) {
  const key = apiKey({ flag: str(values["api-key"]), ...io });
  if (!key && !readSignIn(io.env)) return null;
  const base = baseUrl(io.env);
  return { base, token: key ? async () => key : accessToken(io, base), fetch: io.fetch, sleep: io.sleep };
}

/**
 * "frontmost" alone. A person at a terminal sees the latest scan, or a welcome before the first sign-in.
 * A script or an agent gets the help, as before.
 * @param {Record<string, unknown>} values @param {Io} io
 */
async function start(values, io) {
  const s = io.style ?? PLAIN;
  if (!io.tty || values.json) return io.out(overview(s));
  const client = signedIn(values, io);
  io.out(client ? await home(client, { ...io, project: str(values.project) }, s) : welcome(s));
}

/** @param {unknown} v */
const str = (v) => (typeof v === "string" ? v : undefined);

/** @param {Record<string, unknown>} values @param {Io} io */
async function login(values, io) {
  const base = baseUrl(io.env);
  /** The sign-in is saved only after the API accepts it. @param {string} token */
  const workspace = async (token) => (await request({ base, token: async () => token, fetch: io.fetch, sleep: io.sleep }, "GET", "/workspace")).body.name;

  const flag = str(values["api-key"]);
  if (flag || values["with-key"]) {
    const key = checkKey((flag ?? (await io.readSecret())).trim());
    const name = await workspace(key);
    return signedInNote(io, name, `Key saved to ${saveKey(io.env, key)}.`);
  }
  const saved = await signIn(io, base, { browser: values.browser !== false });
  const name = await workspace(saved.access_token);
  signedInNote(io, name, `Sign-in saved to ${saveSignIn(io.env, saved)}.`);
}

/** @param {Io} io @param {unknown} name @param {string} saved */
function signedInNote(io, name, saved) {
  const s = io.noteStyle ?? PLAIN;
  if (!s.on) return io.note(clean(`Signed in to ${name}. ${saved}`));
  io.note(`Signed in to ${s.bold(clean(name))}. ${s.dim(clean(saved))}\nRun ${s.bold("frontmost")} to see the latest scan.`);
}

/** @param {Io} io */
async function logout(io) {
  const removed = removeKey(io.env);
  io.note(removed ? `Signed out. Removed ${removed}.` : "No sign-in is saved on this computer.");
}

/** @param {string | undefined} raw @param {Io} io */
async function readBody(raw, io) {
  if (raw === undefined) return {};
  try {
    const body = JSON.parse(raw === "-" ? await io.readStdin() : raw);
    if (typeof body === "object" && body !== null && !Array.isArray(body)) return body;
  } catch {
    // Reported below.
  }
  throw new UsageError('--body must be a JSON object, for example --body \'{"name":"Acme"}\'.');
}

/** @param {import("./http.js").Client} client @param {string[]} args @param {Record<string, unknown>} values @param {Io} io */
async function api(client, args, values, io) {
  const [method, full] = args.length === 1 ? ["GET", args[0]] : [args[0]?.toUpperCase(), args[1]];
  // Docs show the full address, so a pasted "/api/v1/projects" works too.
  const path = full?.replace(/^\/api\/v1(?=[/?]|$)/, "") || "/";
  if (args.length > 2 || !METHODS.has(method) || !full?.startsWith("/")) throw new UsageError('Use: frontmost api [METHOD] <path>. The path starts with /, for example "/projects?limit=5".');
  const key = str(values["idempotency-key"]);
  const body = values.body === undefined ? undefined : await readBody(str(values.body), io);
  const reply = await request(client, method, path, { body, headers: key ? { "Idempotency-Key": key } : {} });
  if (reply.body !== null) io.out(json(reply.body));
}

/**
 * The value to send for one flag. Wrong values stop here, before any request.
 * @param {import("./spec.js").Flag} flag @param {string | boolean} value
 */
function convert(flag, value) {
  const query = flag.in === "query";
  if (flag.type === "boolean") return query ? String(value) : value;
  if (flag.type === "integer") {
    if (!/^\d+$/.test(String(value))) throw new UsageError(`--${flag.name} must be a whole number.`);
    return query ? value : Number(value);
  }
  if (flag.type === "list") {
    const items = String(value).split(",").map((v) => v.trim()).filter(Boolean);
    const wrong = flag.enum && items.find((v) => !flag.enum?.includes(v));
    if (!items.length || wrong) throw new UsageError(`--${flag.name} takes a comma-separated list${flag.enum ? ` of: ${flag.enum.join(", ")}` : ""}.`);
    return items;
  }
  if (flag.enum && !flag.enum.includes(String(value))) throw new UsageError(`--${flag.name} must be one of: ${flag.enum.join(", ")}.`);
  return value === "" && flag.nullable && !query ? null : value;
}

/** The project to use when a command needs one. @param {import("./http.js").Client} client @param {Record<string, unknown>} values @param {Io} io */
async function projectId(client, values, io) {
  const set = projectSetting({ flag: str(values.project), ...io });
  if (set) return set;
  const { body } = await request(client, "GET", "/projects", { query: { limit: "2" } });
  if (body.data.length === 1) return String(body.data[0].id);
  throw new UsageError(
    body.data.length
      ? 'This workspace has more than one project. Run "frontmost projects" to see the IDs, then add --project <id> or set FRONTMOST_PROJECT.'
      : 'This workspace has no project yet. Create one with "frontmost projects create <domain>".',
  );
}

/**
 * @param {import("./http.js").Client} client @param {import("./spec.js").Command} cmd
 * @param {string[]} args @param {Record<string, any>} values @param {Io} io
 */
async function execute(client, cmd, args, values, io) {
  const wrong = (/** @type {string} */ why) => new UsageError(`${why}\nUse: frontmost ${usage(cmd)}\nRun "frontmost ${cmd.name} --help" to see the options.`);
  const rest = [...args];

  // Flags
  /** @type {Record<string, string>} */ const query = {};
  /** @type {Record<string, unknown>} */ const item = {};
  if (values.body !== undefined && !cmd.hasBody) throw wrong("This command sends no body, so --body does not apply.");
  if (values.all && !cmd.isList) throw wrong("--all works only on lists.");
  const body = cmd.hasBody ? await readBody(values.body, io) : undefined;
  for (const [name, value] of Object.entries(values)) {
    if (name in GLOBALS) continue;
    const flag = cmd.flags.get(name);
    if (!flag) {
      const close = nearest(name, [...cmd.flags.keys()]);
      throw wrong(`--${name} is not an option of this command.${close ? ` Did you mean --${close}?` : ""}`);
    }
    const top = /** @type {Record<string, any>} */ (body);
    const target = flag.in === "query" ? query : flag.in === "item" ? item : flag.parent ? (top[flag.parent] ??= {}) : body;
    /** @type {Record<string, unknown>} */ (target)[flag.key] = convert(flag, value);
  }

  // Arguments
  /** @type {Record<string, string>} */ const ids = {};
  for (const arg of cmd.args) {
    const value = rest.shift() ?? OPTIONAL_ARGS[arg];
    if (value === undefined) throw wrong(`Missing <${arg.replaceAll("_", "-")}>.`);
    ids[arg] = value;
  }
  const named = cmd.path === "/projects/{id}" ? rest.shift() : undefined;
  if (body && cmd.positional && rest.length) {
    const { field, list } = cmd.positional;
    if (list) body[list] = rest.splice(0).map((text) => ({ [field]: text, ...item }));
    else body[field] = rest.shift();
  }
  if (rest.length) {
    const choices = group(cmd.name);
    throw choices ? new UsageError(`"frontmost ${cmd.name} ${rest[0]}" is not a command. The commands are:\n${choices}`) : wrong(`"${rest[0]}" is one argument too many.`);
  }
  if (body) {
    Object.assign(body, cmd.preset);
    const missing = cmd.required.filter((k) => !(k in body));
    if (missing.length) throw wrong(`Missing ${missing.join(", ")}.`);
    if (!Object.keys(body).length) throw wrong("Nothing to send. Add at least one option.");
  }
  // Last, because it can take a request: every other mistake is reported first.
  if (cmd.inProject) ids.id = named ?? (await projectId(client, values, io));

  const path = cmd.path.replace(/\{(\w+)\}/g, (_, param) => encodeURIComponent(ids[param]));
  const headers = cmd.retryKey && body && !body.setup_id ? { "Idempotency-Key": str(values["idempotency-key"]) ?? createHash("sha256").update(JSON.stringify(body)).digest("hex") } : undefined;
  if (values.all) query.limit ??= "100";
  let reply = await request(client, cmd.method, path, { query, body, headers });

  // A project setup takes a few minutes. The API says when to ask again.
  const deadline = Date.now() + SETUP_LIMIT_MS;
  let waited = false;
  while (reply.status === 202 && values.wait !== false) {
    const setup = reply.body;
    const again = `frontmost projects create --setup-id ${setup.id}`;
    if (Date.now() >= deadline) throw new ApiError(`The setup is still running. Run "${again}" in a few minutes to get the project.`);
    if (!waited) io.note(clean(`Setting up ${setup.domain}. This takes a few minutes. If you stop now, continue with "${again}".`));
    waited = true;
    await io.sleep((Number(setup.retry_after) || 30) * 1000);
    reply = await request(client, cmd.method, path, { body: setup.next?.body ?? { setup_id: setup.id } });
  }

  while (values.all && reply.body.has_more) {
    const next = await request(client, cmd.method, path, { query: { ...query, cursor: reply.body.next_cursor } });
    next.body.data.unshift(...reply.body.data);
    reply = next;
  }
  show(reply.body, values.json, io);
}

/** @param {any} body @param {boolean} asJson @param {Io} io */
function show(body, asJson, io) {
  if (body === null) return asJson ? undefined : io.note("Done.");
  if (asJson) return io.out(json(body));
  const text = render(body, io);
  if (text) io.out(text);
  if (body.message) io.note(clean(body.message));
  else if (!text) io.note("No results.");
  if (body.has_more) io.note(`More results. Add --all, or --cursor ${clean(body.next_cursor)} for the next page.`);
}
