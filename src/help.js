// Help text, made from the same command list that runs the commands.
import { KEYS_URL } from "./config.js";
import { commands, GLOBALS } from "./spec.js";
import { PLAIN } from "./style.js";

const DOCS_URL = "https://app.frontmost.ai/docs/api.md";

const ACCOUNT = /** @type {Record<string, { usage: string, summary: string, more?: string }>} */ ({
  login: {
    usage: "login",
    summary: "Sign in with your browser",
    more: `Your browser opens. Sign in there, and the CLI is ready. The sign-in stays on this computer until "frontmost logout".

Options
  --no-browser  Sign in with a code. For a computer with no browser, such as one that you reach over SSH
  --with-key    Save an API key in place of a browser sign-in. Paste the key when asked, or pipe it in
                Create a key at ${KEYS_URL}`,
  },
  logout: { usage: "logout", summary: "Sign out on this computer" },
  api: {
    usage: "api [METHOD] <path>",
    summary: "Call any API route",
    more: 'The method is GET when you leave it out. The output is always JSON.\nThe path is the part after /api/v1. Add --body \'<json>\' to send data.\nExample: frontmost api "/projects?limit=5"',
  },
});

/** @param {import("./spec.js").Command} c */
export function usage(c) {
  const ownProject = c.path === "/projects/{id}";
  const parts = [c.name, ...c.args.map((a) => `<${a.replaceAll("_", "-")}>`), ownProject ? "[project-id]" : "", c.positional?.label ?? ""];
  return parts.filter(Boolean).join(" ");
}

/** @param {[string, string][]} rows @param {import("./style.js").Style} [s] @param {number} [pad] The width of the left column. */
function columns(rows, s = PLAIN, pad = Math.max(...rows.map(([left]) => left.length))) {
  return rows.map(([left, right]) => (right ? `  ${left.padEnd(pad)}  ${s.dim(right)}` : `  ${left}`)).join("\n");
}

/** @param {string[]} names @returns {[string, string][]} */
const globalRows = (names) => names.map((n) => [n === "wait" ? "--no-wait" : `--${n}${GLOBALS[/** @type {keyof typeof GLOBALS} */ (n)].type === "string" ? " <value>" : ""}`, GLOBALS[/** @type {keyof typeof GLOBALS} */ (n)].description]);
/** @param {string[]} names @param {import("./style.js").Style} [s] */
const globals = (names, s = PLAIN) => columns(globalRows(names), s);

/** @param {import("./style.js").Style} [s] On a terminal: the logo, bold headings, and gray descriptions. */
export function overview(s = PLAIN) {
  const all = [...commands.values()];
  const nouns = [...new Set(all.map((c) => c.name.split(" ")[0]))];
  /** @param {import("./spec.js").Command} c */
  const order = (c) => nouns.indexOf(c.name.split(" ")[0]);
  /** Commands of one noun stay together. @param {(c: import("./spec.js").Command) => boolean} keep @returns {[string, string][]} */
  const rows = (keep) => all.filter(keep).sort((a, b) => order(a) - order(b)).map((c) => [usage(c), c.summary]);
  /** @type {[string, string][]} */
  const account = Object.values(ACCOUNT).map((a) => [a.usage, a.summary]);
  const sections = { read: rows((c) => c.method === "GET"), change: rows((c) => c.method !== "GET"), account, options: globalRows(["json", "project", "all", "help", "version"]) };
  // One left column for every section, so that all descriptions start at the same place.
  const pad = Math.max(...Object.values(sections).flat().map(([left]) => left.length));
  /** @param {[string, string][]} list */
  const col = (list) => columns(list, s, pad);
  const h = s.bold;
  return `${s.on ? `${s.logo()}  ` : ""}See how AI apps answer your buyers' questions.

${h("Usage")}
  frontmost <command> [options]

${h("Read")}
${col(sections.read)}

${h("Change")}
${col(sections.change)}

${h("Account")}
${col(sections.account)}

${h("Options")}
${col(sections.options)}

${h("Sign in")}
  Run "frontmost login". Your browser opens, and you sign in there.
  For scripts and CI, create an API key at ${KEYS_URL} and set FRONTMOST_API_KEY.

${h("AI agents and scripts")}
  Add --json to every command. With no sign-in, ask the person to run "frontmost login".
  Exit code 0 is success. 1 is an API or network error. 2 is a wrong command.
  Run "frontmost <command> --help" to see the options of one command.
  API reference: ${DOCS_URL}`;
}

/** @param {import("./spec.js").Flag} f */
function flagRow(f) {
  const left = f.type === "boolean" ? `--${f.name}, --no-${f.name}` : `--${f.name} <${f.enum ? f.enum.join("|") : f.type === "integer" ? "number" : "text"}>`;
  const notes = [f.description, f.default === undefined ? "" : `Default: ${f.default}`, f.nullable && f.in === "body" ? 'Use "" to clear it' : ""];
  return /** @type {[string, string]} */ ([left, notes.filter(Boolean).join(". ")]);
}

/** Help for one command, or null when the name is not a command. @param {string} name @param {import("./style.js").Style} [s] */
export function commandHelp(name, s = PLAIN) {
  const account = ACCOUNT[name];
  if (account) return `${account.summary}\n\n${s.bold("Usage")}\n  frontmost ${account.usage}${account.more ? `\n\n${account.more.replace(/^Options$/m, s.bold("Options"))}` : ""}`;
  const c = commands.get(name);
  if (!c) return null;
  const own = [...c.flags.values()].map(flagRow);
  const shared = ["json", c.inProject && "project", c.isList && "all", c.hasBody && "body", c.retryKey && "idempotency-key", c.retryKey && "wait", "api-key"];
  return [
    c.summary,
    `${s.bold("Usage")}\n  frontmost ${usage(c)}${own.length ? " [options]" : ""}`,
    own.length ? `${s.bold("Options")}\n${columns(own, s)}` : "",
    `${s.bold("Other options")}\n${globals(/** @type {string[]} */ (shared.filter(Boolean)), s)}`,
  ].filter(Boolean).join("\n\n");
}

/** The commands that start with one word, for "frontmost profiles" when the word alone is not a command. @param {string} noun @param {import("./style.js").Style} [s] */
export function group(noun, s = PLAIN) {
  const rows = [...commands.values()].filter((c) => c.name.startsWith(`${noun} `)).map((c) => /** @type {[string, string]} */ ([usage(c), c.summary]));
  return rows.length ? columns(rows, s) : null;
}

/**
 * The one choice that starts with the word, else the choice closest to it, or null when none is close.
 * @param {string} word @param {Iterable<string>} choices
 */
export function nearest(word, choices) {
  /** @param {string} a @param {string} b */
  const distance = (a, b) => {
    let row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row = next;
    }
    return row[b.length];
  };
  const starts = [...choices].filter((c) => c.startsWith(word));
  if (starts.length === 1) return starts[0];
  const [best] = [...choices].map((c) => /** @type {const} */ ([c, distance(word, c)])).sort((a, b) => a[1] - b[1]);
  return best && best[1] <= Math.max(1, Math.floor(word.length / 3)) ? best[0] : null;
}

/** The first word of every command. */
export const firstWords = () => new Set([...Object.keys(ACCOUNT), ...[...commands.keys()].map((n) => n.split(" ")[0])]);
