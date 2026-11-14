import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cli, KEY, list, OTHER_KEY } from "./helpers.js";

const oneProject = (/** @type {import("./helpers.js").Seen} */ req) => (req.path === "/projects" ? { body: list([{ id: "7" }]) } : { body: list([]) });

test("help and version need no key and send no request", async () => {
  for (const argv of [[], ["--help"], ["help"], ["help", "answers"], ["questions", "add", "-h"], ["--version"], ["login", "--help"]]) {
    const r = await cli(argv, { env: {} });
    assert.equal(r.code, 0, argv.join(" "));
    assert.ok(r.out.length > 0);
    assert.equal(r.requests.length, 0);
  }
});

test("the key comes from --api-key, then the environment, then ./.env, then the saved key", async () => {
  const home = mkdtempSync(join(tmpdir(), "frontmost-"));
  const sent = async (/** @type {string[]} */ argv, env = {}) => (await cli(["whoami", ...argv], { home, env })).requests[0]?.headers.authorization;

  assert.equal((await cli(["whoami"], { home, env: {} })).code, 2);
  await cli(["login", "--with-key"], { home, env: {}, stdin: `${KEY}\n`, answer: () => ({ body: { name: "Acme" } }) });
  assert.equal(await sent([]), `Bearer ${KEY}`);

  writeFileSync(join(home, ".env"), `OTHER=1\nFRONTMOST_API_URL=https://evil.example\nexport FRONTMOST_API_KEY="${OTHER_KEY}"\n`);
  assert.equal(await sent([]), `Bearer ${OTHER_KEY}`);
  assert.equal(await sent([], { FRONTMOST_API_KEY: KEY }), `Bearer ${KEY}`);
  assert.equal(await sent(["--api-key", OTHER_KEY], { FRONTMOST_API_KEY: KEY }), `Bearer ${OTHER_KEY}`);
});

test("login checks the key, then saves it for this user only. logout removes it", async () => {
  const r = await cli(["login", "--with-key"], { env: {}, stdin: KEY, answer: () => ({ body: { name: "Acme" } }) });
  const file = join(r.home, ".config", "frontmost", "config.json");
  assert.equal(r.code, 0);
  assert.equal(r.requests[0].path, "/workspace");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).api_key, KEY);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.ok(!r.err.includes(KEY) && !r.out.includes(KEY));

  const refused = await cli(["login", "--with-key"], { env: {}, stdin: OTHER_KEY, answer: () => ({ status: 401, body: { error: { code: "invalid_key", message: "The key is not valid." } } }) });
  assert.equal(refused.code, 1);
  assert.throws(() => statSync(join(refused.home, ".config", "frontmost", "config.json")));

  const first = await cli(["logout"], { home: r.home, env: {} });
  assert.throws(() => statSync(file));
  assert.match(first.err, /^Signed out\./);
  const second = await cli(["logout"], { home: r.home, env: {} });
  assert.deepEqual([second.code, second.err], [0, "No sign-in is saved on this computer."]);
});

test("a value that is not a key never leaves the computer", async () => {
  const r = await cli(["whoami"], { env: { FRONTMOST_API_KEY: "sk_live_something_else" } });
  assert.equal(r.code, 2);
  assert.equal(r.requests.length, 0);
  assert.ok(!r.err.includes("sk_live"));
});

test("the API address accepts https and this computer only", async () => {
  for (const url of ["http://example.com/api/v1", "ftp://example.com", "https://user:pw@example.com", "nonsense"]) {
    const r = await cli(["whoami"], { env: { FRONTMOST_API_KEY: KEY, FRONTMOST_API_URL: url } });
    assert.equal(r.code, 2, url);
    assert.equal(r.requests.length, 0);
  }
  assert.equal((await cli(["whoami"], { env: { FRONTMOST_API_KEY: KEY, FRONTMOST_API_URL: "http://localhost:3000/api/v1" } })).code, 0);
});

test("a workspace with one project needs no --project", async () => {
  const r = await cli(["scans"], { answer: oneProject });
  assert.deepEqual(r.requests.map((q) => q.path), ["/projects", "/projects/7/scans"]);
  assert.deepEqual(r.requests[0].query, { limit: "2" });
});

