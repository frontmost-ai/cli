// Plain text for people. Text from the API can never send control codes to the terminal.

// Control codes except tab and newline, plus the Unicode marks that reorder text.
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;
const MAX_CELL = 48;

/** @param {unknown} text */
export const clean = (text) => String(text).replace(UNSAFE, "");
/** JSON text with the same values, and with each unsafe character written as \\uXXXX. @param {unknown} value */
export const json = (value) => JSON.stringify(value, null, 2).replace(UNSAFE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
/** @param {unknown} text */
const oneLine = (text) => clean(text).replace(/\s+/g, " ").trim();

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
/** @param {unknown} v @returns {v is Record<string, unknown>[]} */
const isRows = (v) => Array.isArray(v) && v.length > 0 && v.every(isObject);

/** @param {unknown} v */
function cell(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.every((x) => !isObject(x)) ? v.join(", ") : String(v.length);
  return String(v);
}

/**
 * One level of key and value pairs. {a: {b: 1}} becomes a.b. A rate {value, numerator, ...} shows its value.
 * @param {Record<string, unknown>} obj @returns {[string, unknown][]}
 */
export function flatten(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) => {
    if (!isObject(v)) return [[prefix + k, v]];
    if ("value" in v) return [[prefix + k, v.value]];
    return flatten(v, `${prefix}${k}.`);
  });
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {{ tty: boolean, width?: number }} view On a terminal: aligned columns that fit the width. Else: tab-separated, all columns.
 */
export function table(rows, { tty, width = 80 }) {
  const flat = rows.map((r) => new Map(flatten(r).map(([k, v]) => [k, oneLine(cell(v))])));
  const columns = [...new Set(flat.flatMap((r) => [...r.keys()]))].filter((c) => c !== "object");
  if (!tty) return [columns.join("\t"), ...flat.map((r) => columns.map((c) => r.get(c) ?? "").join("\t"))].join("\n");

  /** @param {string} s */
  const fit = (s) => (s.length > MAX_CELL ? `${s.slice(0, MAX_CELL - 1)}…` : s);
  const widths = columns.map((c) => Math.max(c.length, ...flat.map((r) => fit(r.get(c) ?? "").length)));
  let shown = 0;
  for (let used = 0; shown < columns.length; shown++) {
    used += widths[shown] + (shown ? 2 : 0);
    if (used > width && shown > 0) break;
  }
  /** @param {string[]} cells */
  const line = (cells) => cells.slice(0, shown).map((s, i) => fit(s).padEnd(widths[i])).join("  ").trimEnd();
  const lines = [line(columns.map((c) => c.toUpperCase())), ...flat.map((r) => line(columns.map((c) => r.get(c) ?? "")))];
  if (shown < columns.length) lines.push("", `${columns.length - shown} more columns do not fit. Add --json to see all fields.`);
  return lines.join("\n");
}

/**
 * One object as "key  value" lines. Lists of objects inside it follow as tables.
 * @param {Record<string, unknown>} obj @param {{ tty: boolean, width?: number }} view
 */
export function record(obj, view) {
  const pairs = flatten(obj).filter(([k]) => k !== "object");
  const plain = pairs.filter(([, v]) => !isRows(v));
  const pad = Math.max(0, ...plain.map(([k]) => k.length));
  const lines = plain.map(([k, v]) => {
    const text = clean(cell(v)).trim();
    return text.includes("\n") ? `${k}\n${text}` : view.tty ? `${k.padEnd(pad)}  ${text}` : `${k}\t${text}`;
  });
  for (const [k, v] of pairs) if (isRows(v)) lines.push("", k, table(v, view));
  return lines.join("\n");
}

/**
 * @param {any} body @param {{ tty: boolean, width?: number }} view
 */
export function render(body, view) {
  if (body?.object !== "list") return isObject(body) ? record(body, view) : json(body);
  return body.data.length ? table(body.data, view) : "";
}
