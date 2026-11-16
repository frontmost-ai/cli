// The real program, the real fetch, and a local server in place of the API.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { KEY } from "./helpers.js";

// FRONTMOST_BIN runs these tests against a standalone binary, such as the one that install.sh downloads.
const [EXE, ...PRE] = process.env.FRONTMOST_BIN ? [process.env.FRONTMOST_BIN] : [process.execPath, fileURLToPath(new URL("../bin/frontmost.js", import.meta.url))];

/** @param {string[]} argv @param {Record<string, string>} env */
const frontmost = (argv, env) =>
  new Promise((resolve) => {
    execFile(EXE, [...PRE, ...argv], { env: { PATH: process.env.PATH, HOME: "/nonexistent", ...env } }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });

test("the program sends the key as a Bearer header and refuses redirects", async () => {
  /** @type {import("node:http").IncomingHttpHeaders[]} */ const seen = [];
  const server = createServer((req, res) => {
    seen.push(req.headers);
    if (req.url === "/api/v1/workspace") return res.setHeader("content-type", "application/json").end('{"object":"workspace","name":"Acme"}');
    res.writeHead(302, { location: "http://127.0.0.1:9/steal" }).end();
  }).listen(0, "127.0.0.1");
  await new Promise((ready) => server.once("listening", ready));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  const env = { FRONTMOST_API_KEY: KEY, FRONTMOST_API_URL: `http://127.0.0.1:${port}/api/v1` };

  const ok = /** @type {any} */ (await frontmost(["whoami", "--json"], env));
  assert.equal(ok.code, 0);
  assert.equal(JSON.parse(ok.stdout).name, "Acme");
  assert.equal(seen[0].authorization, `Bearer ${KEY}`);
  assert.match(String(seen[0]["user-agent"]), /^frontmost-cli\/\d/);

  const redirect = /** @type {any} */ (await frontmost(["projects"], env));
  assert.equal(redirect.code, 1);
  assert.equal(seen.length, 2);
  assert.ok(!redirect.stderr.includes(KEY));
  server.close();
});

test("no sign-in gives exit code 2 and names the command that signs in", async () => {
  const r = /** @type {any} */ (await frontmost(["whoami"], {}));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Run "frontmost login"/);
});

test("a closed pipe ends the program without an error", async () => {
  const rows = Array.from({ length: 20000 }, (_, id) => ({ id, text: "Which bank is best for freelancers?" }));
  const server = createServer((_, res) => res.setHeader("content-type", "application/json").end(JSON.stringify({ object: "list", data: rows, has_more: false, next_cursor: null }))).listen(0, "127.0.0.1");
  await new Promise((ready) => server.once("listening", ready));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  const child = spawn(EXE, [...PRE, "api", "/projects/1/questions"], { env: { PATH: process.env.PATH, HOME: "/nonexistent", FRONTMOST_API_KEY: KEY, FRONTMOST_API_URL: `http://127.0.0.1:${port}/api/v1` }, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdout.once("data", () => child.stdout.destroy());
  const code = await new Promise((done) => child.once("close", done));
  server.close();
  assert.deepEqual([code, stderr], [0, ""]);
});