test("the project comes from --project, then FRONTMOST_PROJECT, then ./.env", async () => {
  const home = mkdtempSync(join(tmpdir(), "frontmost-"));
  writeFileSync(join(home, ".env"), "FRONTMOST_PROJECT=3\n");
  const path = async (/** @type {string[]} */ argv, env = {}) => (await cli(["scans", ...argv], { home, env: { FRONTMOST_API_KEY: KEY, ...env }, answer: () => ({ body: list([]) }) })).requests[0].path;
  assert.equal(await path([]), "/projects/3/scans");
  assert.equal(await path([], { FRONTMOST_PROJECT: "4" }), "/projects/4/scans");
  assert.equal(await path(["--project", "5"], { FRONTMOST_PROJECT: "4" }), "/projects/5/scans");
});

test("two projects and no --project stops with the fix", async () => {
  const r = await cli(["scans"], { answer: () => ({ body: list([{ id: "1" }, { id: "2" }], "c") }) });
  assert.equal(r.code, 2);
  assert.equal(r.requests.length, 1);
  assert.match(r.err, /--project <id>/);
});

test("flags become query params", async () => {
  const r = await cli(["answers", "--project", "7", "--scan-id", "5", "--no-named", "--cited-domain", "g2.com", "--period", "week", "--limit", "3"], { answer: () => ({ body: list([]) }) });
  assert.equal(r.requests[0].path, "/projects/7/answers");
  assert.deepEqual(r.requests[0].query, { scan_id: "5", named: "false", cited_domain: "g2.com", period: "week", limit: "3" });
});

test("wrong input stops before any request, with exit code 2", async () => {
  const cases = [
    ["metrics", "--project", "7", "--period", "year"],
    ["scans", "--project", "7", "--limit", "ten"],
    ["scans", "--project", "7", "--named"],
    ["scans", "--project", "7", "--bogus"],
    ["scans", "--project", "7", "extra"],
    ["whoami", "--all"],
    ["scans", "--project", "7", "--body", "{}"],
    ["answers", "get"],
    ["profiles", "add", "--project", "7"],
    ["projects", "update", "7"],
    ["questions", "update", "9", "--project", "7", "--body", "[1]"],
    ["nope"],
    ["api", "FETCH", "/workspace"],
    ["api", "https://evil.example/x"],
  ];
  for (const argv of cases) {
    const r = await cli(argv);
    assert.equal(r.code, 2, argv.join(" "));
    assert.equal(r.requests.length, 0, argv.join(" "));
    assert.match(r.err, /^Error: /);
  }
});

test("questions add sends each question, with the topic and profile on all of them", async () => {
  const r = await cli(["questions", "add", "Which CRM is best for agencies?", "Which CRM is cheapest?", "--topic", "CRM", "--profile-id", "2", "--project", "7"], { answer: () => ({ status: 201, body: list([]) }) });
  assert.equal(`${r.requests[0].method} ${r.requests[0].path}`, "POST /projects/7/questions");
  assert.deepEqual(r.requests[0].body, { questions: [{ text: "Which CRM is best for agencies?", topic: "CRM", profile_id: "2" }, { text: "Which CRM is cheapest?", topic: "CRM", profile_id: "2" }] });
});

test("update commands send only the named fields. An empty value clears a field", async () => {
  const q = await cli(["questions", "update", "9", "--project", "7", "--topic", "", "--no-active"]);
  assert.equal(`${q.requests[0].method} ${q.requests[0].path}`, "PATCH /projects/7/questions/9");
  assert.deepEqual(q.requests[0].body, { topic: null, active: false });

  const p = await cli(["projects", "update", "7", "--scanning", "--name", "Acme"]);
  assert.equal(p.requests[0].path, "/projects/7");
  assert.deepEqual(p.requests[0].body, { scanning: true, name: "Acme" });

  const b = await cli(["profiles", "update", "4", "--body", '{"name":"Old","who":"Buyers"}', "--name", "New"]);
  assert.deepEqual(b.requests[0].body, { name: "New", who: "Buyers" });

  const stdin = await cli(["profiles", "add", "--project", "7", "--body", "-"], { stdin: '{"name":"Ops lead"}' });
  assert.deepEqual(stdin.requests[0].body, { name: "Ops lead" });
});

test("profiles and recommendations", async () => {
  const add = await cli(["profiles", "add", "Ops lead", "--who", "Runs operations", "--project", "7"]);
  assert.deepEqual([add.requests[0].path, add.requests[0].body], ["/projects/7/profiles", { name: "Ops lead", who: "Runs operations" }]);

  const remove = await cli(["profiles", "remove", "4"], { answer: () => ({ status: 204 }) });
  assert.deepEqual([remove.requests[0].method, remove.requests[0].path, remove.code, remove.out], ["DELETE", "/profiles/4", 0, ""]);

  for (const [word, status] of [["done", "done"], ["dismiss", "dismissed"], ["reopen", "open"]]) {
    const r = await cli(["recommendations", word, "12"]);
    assert.deepEqual([r.requests[0].method, r.requests[0].path, r.requests[0].body], ["PATCH", "/recommendations/12", { status }]);
  }
  assert.equal((await cli(["recommendations", "done", "12", "--status", "open"])).code, 2);
});

