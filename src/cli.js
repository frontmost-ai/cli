// frontmost <command>: read the arguments, send one API request, print the reply.
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { apiKey, baseUrl, checkKey, KEYS_URL, projectSetting, removeKey, saveKey } from "./config.js";
import { ApiError, UsageError } from "./errors.js";
import { commandHelp, group, overview, usage } from "./help.js";
import { request } from "./http.js";
import { clean, render } from "./output.js";
import { commands, GLOBALS, VERSION } from "./spec.js";

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
 * @property {boolean} tty True when stdout is a terminal.
 * @property {number} [width]
 */

/** @returns {Io} */
function realIo() {
  const { stdin, stdout, stderr } = process;
  const readStdin = async () => {
    let text = "";
    for await (const chunk of stdin) text += chunk;
    return text;
  };
  return {
    env: process.env,
    cwd: process.cwd(),
    fetch,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    out: (text) => stdout.write(`${text}\n`),
    note: (text) => stderr.write(`${text}\n`),
    readStdin,
    readSecret: () => (stdin.isTTY ? promptSecret() : readStdin()),
    tty: Boolean(stdout.isTTY),
    width: stdout.columns,
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
    const reason = e instanceof Error ? e.message.split(". ")[0].replace(/\.$/, "") : "Wrong arguments";
    throw new UsageError(`${reason}. Run "frontmost --help" to see the commands.`);
  }
}

/**
 * Run the CLI. Returns the exit code: 0 success, 1 API or network error, 2 wrong command.
 * @param {string[]} argv @param {Io} [io]
 */
export async function run(argv, io = realIo()) {
  try {
    await main(argv, io);
    return 0;
  } catch (e) {
    if (!(e instanceof ApiError || e instanceof UsageError)) throw e;
    const wrongCommand = e instanceof UsageError;
    if (argv.includes("--json")) {
      const body = e instanceof ApiError && e.body ? e.body : { error: { code: wrongCommand ? "usage" : "network", message: e.message } };
      io.note(JSON.stringify(body, null, 2));
    } else {
      io.note(`Error: ${clean(e.message)}`);
      if (e instanceof ApiError && e.code) io.note(clean(`Code: ${e.code}${e.requestId ? `. Request ID: ${e.requestId}` : ""}`));
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
  if (!positionals.length) return io.out(overview());

  const two = positionals.slice(0, 2).join(" ");
  const name = commandHelp(two) !== null && positionals.length > 1 ? two : positionals[0];
  const args = positionals.slice(name === two ? 2 : 1);
  const help = commandHelp(name);
  if (help === null) {
    const choices = group(name);
    if (choices && values.help) return io.out(choices);
    throw new UsageError(choices ? `"frontmost ${name}" needs one more word:\n${choices}` : `"${name}" is not a command. Run "frontmost --help" to see the commands.`);
  }
  if (values.help) return io.out(help);

  if (name === "logout") return io.note(`Signed out. Removed ${removeKey(io.env)}.`);
  if (name === "login") return login(values, io);
  const client = { base: baseUrl(io.env), key: apiKey({ flag: str(values["api-key"]), ...io }), fetch: io.fetch, sleep: io.sleep };
  if (name === "api") return api(client, args, values, io);
  return execute(client, /** @type {import("./spec.js").Command} */ (commands.get(name)), args, values, io);
}

/** @param {unknown} v */
const str = (v) => (typeof v === "string" ? v : undefined);

/** @param {Record<string, unknown>} values @param {Io} io */
async function login(values, io) {
  const key = checkKey((str(values["api-key"]) ?? (await io.readSecret())).trim());
  const { body } = await request({ base: baseUrl(io.env), key, fetch: io.fetch, sleep: io.sleep }, "GET", "/workspace");
  const file = saveKey(io.env, key);
  io.note(clean(`Signed in to ${body.name}. Key saved to ${file}.`));
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
  const [method, path] = args.length === 1 ? ["GET", args[0]] : [args[0]?.toUpperCase(), args[1]];
  if (args.length > 2 || !METHODS.has(method) || !path?.startsWith("/")) throw new UsageError('Use: frontmost api [METHOD] <path>. The path starts with /, for example "/projects?limit=5".');
  const key = str(values["idempotency-key"]);
  const body = values.body === undefined ? undefined : await readBody(str(values.body), io);
  const reply = await request(client, method, path, { body, headers: key ? { "Idempotency-Key": key } : {} });
  if (reply.body !== null) io.out(JSON.stringify(reply.body, null, 2));
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
    if (!flag) throw wrong(`--${name} is not an option of this command.`);
    const target = flag.in === "query" ? query : flag.in === "item" ? item : body;
    /** @type {Record<string, unknown>} */ (target)[flag.key] = convert(flag, value);
  }

  // Arguments
  /** @type {Record<string, string>} */ const ids = {};
  for (const arg of cmd.args) {
    const value = rest.shift();
    if (value === undefined) throw wrong(`Missing <${arg.replaceAll("_", "-")}>.`);
    ids[arg] = value;
  }
  if (cmd.inProject) ids.id = (cmd.path === "/projects/{id}" && rest.shift()) || (await projectId(client, values, io));
  if (body && cmd.positional && rest.length) {
    const { field, list } = cmd.positional;
    if (list) body[list] = rest.splice(0).map((text) => ({ [field]: text, ...item }));
    else body[field] = rest.shift();
  }
  if (rest.length) throw wrong(`"${rest[0]}" is one argument too many.`);
  if (body) {
    Object.assign(body, cmd.preset);
    const missing = cmd.required.filter((k) => !(k in body));
    if (missing.length) throw wrong(`Missing ${missing.join(", ")}.`);
    if (!Object.keys(body).length) throw wrong("Nothing to send. Add at least one option.");
  }

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

/** @param {any} body @param {boolean} json @param {Io} io */
function show(body, json, io) {
  if (body === null) return json ? undefined : io.note("Done.");
  if (json) return io.out(JSON.stringify(body, null, 2));
  const text = render(body, io);
  if (text) io.out(text);
  if (body.message) io.note(clean(body.message));
  else if (!text) io.note("No results.");
  if (body.has_more) io.note(`More results. Add --all, or --cursor ${clean(body.next_cursor)} for the next page.`);
}
