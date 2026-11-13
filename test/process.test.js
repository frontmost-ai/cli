// The real program, the real fetch, and a local server in place of the API.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { KEY } from "./helpers.js";

const BIN = fileURLToPath(new URL("../bin/frontmost.js", import.meta.url));

/** @param {string[]} argv @param {Record<string, string>} env */
const frontmost = (argv, env) =>
  new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...argv], { env: { PATH: process.env.PATH, HOME: "/nonexistent", ...env } }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
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

test("no key gives exit code 2 and the page that makes one", async () => {
  const r = /** @type {any} */ (await frontmost(["whoami"], {}));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /app\.frontmost\.ai\/team/);
});