test("IDs are escaped in the path", async () => {
  const r = await cli(["answers", "get", "../workspace?x=1"]);
  assert.equal(r.requests[0].path, "/answers/..%2Fworkspace%3Fx%3D1");
});

test("projects create sends a retry key, waits for the setup, then prints the project", async () => {
  const setup = { object: "project_setup", id: "55", status: "drafting", domain: "acme.com", retry_after: 30, next: { method: "POST", path: "/api/v1/projects", body: { setup_id: "55" } } };
  const answer = (/** @type {any} */ _, /** @type {number} */ n) => (n < 3 ? { status: 202, body: setup } : { status: 201, body: { object: "project", id: "8", domain: "acme.com" } });
  const r = await cli(["projects", "create", "acme.com", "--country", "US", "--json"], { answer });
  const body = { country: "US", domain: "acme.com" };
  assert.deepEqual(r.requests.map((q) => q.body), [body, { setup_id: "55" }, { setup_id: "55" }]);
  assert.equal(r.requests[0].headers["Idempotency-Key"], createHash("sha256").update(JSON.stringify(body)).digest("hex"));
  assert.equal(r.requests[1].headers["Idempotency-Key"], undefined);
  assert.deepEqual(r.sleeps, [30000, 30000]);
  assert.equal(JSON.parse(r.out).id, "8");
  assert.equal(r.err.match(/Setting up acme.com/g)?.length, 1);

  const noWait = await cli(["projects", "create", "acme.com", "--no-wait", "--idempotency-key", "k1", "--json"], { answer });
  assert.equal(noWait.requests.length, 1);
  assert.equal(noWait.requests[0].headers["Idempotency-Key"], "k1");
  assert.equal(JSON.parse(noWait.out).object, "project_setup");

  const resume = await cli(["projects", "create", "--setup-id", "55"], { answer: () => ({ status: 201, body: { id: "8" } }) });
  assert.equal(resume.requests[0].headers["Idempotency-Key"], undefined);
});

test("--all gets every page and prints one list", async () => {
  const r = await cli(["projects", "--all", "--json"], { answer: (req) => ({ body: req.query.cursor ? list([{ id: "3" }]) : list([{ id: "1" }, { id: "2" }], "next") }) });
  assert.deepEqual(r.requests.map((q) => q.query), [{ limit: "100" }, { limit: "100", cursor: "next" }]);
  assert.deepEqual(JSON.parse(r.out), list([{ id: "1" }, { id: "2" }, { id: "3" }]));
});

test("a 429 waits the time the API names, then tries one more time", async () => {
  const slow = { status: 429, headers: { "retry-after": "2" }, body: { error: { code: "rate_limited", message: "Too many requests. Wait 2 seconds." } } };
  const ok = await cli(["whoami"], { answer: (_, n) => (n === 1 ? slow : { body: { name: "Acme" } }) });
  assert.deepEqual([ok.code, ok.requests.length, ok.sleeps], [0, 2, [2000]]);
  const still = await cli(["whoami"], { answer: () => slow });
  assert.deepEqual([still.code, still.requests.length], [1, 2]);
});

test("an API error prints its message, code, and request ID, with exit code 1", async () => {
  const body = { error: { code: "plan_no_api", message: "The API needs the Scale plan. Upgrade on the Billing page.", param: null, request_id: "req_1" } };
  const text = await cli(["whoami"], { answer: () => ({ status: 403, body }) });
  assert.equal(text.code, 1);
  assert.equal(text.out, "");
  assert.equal(text.err, "Error: The API needs the Scale plan. Upgrade on the Billing page.\nCode: plan_no_api. Request ID: req_1");
  const json = await cli(["whoami", "--json"], { answer: () => ({ status: 403, body }) });
  assert.deepEqual(JSON.parse(json.err), body);
  assert.ok(!text.err.includes(KEY) && !json.err.includes(KEY));
});

