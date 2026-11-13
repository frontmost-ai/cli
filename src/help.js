// Help text, made from the same command list that runs the commands.
import { KEYS_URL } from "./config.js";
import { commands, GLOBALS } from "./spec.js";

const DOCS_URL = "https://app.frontmost.ai/docs/api.md";

const ACCOUNT = /** @type {Record<string, { usage: string, summary: string, more?: string }>} */ ({
  login: { usage: "login", summary: "Save an API key on this computer", more: `Paste the key when asked, or pipe it in. Create a key at ${KEYS_URL}.` },
  logout: { usage: "logout", summary: "Remove the saved API key" },
  api: {
    usage: "api [METHOD] <path>",
    summary: "Call any API route",
    more: 'The method is GET when you leave it out. The output is always JSON.\nExample: frontmost api "/projects?limit=5"',
  },
});

/** @param {import("./spec.js").Command} c */
export function usage(c) {
  const ownProject = c.path === "/projects/{id}";
  const parts = [c.name, ...c.args.map((a) => `<${a.replaceAll("_", "-")}>`), ownProject ? "[project-id]" : "", c.positional?.label ?? ""];
  return parts.filter(Boolean).join(" ");
}

/** @param {[string, string][]} rows */
function columns(rows) {
  const pad = Math.max(...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(pad)}  ${right}`.trimEnd()).join("\n");
}

/** @param {string[]} names */
const globals = (names) => columns(names.map((n) => [n === "wait" ? "--no-wait" : `--${n}${GLOBALS[/** @type {keyof typeof GLOBALS} */ (n)].type === "string" ? " <value>" : ""}`, GLOBALS[/** @type {keyof typeof GLOBALS} */ (n)].description]));

export function overview() {
  const all = [...commands.values()];
  /** @param {(c: import("./spec.js").Command) => boolean} keep */
  const rows = (keep) => columns(all.filter(keep).map((c) => [usage(c), c.summary]));
  return `See how AI apps answer your buyers' questions.

Usage
  frontmost <command> [options]

Read
${rows((c) => c.method === "GET")}

Change
${rows((c) => c.method !== "GET")}

Account
${columns(Object.values(ACCOUNT).map((a) => [a.usage, a.summary]))}

Options
${globals(["json", "project", "all", "help", "version"])}

API key
  Create a key at ${KEYS_URL}.
  Then run "frontmost login", or set FRONTMOST_API_KEY.

AI agents and scripts
  Set FRONTMOST_API_KEY and add --json to every command.
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

/** Help for one command, or null when the name is not a command. @param {string} name */
export function commandHelp(name) {
  const account = ACCOUNT[name];
  if (account) return `${account.summary}\n\nUsage\n  frontmost ${account.usage}${account.more ? `\n\n${account.more}` : ""}`;
  const c = commands.get(name);
  if (!c) return null;
  const own = [...c.flags.values()].map(flagRow);
  const shared = ["json", c.inProject && "project", c.isList && "all", c.hasBody && "body", c.retryKey && "idempotency-key", c.retryKey && "wait", "api-key"];
  return [
    c.summary,
    `Usage\n  frontmost ${usage(c)}${own.length ? " [options]" : ""}`,
    own.length ? `Options\n${columns(own)}` : "",
    `Other options\n${globals(/** @type {string[]} */ (shared.filter(Boolean)))}`,
  ].filter(Boolean).join("\n\n");
}

/** The commands that start with one word, for "frontmost profiles" when the word alone is not a command. @param {string} noun */
export function group(noun) {
  const rows = [...commands.values()].filter((c) => c.name.startsWith(`${noun} `)).map((c) => /** @type {[string, string]} */ ([usage(c), c.summary]));
  return rows.length ? columns(rows) : null;
}
