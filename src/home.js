// The screen for "frontmost" with no command on a terminal: the latest scan at a glance.
import { projectSetting } from "./config.js";
import { request } from "./http.js";
import { clean, percent } from "./output.js";
import { padEnd, padStart } from "./style.js";

const RIVALS_SHOWN = 3;

/** The welcome when nothing is signed in. @param {import("./style.js").Style} s */
export function welcome(s) {
  return [
    "",
    `  ${s.logo()}`,
    "",
    "  See how AI apps answer your buyers' questions.",
    "",
    `  ${s.dim(padEnd("Sign in", 10))}${s.bold("frontmost login")}`,
    `  ${s.dim(padEnd("Commands", 10))}${s.bold("frontmost --help")}`,
    "",
  ].join("\n");
}

/** "2026-10-05" is "Oct 5". @param {string} day */
const shortDate = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "▲ 2 pts", "▼ 10 pts", or "" when nothing changed or nothing came before. @param {any} rate */
function change(rate) {
  if (typeof rate?.previous !== "number") return "";
  const points = Math.round(rate.value * 100) - Math.round(rate.previous * 100);
  if (!points) return "same as before";
  return `${points > 0 ? "▲" : "▼"} ${Math.abs(points)} ${Math.abs(points) === 1 ? "pt" : "pts"}`;
}

/**
 * @param {import("./http.js").Client} client
 * @param {{ env: import("./config.js").Env, cwd: string, width?: number, project?: string }} io
 * @param {import("./style.js").Style} s
 */
export async function home(client, io, s) {
  /** @param {string} path @param {Record<string, string>} [query] */
  const get = async (path, query) => (await request(client, "GET", path, { query })).body;
  const [workspace, projects] = await Promise.all([get("/workspace"), get("/projects", { limit: "100" })]);
  const head = ["", `  ${s.logo()}   ${s.dim(clean(`${workspace.name} · ${plan(workspace.plan)}`))}`, ""];

  const set = projectSetting({ flag: io.project, env: io.env, cwd: io.cwd });
  const project = set ? projects.data.find((/** @type {any} */ p) => String(p.id) === set) : projects.data.length === 1 ? projects.data[0] : undefined;
  if (!project) return [...head, ...pick(projects.data, set, s), ""].join("\n");

  const [metrics, rivals] = await Promise.all([get(`/projects/${project.id}/metrics`), get(`/projects/${project.id}/rivals`, { limit: "100" })]);
  const lines = [...head, `  ${s.bold(clean(project.name))}`];
  const totals = metrics.totals;
  if (!totals?.visibility?.denominator) {
    lines.push(`  ${s.dim(clean(metrics.message ?? "No scan is delivered yet."))}`, "", ...next(["frontmost scans", "frontmost --help"], s), "");
    return lines.join("\n");
  }

  const answers = totals.visibility.denominator;
  const apps = metrics.scope?.apps?.length ?? 0;
  lines.push(s.dim(`  Scan of ${shortDate(metrics.scope.period.end)} · ${answers} answers · ${apps} AI ${apps === 1 ? "app" : "apps"}`), "");

  const dots = Math.max(10, Math.min(40, (io.width ?? 80) - 44));
  /** @param {string} name @param {any} rate */
  const rateRow = (name, rate) =>
    `  ${padEnd(name, 12)}${padStart(s.bold(percent(rate.value)), 4)}  ${s.tally(rate.numerator, rate.denominator, dots)}  ${s.dim(padStart(`${rate.numerator} of ${rate.denominator}`, 8))}  ${s.dim(change(rate))}`;
  lines.push(rateRow("Visibility", totals.visibility), rateRow("Win rate", totals.win_rate));
  if (typeof totals.position?.value === "number") {
    const was = typeof totals.position.previous === "number" ? `was ${totals.position.previous}` : "";
    lines.push(`  ${padEnd("Position", 12)}${padStart(s.bold(String(totals.position.value)), 4)}  ${s.dim(`average place when named${was ? ` · ${was}` : ""}`)}`);
  }

  const board = ranking(rivals.data, totals.visibility, s);
  if (board.length) lines.push("", `  ${s.bold("Named most")}`, ...board);
  lines.push("", ...next(["frontmost rivals", "frontmost answers", "frontmost --help"], s));
  if (project.url) lines.push(`  ${s.dim(padEnd("Open", 6))}${s.dim(clean(project.url))}`);
  lines.push("");
  return lines.join("\n");
}

/** "scale" is "Scale". @param {unknown} name */
const plan = (name) => clean(name).replace(/^./, (c) => c.toUpperCase());

/** @param {string[]} commands @param {import("./style.js").Style} s */
const next = (commands, s) => [`  ${s.dim(padEnd("Next", 6))}${commands.map((c) => s.bold(c)).join(s.dim("  ·  "))}`];

/**
 * The top rivals and you, ranked by the answers that named each one. Your row is the one yellow row.
 * @param {any[]} rivals @param {any} you @param {import("./style.js").Style} s
 */
function ranking(rivals, you, s) {
  const named = (/** @type {any} */ r) => Number(r.visibility?.numerator) || 0;
  const rank = 1 + rivals.filter((r) => named(r) > you.numerator).length;
  const rows = rivals.slice(0, RIVALS_SHOWN).map((r, i) => ({ place: i + 1, name: clean(r.name), count: named(r), you: false }));
  const me = { place: rank, name: "You", count: you.numerator, you: true };
  rows.splice(Math.min(rank - 1, rows.length), 0, me);
  const width = Math.max(...rows.map((r) => r.name.length), 3);
  const lines = rows.map((r) => {
    const text = `${padStart(String(r.place), 3)}  ${padEnd(r.name, width)}  ${padStart(String(r.count), 3)} of ${you.denominator}`;
    return r.you ? `  ${s.named(text)}` : `  ${text.replace(/ of \d+$/, (t) => s.dim(t))}`;
  });
  // Rivals between the top ones and you are left out. A gray mark shows the gap.
  if (rank > RIVALS_SHOWN + 1) lines.splice(RIVALS_SHOWN, 0, `  ${s.gray("  ⋮")}`);
  return lines;
}

/** With more than one project and none chosen, list them. @param {any[]} projects @param {string | undefined} set @param {import("./style.js").Style} s */
function pick(projects, set, s) {
  if (!projects.length) return ["  No project yet.", "", ...next(["frontmost projects create <domain>"], s)];
  const lines = set ? [`  Project ${clean(set)} is not in this workspace.`, ""] : [];
  const width = Math.max(...projects.map((p) => String(p.id).length));
  lines.push(`  ${s.bold("Projects")}`, ...projects.map((p) => `  ${s.dim(padStart(clean(p.id), width))}  ${clean(p.name)}`), "");
  lines.push(`  ${s.dim("Choose one with")} ${s.bold("--project <id>")}${s.dim(", or set")} ${s.bold("FRONTMOST_PROJECT")}`);
  return lines;
}
