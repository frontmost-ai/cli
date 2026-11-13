import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cli, KEY } from "./helpers.js";

const AUTH = "https://auth.example";
const ENDS = {
  issuer: AUTH,
  authorization_endpoint: `${AUTH}/oauth2/authorize`,
  token_endpoint: `${AUTH}/oauth2/token`,
  device_authorization_endpoint: `${AUTH}/oauth2/device_authorization`,
};
const TOKENS = { access_token: "access-1", refresh_token: "refresh-1", expires_in: 300 };

/**
 * A fake API and sign-in server. `token` answers the token endpoint.
 * @param {(req: import("./helpers.js").Seen) => import("./helpers.js").Reply} token @param {object} [ends]
 * @returns {(req: import("./helpers.js").Seen) => import("./helpers.js").Reply}
 */
const servers = (token, ends = ENDS) => (req) => {
  if (req.path === "/.well-known/oauth-protected-resource") return { body: { authorization_servers: [AUTH] } };
  if (req.path === "/.well-known/oauth-authorization-server") return { body: ends };
  if (req.path === "/oauth2/token") return token(req);
  if (req.path === "/oauth2/device_authorization") return { body: { device_code: "device-1", user_code: "ABCD-EFGH", verification_uri: `${AUTH}/device`, expires_in: 300, interval: 5 } };
  return { body: { name: "Acme" } };
};

const configFile = (/** @type {string} */ home) => join(home, ".config", "frontmost", "config.json");
const saved = (/** @type {string} */ home) => JSON.parse(readFileSync(configFile(home), "utf8")).sign_in;

/** A computer that already has a browser sign-in. @param {object} [change] */
function signedIn(change = {}) {
  const home = mkdtempSync(join(tmpdir(), "frontmost-"));
  mkdirSync(join(home, ".config", "frontmost"), { recursive: true });
  const signIn = { access_token: "access-1", refresh_token: "refresh-1", expires_at: Date.now() + 300_000, token_endpoint: ENDS.token_endpoint, ...change };
  writeFileSync(configFile(home), JSON.stringify({ sign_in: signIn }));
  return home;
}

/** The person signs in, and the browser comes back with a code. @param {(back: URL, asked: URL) => void} [change] */
const browser = (change) => {
  /** @type {URL[]} */ const opened = [];
  return {
    opened,
    open: async (/** @type {string} */ url) => {
      const asked = new URL(url);
      opened.push(asked);
      const back = new URL(String(asked.searchParams.get("redirect_uri")));
      back.searchParams.set("code", "code-1");
      back.searchParams.set("state", String(asked.searchParams.get("state")));
      change?.(back, asked);
      await fetch(back);
      return true;
    },
  };
};

test("login opens the browser, proves the sign-in with PKCE, and saves it for this user only", async () => {
  const b = browser();
  const r = await cli(["login"], { env: {}, open: b.open, answer: servers(() => ({ body: TOKENS })) });
  assert.equal(r.code, 0, r.err);

  const asked = b.opened[0].searchParams;
  assert.equal(b.opened[0].origin + b.opened[0].pathname, ENDS.authorization_endpoint);
  assert.equal(asked.get("resource"), "https://app.frontmost.ai/api/v1");
  assert.equal(asked.get("code_challenge_method"), "S256");
  assert.match(String(asked.get("redirect_uri")), /^http:\/\/127\.0\.0\.1:\d+\/callback$/);

  const exchange = r.requests.find((q) => q.path === "/oauth2/token")?.body;
  assert.equal(exchange.code, "code-1");
  assert.equal(exchange.redirect_uri, asked.get("redirect_uri"));
  assert.equal(exchange.resource, "https://app.frontmost.ai/api/v1");
  assert.equal(createHash("sha256").update(exchange.code_verifier).digest("base64url"), asked.get("code_challenge"));

  const api = r.requests.at(-1);
  assert.deepEqual([api?.host, api?.path, api?.headers.authorization], ["app.frontmost.ai", "/workspace", "Bearer access-1"]);
  assert.equal(saved(r.home).refresh_token, "refresh-1");
  assert.equal(statSync(configFile(r.home)).mode & 0o777, 0o600);
  assert.match(r.err, /Signed in to Acme/);
  for (const secret of ["access-1", "refresh-1", exchange.code_verifier]) assert.ok(!r.err.includes(secret) && !r.out.includes(secret));
});

test("a reply with the wrong state does not sign in, and the right reply still does", async () => {
  /** @type {number[]} */ const statuses = [];
  const b = browser();
  const open = async (/** @type {string} */ url) => {
    const forged = new URL(String(new URL(url).searchParams.get("redirect_uri")));
    forged.searchParams.set("code", "stolen");
    forged.searchParams.set("state", "guess");
    statuses.push((await fetch(forged)).status);
    return b.open(url);
  };
  const r = await cli(["login"], { env: {}, open, answer: servers(() => ({ body: TOKENS })) });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(statuses, [404]);
  assert.equal(r.requests.find((q) => q.path === "/oauth2/token")?.body.code, "code-1");
});

