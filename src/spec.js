// Every API command comes from openapi.json. A new API route needs a new copy of that file, not new code.
import { readFileSync } from "node:fs";

/** @param {string} file */
const read = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));

// A standalone binary has no files next to it. scripts/binary-entry.js embeds both files and sets this.
const embedded = /** @type {{ spec: any, version: string } | undefined} */ (/** @type {any} */ (globalThis).__FRONTMOST_EMBED__);

export const spec = embedded?.spec ?? read("openapi.json");
export const VERSION = embedded?.version ?? read("package.json").version;

/**
 * @typedef {{ name: string, key: string, in: "query" | "body" | "item", parent?: string, type: "string" | "integer" | "boolean" | "list", enum?: string[], deprecated?: boolean, nullable: boolean, default?: unknown, description: string }} Flag
 * @typedef {{ name: string, method: string, path: string, summary: string, inProject: boolean, args: string[], flags: Map<string, Flag>, hasBody: boolean, required: string[], positional?: { field: string, list?: string, label: string }, preset?: Record<string, unknown>, isList: boolean, retryKey: boolean }} Command
 */

const VERBS = /** @type {Record<string, string>} */ ({ post: "add", patch: "update", delete: "remove" });
const RENAMES = /** @type {Record<string, string>} */ ({ workspace: "whoami", "projects add": "projects create" });

/** Body fields that a command also accepts without a flag name. */
const POSITIONAL = /** @type {Record<string, { field: string, list?: string, label: string }>} */ ({
  "projects create": { field: "domain", label: "[domain]" },
  "profiles add": { field: "name", label: "<name>" },
  "questions add": { field: "text", list: "questions", label: "<question>..." },
});

/** Short forms of one command with one body field already set. */
const SHORTCUTS = /** @type {Record<string, { of: string, preset: Record<string, unknown>, summary: string }>} */ ({
  "questions pause": { of: "questions update", preset: { active: false }, summary: "Pause a question. It keeps its history and frees room in the plan" },
  "questions resume": { of: "questions update", preset: { active: true }, summary: "Ask a paused question again" },
  "recommendations done": { of: "recommendations update", preset: { status: "done" }, summary: "Mark a recommendation done" },
  "recommendations dismiss": { of: "recommendations update", preset: { status: "dismissed" }, summary: "Dismiss a recommendation" },
  "recommendations reopen": { of: "recommendations update", preset: { status: "open" }, summary: "Open a recommendation again" },
});

/** @param {string} name */
export const dashed = (name) => name.replaceAll("_", "-").toLowerCase();

/**
 * The flag type for a schema, or null when the value is not one string, number, true/false, or list of strings.
 * @param {any} schema
 */
function scalar(schema) {
  const options = schema.anyOf ?? [schema];
  const real = options.filter((/** @type {any} */ s) => s.type !== "null");
  if (real.length !== 1) return null;
  const [s] = real;
  const nullable = real.length < options.length;
  const trueFalse = s.enum?.length === 2 && s.enum.includes("true") && s.enum.includes("false");
  if (s.type === "boolean" || trueFalse) return { type: /** @type {const} */ ("boolean"), nullable };
  if (s.type === "integer") return { type: /** @type {const} */ ("integer"), nullable, default: s.default };
  if (s.type === "string") return { type: /** @type {const} */ ("string"), nullable, enum: s.enum, default: s.default };
  if (s.type === "array" && s.items?.type === "string") return { type: /** @type {const} */ ("list"), nullable, enum: s.items.enum };
  return null;
}

/**
 * @param {string} method
 * @param {string} path
 * @param {any} op
 * @returns {Command}
 */
function command(method, path, op) {
  const parts = path.split("/").filter(Boolean);
  const noun = parts.findLast((p) => !p.startsWith("{")) ?? "";
  const verb = method === "get" ? (parts.at(-1)?.startsWith("{") ? "get" : "") : VERBS[method];
  const derived = verb ? `${noun} ${verb}` : noun;
  const name = RENAMES[derived] ?? derived;
  const inProject = path.startsWith("/projects/{id}");
  const params = /** @type {any[]} */ (op.parameters ?? []);
  const body = op.requestBody?.content["application/json"].schema;
  const positional = POSITIONAL[name];

  /** @type {Map<string, Flag>} */
  const flags = new Map();
  /** @param {string} key @param {any} schema @param {Flag["in"]} where @param {string} [description] @param {string} [parent] */
  const add = (key, schema, where, description = "", parent) => {
    const type = scalar(schema);
    if (!type) return;
    const name = dashed(key);
    const taken = flags.get(name);
    // A member of a body object, such as run_config.cadence, takes the name of the older top-level field it replaces.
    if (taken && !(parent && taken.deprecated)) throw new Error(`Two fields of ${method.toUpperCase()} ${path} map to --${name}`);
    flags.set(name, { name, key, in: where, parent, description, deprecated: schema.deprecated === true, ...type });
  };
  for (const p of params) if (p.in === "query") add(p.name, p.schema, "query", p.description);
  for (const [key, schema] of Object.entries(body?.properties ?? {})) add(key, schema, "body", schema.description);
  for (const [parent, schema] of Object.entries(body?.properties ?? {}))
    for (const [key, member] of Object.entries(schema.type === "object" ? (schema.properties ?? {}) : {})) add(key, member, "body", member.description, parent);
  if (positional?.list) {
    const item = body.properties[positional.list].items;
    for (const [key, schema] of Object.entries(item.properties)) if (key !== positional.field) add(key, schema, "item", schema.description);
  }

  return {
    name,
    method: method.toUpperCase(),
    path,
    summary: op.summary,
    inProject,
    args: params.filter((p) => p.in === "path" && !(inProject && p.name === "id")).map((p) => p.name),
    flags,
    hasBody: Boolean(body),
    required: body?.required ?? [],
    positional,
    isList: flags.has("cursor"),
    retryKey: params.some((p) => p.in === "header" && p.name === "Idempotency-Key"),
  };
}

/** @type {Map<string, Command>} */
export const commands = new Map();
for (const [path, ops] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(ops)) {
    const c = command(method, path, op);
    if (commands.has(c.name)) throw new Error(`Two API routes map to "${c.name}"`);
    commands.set(c.name, c);
  }
}
for (const [name, s] of Object.entries(SHORTCUTS)) {
  const of = commands.get(s.of);
  if (!of) continue;
  const flags = new Map([...of.flags].filter(([, f]) => !(f.key in s.preset)));
  commands.set(name, { ...of, name, summary: s.summary, flags, preset: s.preset });
}

/** Flags that every command accepts. */
export const GLOBALS = /** @type {const} */ ({
  json: { type: "boolean", description: "Print the API response as JSON" },
  project: { type: "string", description: "Project ID. Not needed when the workspace has one project" },
  all: { type: "boolean", description: "Get every page of a list" },
  body: { type: "string", description: "Request body as JSON. Use - to read it from stdin" },
  "idempotency-key": { type: "string", description: "Retry key for projects create. Default: made from the request body" },
  wait: { type: "boolean", description: "Return at once when a project setup is still running" },
  "api-key": { type: "string", description: "API key. Prefer FRONTMOST_API_KEY or frontmost login" },
  browser: { type: "boolean", description: "For login. Sign in with a code. For a computer with no browser" },
  "with-key": { type: "boolean", description: "For login. Save an API key in place of a browser sign-in" },
  help: { type: "boolean", short: "h", description: "Show help" },
  version: { type: "boolean", short: "v", description: "Show the version" },
});
