// Sign in with the browser: OAuth 2.0 with PKCE on a loopback address (RFC 8252), or a device code (RFC 8628).
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readSignIn, safeUrl, saveSignIn } from "./config.js";
import { ApiError } from "./errors.js";
import { clean } from "./output.js";
import { VERSION } from "./spec.js";

/** The CLI's public client ID. It is not a secret: the sign-in is proven with PKCE. */
const CLIENT_ID = "client_01M7BCKNW128JXV6J6DX8PAS9T";
const SCOPE = "offline_access";
const BROWSER_WAIT_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
/** Get a new access token this long before the old one expires. */
const EARLY_MS = 60_000;
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const AGAIN = 'Run "frontmost login" again.';

/**
 * @typedef {import("./cli.js").Io} Io
 * @typedef {import("./config.js").SignIn} SignIn
 * @typedef {{ issuer: string, authorization_endpoint: string, token_endpoint: string, device_authorization_endpoint?: string }} Endpoints
 */

/** @param {Buffer} bytes */
const base64url = (bytes) => bytes.toString("base64url");

/**
 * One request to the sign-in server. The reply is JSON, or {} when it is not.
 * @param {Io} io @param {string} url @param {Record<string, string>} [form] Sent as a POST when given.
 * @returns {Promise<{ ok: boolean, body: any }>}
 */
