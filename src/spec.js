// Every API command comes from openapi.json. A new API route needs a new copy of that file, not new code.
import { readFileSync } from "node:fs";

/** @param {string} file */
const read = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));

export const spec = read("openapi.json");
export const VERSION = read("package.json").version;

/**
 * @typedef {{ name: string, key: string, in: "query" | "body" | "item", type: "string" | "integer" | "boolean", enum?: string[], nullable: boolean, default?: unknown, description: string }} Flag
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
  "recommendations done": { of: "recommendations update", preset: { status: "done" }, summary: "Mark a recommendation done" },
  "recommendations dismiss": { of: "recommendations update", preset: { status: "dismissed" }, summary: "Dismiss a recommendation" },
  "recommendations reopen": { of: "recommendations update", preset: { status: "open" }, summary: "Open a recommendation again" },
});

/** @param {string} name */
export const dashed = (name) => name.replaceAll("_", "-").toLowerCase();

/**
 * The flag type for a schema, or null when the value is not one string, number, or true/false.
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
  /** @param {string} key @param {any} schema @param {Flag["in"]} where @param {string} [description] */
  const add = (key, schema, where, description = "") => {
    const type = scalar(schema);
    if (type) flags.set(dashed(key), { name: dashed(key), key, in: where, description, ...type });
  };
  for (const p of params) if (p.in === "query") add(p.name, p.schema, "query", p.description);
  for (const [key, schema] of Object.entries(body?.properties ?? {})) add(key, schema, "body", schema.description);
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
  help: { type: "boolean", short: "h", description: "Show help" },
  version: { type: "boolean", short: "v", description: "Show the version" },
});
