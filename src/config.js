// Where the API key and the project ID come from.
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { UsageError } from "./errors.js";
import { spec } from "./spec.js";

export const KEYS_URL = "https://app.frontmost.ai/team";
const KEY_SHAPE = /^fmk_[0-9A-Za-z]{32}$/;
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** @typedef {Record<string, string | undefined>} Env */

/** @param {Env} env */
export const configPath = (env) => join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config"), "frontmost", "config.json");

/** @param {Env} env @returns {{ api_key?: string }} */
function readConfig(env) {
  try {
    return JSON.parse(readFileSync(configPath(env), "utf8"));
  } catch {
    return {};
  }
}

/** Save the key so that only this user can read it. @param {Env} env @param {string} key */
export function saveKey(env, key) {
  const file = configPath(env);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify({ api_key: key }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

/** @param {Env} env */
export function removeKey(env) {
  rmSync(configPath(env), { force: true });
  return configPath(env);
}

/**
 * FRONTMOST_API_KEY and FRONTMOST_PROJECT from ./.env. No other name is read.
 * @param {string} cwd @returns {Env}
 */
function dotEnv(cwd) {
  let text;
  try {
    text = readFileSync(join(cwd, ".env"), "utf8");
  } catch {
    return {};
  }
  /** @type {Env} */
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?(FRONTMOST_API_KEY|FRONTMOST_PROJECT)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/** @param {string} key */
export function checkKey(key) {
  if (!KEY_SHAPE.test(key)) throw new UsageError("That is not a Frontmost API key. A key starts with fmk_ and has 36 characters.");
  return key;
}

/**
 * The first key found: --api-key, the environment, ./.env, then the saved key.
 * @param {{ flag?: string, env: Env, cwd: string }} from
 */
export function apiKey({ flag, env, cwd }) {
  const key = flag || env.FRONTMOST_API_KEY || dotEnv(cwd).FRONTMOST_API_KEY || readConfig(env).api_key;
  if (!key) throw new UsageError(`No API key. Create one at ${KEYS_URL}, then run "frontmost login" or set FRONTMOST_API_KEY.`);
  return checkKey(key);
}

/** The project ID from --project, the environment, or ./.env. @param {{ flag?: string, env: Env, cwd: string }} from */
export const projectSetting = ({ flag, env, cwd }) => flag || env.FRONTMOST_PROJECT || dotEnv(cwd).FRONTMOST_PROJECT;

/** The API address. Only the real environment can change it, and only to https or this computer. @param {Env} env */
export function baseUrl(env) {
  const raw = env.FRONTMOST_API_URL || spec.servers[0].url;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new UsageError("FRONTMOST_API_URL is not a URL.");
  }
  const safe = url.protocol === "https:" || (url.protocol === "http:" && LOCAL.has(url.hostname));
  if (!safe || url.username || url.password) throw new UsageError("FRONTMOST_API_URL must start with https://.");
  return raw.replace(/\/+$/, "");
}
