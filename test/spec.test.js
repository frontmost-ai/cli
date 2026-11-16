import assert from "node:assert/strict";
import { test } from "node:test";
import { commands, GLOBALS, spec } from "../src/spec.js";

const operations = Object.values(spec.paths).flatMap((ops) => Object.keys(ops));
const routes = [...commands.values()].filter((c) => !c.preset);

test("every API route is exactly one command", () => {
  assert.equal(routes.length, operations.length);
  assert.equal(new Set(routes.map((c) => `${c.method} ${c.path}`)).size, operations.length);
});

test("the command names are the ones in the README", () => {
  assert.deepEqual([...commands.keys()].sort(), [
    "answers", "answers get", "brief", "brief rate", "industries", "leaderboards", "leaderboards get",
    "metrics", "profiles", "profiles add", "profiles remove", "profiles update",
    "projects", "projects create", "projects delete", "projects get", "projects update",
    "questions", "questions add", "questions pause", "questions resume", "questions update",
    "recommendations", "recommendations dismiss", "recommendations done", "recommendations reopen", "recommendations update",
    "rivals", "scans", "scans answers", "scans get", "scans profiles", "scans queries", "scans questions", "scans readiness", "scans rivals",
    "scans share", "scans sources", "scorecard", "scorecard update", "sources", "whoami",
  ]);
});

test("no API flag has the name of a shared flag, and each name has one type", () => {
  /** @type {Map<string, string>} */ const types = new Map();
  for (const c of commands.values()) {
    for (const f of c.flags.values()) {
      assert.ok(!(f.name in GLOBALS), `--${f.name} of "${c.name}" is also a shared flag`);
      const kind = f.type === "boolean" ? "boolean" : "string";
      assert.equal(types.get(f.name) ?? kind, kind, `--${f.name} has two types`);
      types.set(f.name, kind);
    }
  }
});

test("every query param and every simple body field is a flag", () => {
  const answers = commands.get("answers");
  assert.deepEqual([...(answers?.flags.keys() ?? [])], ["scan-id", "period", "app", "questions", "compare-to", "limit", "cursor", "question-id", "rival-id", "named", "cited-domain"]);
  assert.equal(answers?.flags.get("named")?.type, "boolean");
  assert.deepEqual([...(commands.get("projects create")?.flags.keys() ?? [])], ["domain", "setup-id", "country", "language", "apps", "cadence", "weekly-brief"]);
  const update = commands.get("projects update");
  assert.equal(update?.flags.get("cadence")?.parent, "run_config", "a run_config member takes the name of the deprecated top-level field");
  assert.equal(update?.flags.get("apps")?.type, "list");
  assert.equal(update?.flags.get("scanning")?.deprecated, true);
  assert.equal(commands.get("questions update")?.flags.get("topic")?.nullable, true);
});