test("a refused or failed sign-in saves nothing and gives exit code 1", async () => {
  const refused = browser((back) => (back.searchParams.delete("code"), back.searchParams.set("error", "access_denied")));
  const otherServer = browser((back) => back.searchParams.set("iss", "https://evil.example"));
  const cases = [
    await cli(["login"], { env: {}, open: refused.open, answer: servers(() => ({ body: TOKENS })) }),
    await cli(["login"], { env: {}, open: otherServer.open, answer: servers(() => ({ body: TOKENS })) }),
    await cli(["login"], { env: {}, open: browser().open, answer: servers(() => ({ status: 400, body: { error: "invalid_grant" } })) }),
    await cli(["login"], { env: {}, open: browser().open, answer: (req) => (req.path === "/workspace" ? { status: 403, body: { error: { code: "plan_no_api", message: "Your plan has no API access." } } } : servers(() => ({ body: TOKENS }))(req)) }),
  ];
  assert.match(cases[0].err, /refused/);
  assert.ok(!cases[1].requests.some((q) => q.path === "/oauth2/token"));
  assert.match(cases[3].err, /Your plan has no API access/);
  for (const r of cases) {
    assert.equal(r.code, 1);
    assert.throws(() => statSync(configFile(r.home)));
  }
});

test("the sign-in server must be https, and must be the one that the API names", async () => {
  const plain = await cli(["login"], { env: {}, open: browser().open, answer: servers(() => ({ body: TOKENS }), { ...ENDS, token_endpoint: "http://auth.example/oauth2/token" }) });
  const other = await cli(["login"], { env: {}, open: browser().open, answer: servers(() => ({ body: TOKENS }), { ...ENDS, issuer: "https://evil.example" }) });
  for (const r of [plain, other]) {
    assert.equal(r.code, 1);
    assert.match(r.err, /did not say where to sign in/);
    assert.ok(!r.requests.some((q) => q.path.startsWith("/oauth2/")));
  }
});

test("with no browser, login shows a code and waits at the pace that the server sets", async () => {
  const replies = [{ status: 400, body: { error: "authorization_pending" } }, { status: 400, body: { error: "slow_down" } }, { body: TOKENS }];
  const answer = servers(() => /** @type {import("./helpers.js").Reply} */ (replies.shift()));
  const r = await cli(["login", "--no-browser"], { env: {}, open: async () => assert.fail("no browser"), answer });
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /auth\.example\/device[\s\S]*ABCD-EFGH/);
  assert.deepEqual(r.sleeps, [5000, 5000, 10000]);
  assert.equal(r.requests.find((q) => q.path === "/oauth2/device_authorization")?.body.resource, "https://app.frontmost.ai/api/v1");
  assert.equal(saved(r.home).access_token, "access-1");
  assert.ok(!r.err.includes("device-1"));

  const overSsh = await cli(["login"], { env: { SSH_CONNECTION: "10.0.0.1 22" }, open: async () => assert.fail("no browser"), answer: servers(() => ({ body: TOKENS })) });
  const cannotOpen = await cli(["login"], { env: {}, open: async () => false, answer: servers(() => ({ body: TOKENS })) });
  for (const c of [overSsh, cannotOpen]) assert.match(c.err, /ABCD-EFGH/);

  const expired = await cli(["login", "--no-browser"], { env: {}, answer: servers(() => ({ status: 400, body: { error: "expired_token" } })) });
  assert.equal(expired.code, 1);
  assert.match(expired.err, /The code expired/);
});

test("a saved sign-in is used as it is while its access is good", async () => {
  const r = await cli(["whoami"], { env: {}, home: signedIn() });
  assert.deepEqual(r.requests.map((q) => [q.path, q.headers.authorization]), [["/workspace", "Bearer access-1"]]);
});

test("access near its end is replaced first, and the new refresh token is saved", async () => {
  const home = signedIn({ expires_at: Date.now() + 30_000 });
  const r = await cli(["whoami"], { env: {}, home, answer: servers(() => ({ body: { access_token: "access-2", refresh_token: "refresh-2", expires_in: 300 } })) });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.requests[0].body, { grant_type: "refresh_token", refresh_token: "refresh-1", client_id: r.requests[0].body.client_id, resource: "https://app.frontmost.ai/api/v1" });
  assert.equal(r.requests[0].host, "auth.example");
  assert.equal(r.requests[1].headers.authorization, "Bearer access-2");
  assert.equal(saved(home).refresh_token, "refresh-2");
  assert.equal(statSync(configFile(home)).mode & 0o777, 0o600);
});

test("a sign-in that the server ended asks for a new login, and sends nothing to the API", async () => {
  const r = await cli(["whoami"], { env: {}, home: signedIn({ expires_at: 0 }), answer: servers(() => ({ status: 400, body: { error: "invalid_grant" } })) });
  assert.equal(r.code, 1);
  assert.match(r.err, /Your sign-in ended\. Run "frontmost login" again\./);
  assert.ok(!r.requests.some((q) => q.host === "app.frontmost.ai"));
});

test("an API key that is set wins over the saved sign-in", async () => {
  const r = await cli(["whoami"], { env: { FRONTMOST_API_KEY: KEY }, home: signedIn({ expires_at: 0 }) });
  assert.deepEqual(r.requests.map((q) => q.headers.authorization), [`Bearer ${KEY}`]);
});

test("logout removes the sign-in from this computer, and the next command asks for a login", async () => {
  const home = signedIn();
  const r = await cli(["logout"], { env: {}, home });
  assert.equal(r.code, 0);
  assert.equal(r.requests.length, 0);
  assert.throws(() => statSync(configFile(home)));
  const next = await cli(["whoami"], { env: {}, home });
  assert.equal(next.code, 2);
  assert.match(next.err, /Run "frontmost login"/);
});