test("a reply that is not JSON, or no reply, is an error with exit code 1", async () => {
  const html = await cli(["whoami"], { answer: () => ({ status: 502 }) });
  assert.deepEqual([html.code, html.err], [1, "Error: The API answered with status 502."]);
  const portal = await cli(["projects", "--all"], { answer: () => ({ body: "<html>Sign in to this network</html>" }) });
  assert.equal(portal.code, 1);
  assert.match(portal.err, /not from the Frontmost API/);
});

test("--json prints the API reply unchanged", async () => {
  const body = { object: "workspace", name: "Acme", questions: { used: 3, max: 50 } };
  const r = await cli(["whoami", "--json"], { answer: () => ({ body }) });
  assert.deepEqual(JSON.parse(r.out), body);
});

test("without --json a list is a table and one object is key and value lines", async () => {
  const rows = [{ object: "rival", id: "1", name: "Globex", visibility: { value: 0.4, numerator: 4, denominator: 10, previous: 0.3 }, tags: ["a", "b"], parent: null }];
  const piped = await cli(["rivals", "--project", "7"], { answer: () => ({ body: list(rows, "abc") }) });
  assert.equal(piped.out, "id\tname\tvisibility\ttags\tparent\n1\tGlobex\t0.4\ta, b\t");
  assert.match(piped.err, /--cursor abc/);

  const screen = await cli(["rivals", "--project", "7"], { tty: true, answer: () => ({ body: list(rows) }) });
  assert.equal(screen.out, "ID  NAME    VISIBILITY  TAGS  PARENT\n1   Globex  0.4         a, b");

  const one = await cli(["whoami"], { tty: true, answer: () => ({ body: { object: "workspace", name: "Acme", questions: { used: 3, max: 50 }, apps: [{ id: "chatgpt" }] } }) });
  assert.equal(one.out, "name            Acme\nquestions.used  3\nquestions.max   50\n\napps\nID\nchatgpt");

  const empty = await cli(["scans", "--project", "7"], { answer: () => ({ body: { ...list([]), message: "No scan is delivered yet." } }) });
  assert.deepEqual([empty.out, empty.err], ["", "No scan is delivered yet."]);
});

test("text from the API cannot send control codes to the terminal", async () => {
  const r = await cli(["projects"], { tty: true, answer: () => ({ body: list([{ name: "\u001b[2JAcme\u0007‮", note: "two\nlines" }]) }) });
  assert.equal(r.out, "NAME     NOTE\n[2JAcme  two lines");
  const e = await cli(["whoami"], { answer: () => ({ status: 400, body: { error: { code: "x\u001b[31m", message: "bad\u001b[0m" } } }) });
  assert.ok(!e.err.includes("\u001b"));
  const body = { object: "workspace", name: "A\u001b[2J\u009b31m\u202ecme" };
  const j = await cli(["whoami", "--json"], { answer: () => ({ body }) });
  assert.ok(!/[\u001b\u009b\u202e]/.test(j.out));
  assert.deepEqual(JSON.parse(j.out), body);
});

test("api calls any route and prints JSON", async () => {
  const get = await cli(["api", "/projects?limit=5"], { answer: () => ({ body: list([]) }) });
  assert.deepEqual([get.requests[0].method, get.requests[0].path, get.requests[0].query], ["GET", "/projects", { limit: "5" }]);
  assert.deepEqual(JSON.parse(get.out), list([]));
  const post = await cli(["api", "post", "/projects/7/profiles", "--body", '{"name":"Ops"}']);
  assert.deepEqual([post.requests[0].method, post.requests[0].body], ["POST", { name: "Ops" }]);
  const pasted = await cli(["api", "/api/v1/projects?limit=5"], { answer: () => ({ body: list([]) }) });
  assert.deepEqual([pasted.requests[0].path, pasted.requests[0].query], ["/projects", { limit: "5" }]);
});

test("a wrong word gets a hint, with exit code 2 and no request", async () => {
  /** @type {[string[], RegExp][]} */
  const cases = [
    [["metrcs"], /Did you mean "frontmost metrics"\?/],
    [["answers", "--apps", "chatgpt"], /Did you mean --app\?/],
    [["recommendations", "finish", "3"], /"frontmost recommendations finish" is not a command[\s\S]*recommendations done <id>/],
    [["profiles", "add"], /Missing name/],
    [["metrics", "extra"], /one argument too many/],
  ];
  for (const [argv, hint] of cases) {
    const r = await cli(argv, { answer: oneProject });
    assert.equal(r.code, 2, argv.join(" "));
    assert.match(r.err, hint);
    assert.equal(r.requests.length, 0, argv.join(" "));
  }
});