async function call(io, url, form) {
  if (!safeUrl(url)) throw new ApiError("The sign-in server gave an address that is not https. Sign-in stopped.");
  let res;
  let text;
  try {
    res = await io.fetch(url, {
      method: form ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: "application/json", "user-agent": `frontmost-cli/${VERSION}`, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    text = await res.text();
  } catch {
    throw new ApiError(`Could not reach ${new URL(url).host}. Check the network, then try again.`);
  }
  try {
    const body = text ? JSON.parse(text) : {};
    return { ok: res.ok, body: typeof body === "object" && body !== null ? body : {} };
  } catch {
    return { ok: false, body: {} };
  }
}

/**
 * The API names its sign-in server (RFC 9728). The sign-in server names its endpoints (RFC 8414).
 * @param {Io} io @param {string} base The API address. @returns {Promise<Endpoints>}
 */
async function discover(io, base) {
  const api = new URL(base);
  const resource = await call(io, `${api.origin}/.well-known/oauth-protected-resource${api.pathname}`);
  const issuer = resource.body.authorization_servers?.[0];
  const meta = typeof issuer === "string" ? (await call(io, `${issuer.replace(/\/$/, "")}/.well-known/oauth-authorization-server`)).body : {};
  const usable = meta.issuer === issuer && [meta.authorization_endpoint, meta.token_endpoint].every((u) => typeof u === "string" && safeUrl(u));
  if (!usable) throw new ApiError(`${api.host} did not say where to sign in. Try again, or use an API key: frontmost login --with-key`);
  return meta;
}

/**
 * @param {any} body A token reply. @param {Endpoints | SignIn} from
 * @returns {SignIn}
 */
function signInFrom(body, from) {
  if (typeof body.access_token !== "string" || !body.access_token) throw new ApiError(`The sign-in server sent no access. ${AGAIN}`);
  return {
    access_token: body.access_token,
    refresh_token: typeof body.refresh_token === "string" ? body.refresh_token : "refresh_token" in from ? from.refresh_token : undefined,
    expires_at: Date.now() + (Number(body.expires_in) || 300) * 1000,
    token_endpoint: from.token_endpoint,
  };
}

// The brand mark: an ink speech bubble with two yellow quote marks (wordmouth site/brand/frontmost-mark.svg).
const MARK = '<svg width="40" height="40" viewBox="0 0 30 30" aria-hidden="true"><path d="M15 1.5C7.5 1.5 1.5 7.3 1.5 14.6c0 3 1 5.7 2.7 7.9L2.6 28l6-2.1c1.9 1 4.1 1.6 6.4 1.6 7.5 0 13.5-5.8 13.5-13 0-7.2-6-13-13.5-13Z" fill="#111"/><path d="M9.2 10.6h3.4l-2.1 8.2H7.4l1.8-8.2Zm6.4 0H19l-2.1 8.2h-3.1l1.8-8.2Z" fill="#E5F54B"/></svg>';

/** The page that the browser shows last. @param {boolean} done */
export const page = (done) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Frontmost AI</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#FAFAF7;color:#111;font:16px/1.5 Geist,ui-sans-serif,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
main{box-sizing:border-box;width:min(26rem,100% - 2rem);padding:2.5rem 2rem;background:#fff;border:1px solid rgba(17,17,17,.08);border-radius:20px}
h1{margin:1.5rem 0 .375rem;font-size:1.375rem;line-height:1.25;font-weight:600;letter-spacing:-.01em}
p{margin:0;color:#62625C}
code{display:inline-block;margin-top:1.25rem;padding:.375rem .625rem;border-radius:8px;background:#F2F2EE;font:14px/1.4 "Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace;color:#111}
.dot{display:inline-block;width:.5rem;height:.5rem;margin-right:.5rem;border-radius:50%;background:${done ? "#E5F54B;box-shadow:0 0 0 1px rgba(17,17,17,.16)" : "#B42318"};vertical-align:.1em}
</style>
<main>${MARK}
<h1><span class="dot"></span>${done ? "You are signed in" : "The sign-in did not finish"}</h1>
<p>${done ? "Close this tab. To see your latest scan, run this in the terminal:" : "Close this tab. To try again, run this in the terminal:"}</p>
${done ? "<code>frontmost</code>" : "<code>frontmost login</code>"}
</main></html>`;

/**
 * Open the sign-in page and wait for the browser to come back to this computer.
 * @param {Io} io @param {Endpoints} ends @param {string} resource
 * @returns {Promise<SignIn | null>} null when no browser can open.
 */
async function withBrowser(io, ends, resource) {
  const verifier = base64url(randomBytes(32));
  const state = base64url(randomBytes(16));
  const server = createServer();
  await new Promise((ready, fail) => server.once("error", fail).listen(0, "127.0.0.1", () => ready(undefined)));
  const address = server.address();
  const redirect = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/callback`;

  const url = new URL(ends.authorization_endpoint);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirect,
    code_challenge: base64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    state,
    scope: SCOPE,
    resource,
  })) url.searchParams.set(k, v);

  /** @type {NodeJS.Timeout | undefined} */ let timer;
  try {
    /** @type {Promise<URLSearchParams | null>} */
    const returned = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), BROWSER_WAIT_MS);
      server.on("request", (req, res) => {
        const back = new URL(req.url ?? "/", redirect).searchParams;
        // Only the reply to this sign-in counts. Any other request gets no page and does not stop the wait.
        if (!req.url?.startsWith("/callback?") || back.get("state") !== state) return void res.writeHead(404).end();
        const done = Boolean(back.get("code")) && (back.get("iss") ?? ends.issuer) === ends.issuer;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", connection: "close" }).end(page(done));
        resolve(done ? back : new URLSearchParams({ error: back.get("error") ?? "wrong_issuer" }));
      });
    });
    if (!(await io.open(url.href))) return null;
    io.note(`Your browser is open. Sign in there.\nIf the browser did not open, go to:\n${url.href}`);
    const back = await returned;
    if (!back) throw new ApiError(`No sign-in arrived in 5 minutes. ${AGAIN}`);
    const code = back.get("code");
    if (!code) throw new ApiError(back.get("error") === "access_denied" ? "The sign-in was refused." : `The sign-in did not finish. ${AGAIN}`);
    const { ok, body } = await call(io, ends.token_endpoint, { grant_type: "authorization_code", code, redirect_uri: redirect, client_id: CLIENT_ID, code_verifier: verifier, resource });
    if (!ok) throw new ApiError(`The sign-in did not finish. ${AGAIN}`);
    return signInFrom(body, ends);
  } finally {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
  }
}

