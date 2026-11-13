// One API request. One retry, only when the API says to slow down.
import { ApiError } from "./errors.js";
import { VERSION } from "./spec.js";

const TIMEOUT_MS = 60_000;
const MAX_RETRY_WAIT_S = 60;

/**
 * @typedef {{ base: string, key: string, fetch: typeof fetch, sleep: (ms: number) => Promise<unknown> }} Client
 * @typedef {{ query?: Record<string, string>, body?: unknown, headers?: Record<string, string> }} Options
 * @typedef {{ status: number, body: any, headers: Headers }} Reply
 */

/**
 * @param {Client} client @param {string} method @param {string} path @param {Options} [options]
 * @returns {Promise<Reply>}
 */
export async function request(client, method, path, options = {}, retried = false) {
  const url = new URL(client.base + path);
  if (url.origin !== new URL(client.base).origin) throw new ApiError("The path must stay on the Frontmost API.");
  for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);

  let res;
  try {
    res = await client.fetch(url, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${client.key}`,
        accept: "application/json",
        "user-agent": `frontmost-cli/${VERSION}`,
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    throw new ApiError(timedOut ? "The API did not answer in 60 seconds. Try again." : `Could not reach ${url.host}. Check the network, then try again.`);
  }

  if (res.status === 429 && !retried) {
    const wait = Number(res.headers.get("retry-after")) || 1;
    if (wait <= MAX_RETRY_WAIT_S) {
      await client.sleep(wait * 1000);
      return request(client, method, path, options, true);
    }
  }

  const text = await res.text();
  let body = null;
  try {
    if (text) body = JSON.parse(text);
  } catch {
    // Not JSON. Only an error reply from outside the API has such a body.
  }
  if (!res.ok) {
    const error = body?.error ?? {};
    throw new ApiError(error.message ?? `The API answered with status ${res.status}.`, { code: error.code, request_id: error.request_id, body });
  }
  return { status: res.status, body, headers: res.headers };
}
