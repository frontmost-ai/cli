import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.js";

export const KEY = `fmk_${"a".repeat(32)}`;
export const OTHER_KEY = `fmk_${"b".repeat(32)}`;

/** @typedef {{ method: string, host: string, path: string, query: Record<string, string>, headers: Record<string, string>, body: any }} Seen */
/** @typedef {{ status?: number, body?: unknown, headers?: Record<string, string> }} Reply */

/**
 * Run the CLI against a fake API. `answer` gets each request and returns the reply.
 * @param {string[]} argv
 * @param {{ answer?: (req: Seen, n: number) => Reply, env?: Record<string, string>, stdin?: string, tty?: boolean, home?: string, open?: (url: string) => Promise<boolean> }} [setup]
 */
export async function cli(argv, { answer = () => ({ body: {} }), env = { FRONTMOST_API_KEY: KEY }, stdin = "", tty = false, home = mkdtempSync(join(tmpdir(), "frontmost-")), open = async () => false } = {}) {
  /** @type {Seen[]} */ const requests = [];
  /** @type {string[]} */ const out = [];
  /** @type {string[]} */ const err = [];
  /** @type {number[]} */ const sleeps = [];
  const code = await run(argv, {
    env: { HOME: home, ...env },
    cwd: home,
    fetch: /** @type {typeof fetch} */ (async (url, init) => {
      const u = new URL(String(url));
      const headers_ = /** @type {Record<string, string>} */ (init?.headers);
      const text = init?.body ? String(init.body) : undefined;
      const sent = text === undefined ? undefined : headers_["content-type"] === "application/json" ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text));
      const seen = { method: init?.method ?? "GET", host: u.host, path: u.pathname.replace("/api/v1", ""), query: Object.fromEntries(u.searchParams), headers: headers_, body: sent };
      requests.push(seen);
      const { status = 200, body, headers } = answer(seen, requests.length);
      return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
    }),
    sleep: async (ms) => sleeps.push(ms),
    out: (text) => out.push(text),
    note: (text) => err.push(text),
    readStdin: async () => stdin,
    readSecret: async () => stdin,
    open,
    tty,
    width: 80,
  });
  return { code, out: out.join("\n"), err: err.join("\n"), requests, sleeps, home };
}

/** @param {unknown[]} data @param {string | null} [next] */
export const list = (data, next = null) => ({ object: "list", data, has_more: next !== null, next_cursor: next });