/**
 * Show a code to enter on any device, then wait for the person to approve it there.
 * @param {Io} io @param {Endpoints} ends @param {string} resource @returns {Promise<SignIn>}
 */
async function withCode(io, ends, resource) {
  if (!ends.device_authorization_endpoint) throw new ApiError("No browser can open here. Use an API key: frontmost login --with-key");
  const { ok, body: device } = await call(io, ends.device_authorization_endpoint, { client_id: CLIENT_ID, scope: SCOPE, resource });
  if (!ok || typeof device.device_code !== "string" || !safeUrl(String(device.verification_uri))) throw new ApiError("The sign-in could not start. Try again.");
  io.note(clean(`Open this page on any device:\n  ${device.verification_uri}\nThen enter this code:\n  ${device.user_code}`));

  let wait = Number(device.interval) || 5;
  for (let left = Number(device.expires_in) || 300; left > 0; left -= wait) {
    await io.sleep(wait * 1000);
    const reply = await call(io, ends.token_endpoint, { grant_type: DEVICE_GRANT, device_code: device.device_code, client_id: CLIENT_ID, resource });
    if (reply.ok) return signInFrom(reply.body, ends);
    if (reply.body.error === "slow_down") wait += 5;
    else if (reply.body.error === "access_denied") throw new ApiError("The sign-in was refused.");
    else if (reply.body.error !== "authorization_pending") break;
  }
  throw new ApiError(`The code expired. ${AGAIN}`);
}

/**
 * Sign in a person. The browser is first. The code is for a computer with no browser, such as one reached over SSH.
 * @param {Io} io @param {string} base The API address. @param {{ browser: boolean }} how @returns {Promise<SignIn>}
 */
export async function signIn(io, base, { browser }) {
  const ends = await discover(io, base);
  const remote = Boolean(io.env.SSH_CONNECTION || io.env.SSH_TTY);
  return ((browser && !remote && (await withBrowser(io, ends, base))) || withCode(io, ends, base));
}

/**
 * The access token of the saved sign-in. Access lasts minutes, so this gets a new one when the old one is near its end.
 * Each request names the API (RFC 8707). Without that name, the sign-in server gives access that the API refuses.
 * @param {Io} io @param {string} base The API address. @returns {() => Promise<string>}
 */
export function accessToken(io, base) {
  /** @type {SignIn | undefined} */ let now;
  return async () => {
    now ??= readSignIn(io.env);
    if (!now) throw new ApiError(`The saved sign-in is gone. ${AGAIN}`);
    if (now.expires_at - EARLY_MS > Date.now()) return now.access_token;
    if (!now.refresh_token) throw new ApiError(`Your sign-in ended. ${AGAIN}`);
    const { ok, body } = await call(io, now.token_endpoint, { grant_type: "refresh_token", refresh_token: now.refresh_token, client_id: CLIENT_ID, resource: base });
    if (ok) {
      now = signInFrom(body, now);
      saveSignIn(io.env, now);
      return now.access_token;
    }
    // Each use replaces the saved sign-in. Another frontmost command can get there first, and then its copy is the good one.
    const other = readSignIn(io.env);
    if (other && other.refresh_token !== now.refresh_token && other.expires_at - EARLY_MS > Date.now()) return (now = other).access_token;
    throw new ApiError(`Your sign-in ended. ${AGAIN}`);
  };
}

/**
 * Open a page in the person's browser. @param {string} url
 * @returns {Promise<boolean>} False when this computer has no browser to open.
 */
export function openBrowser(url) {
  const [command, ...args] = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["rundll32", "url.dll,FileProtocolHandler", url] : ["xdg-open", url];
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
}
