import assert from "node:assert/strict";
import { test } from "node:test";
import { makeStyle, padEnd, styleFor, visible } from "../src/style.js";
import { cli, list } from "./helpers.js";

test("color is on at a terminal, and off in a pipe, with NO_COLOR, and with TERM=dumb", () => {
  assert.equal(styleFor({ isTTY: true }, {}).on, true);
  assert.equal(styleFor({ isTTY: false }, {}).on, false);
  assert.equal(styleFor({ isTTY: true }, { NO_COLOR: "1" }).on, false);
  assert.equal(styleFor({ isTTY: true }, { TERM: "dumb" }).on, false);
  assert.equal(styleFor({ isTTY: false }, { FORCE_COLOR: "1" }).on, true);
  assert.equal(styleFor({ isTTY: false }, { FORCE_COLOR: "0" }).on, false);
  // A light terminal gets a darker yellow, so that the dots stay easy to see.
  assert.match(styleFor({ isTTY: true }, { COLORFGBG: "0;15" }).named("x"), /38;5;142/);
  assert.match(styleFor({ isTTY: true }, { COLORTERM: "truecolor" }).named("x"), /38;2;229;245;75/);
});

test("the tally has one dot for each answer, and shares out the dots above the maximum", () => {
  const plain = makeStyle();
  assert.equal(plain.tally(3, 5), "●●●○○");
  assert.equal(plain.tally(10, 100, 10), "●○○○○○○○○○");
  assert.equal(plain.tally(0, 0), "");
  const color = makeStyle({ on: true });
  assert.equal(visible(color.tally(3, 5)), 5);
  assert.equal(visible(padEnd(color.bold("ab"), 4)), 4);
  assert.equal(plain.errorDot(), "Error:");
});

test("frontmost alone shows the welcome before a sign-in, and the help in a pipe or with --help", async () => {
  const welcome = await cli([], { env: {}, tty: true });
  assert.match(welcome.out, /See how AI apps answer your buyers' questions\./);
  assert.match(welcome.out, /Sign in\s+frontmost login/);
  assert.equal(welcome.requests.length, 0);

  for (const [argv, tty] of /** @type {[string[], boolean][]} */ ([[[], false], [["--help"], true], [["--json"], true]])) {
    const r = await cli(argv, { tty });
    assert.match(r.out, /Usage|Commands/, argv.join(" "));
    assert.equal(r.requests.length, 0);
  }
});

test("frontmost alone at a terminal shows the latest scan, the rivals ahead of you, and the next commands", async () => {
  /** @param {number} numerator @param {number} [previous] */
  const rate = (numerator, previous) => ({ value: numerator / 31, numerator, denominator: 31, previous });
  /** @param {string} name @param {number} numerator */
  const rival = (name, numerator) => ({ object: "rival", name, visibility: rate(numerator) });
  /** @type {Record<string, unknown>} */
  const bodies = {
    "/workspace": { object: "workspace", name: "Acme", plan: "scale" },
    "/projects": list([{ object: "project", id: 104, name: "Fieldnote", url: "https://app.frontmost.ai/projects/104" }]),
    "/projects/104/metrics": {
      object: "metrics",
      scope: { period: { end: "2026-10-05" }, apps: ["chatgpt", "claude"] },
      totals: { visibility: rate(10, 8 / 31), win_rate: rate(1, 1 / 31), position: { value: 2.4, previous: 2 } },
    },
    "/projects/104/rivals": list([rival("Waypoint", 18), rival("Trailbook", 16), rival("Inkfield", 15), rival("Quill", 12), rival("Tiny", 2)]),
  };
  const r = await cli([], { tty: true, answer: (req) => ({ body: bodies[req.path] }) });
  assert.equal(r.code, 0);
  const lines = r.out.split("\n").map((l) => l.trimEnd());
  assert.ok(lines.includes("  ” frontmost   Acme · Scale"));
  assert.ok(lines.includes("  Scan of Oct 5 · 31 answers · 2 AI apps"));
  assert.match(r.out, /Visibility\s+32%\s+●{10}○{21}\s+10 of 31\s+▲ 6 pts/);
  assert.match(r.out, /Win rate\s+3%\s+●○{30}\s+1 of 31\s+same as before/);
  assert.match(r.out, /Position\s+2\.4\s+average place when named · was 2/);
  // The top three rivals, a mark for the ones left out, then you at your place.
  const board = lines.slice(lines.indexOf("  Named most") + 1, lines.indexOf("  Named most") + 6);
  assert.deepEqual(board.map((l) => l.trim().split(/\s{2,}/).slice(0, 2).join(" ")), ["1 Waypoint", "2 Trailbook", "3 Inkfield", "⋮", "5 You"]);
  assert.match(r.out, /Next\s+frontmost rivals\s+·\s+frontmost answers\s+·\s+frontmost --help/);
});

test("with more than one project and none chosen, the home screen lists them", async () => {
  const bodies = { "/workspace": { name: "Acme", plan: "free" }, "/projects": list([{ id: 1, name: "One" }, { id: 2, name: "Two" }]) };
  const r = await cli([], { tty: true, answer: (req) => ({ body: bodies[/** @type {keyof typeof bodies} */ (req.path)] }) });
  assert.match(r.out, /Projects\n\s+1\s+One\n\s+2\s+Two/);
  assert.match(r.out, /--project <id>/);
  assert.equal(r.requests.length, 2);
});
