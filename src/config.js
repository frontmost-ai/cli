// Where the sign-in, the API key, and the project ID come from.
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

/**
 * A browser sign-in. Access lasts minutes. The refresh token gets the next access.
 * @typedef {{ access_token: string, refresh_token?: string, expires_at: number, token_endpoint: string }} SignIn
 */

/** @param {Env} env @returns {{ api_key?: string, sign_in?: SignIn }} */
function readConfig(env) {
  try {
    return JSON.parse(readFileSync(configPath(env), "utf8"));
  } catch {
    return {};
  }
}

/** Save one way to sign in, so that only this user can read it. @param {Env} env @param {{ api_key: string } | { sign_in: SignIn }} saved */
function save(env, saved) {
  const file = configPath(env);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

/** @param {Env} env @param {string} key */
export const saveKey = (env, key) => save(env, { api_key: key });
/** @param {Env} env @param {SignIn} signIn */
export const saveSignIn = (env, signIn) => save(env, { sign_in: signIn });

/** The saved browser sign-in, when the file holds a usable one. @param {Env} env @returns {SignIn | undefined} */
export function readSignIn(env) {
  const s = readConfig(env).sign_in;
  const usable = s && typeof s.access_token === "string" && typeof s.expires_at === "number" && typeof s.token_endpoint === "string" && safeUrl(s.token_endpoint);
  return usable ? s : undefined;
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
 * The first API key found: --api-key, the environment, ./.env, then the saved key. Undefined when there is none.
 * @param {{ flag?: string, env: Env, cwd: string }} from
 */
export function apiKey({ flag, env, cwd }) {
  const key = flag || env.FRONTMOST_API_KEY || dotEnv(cwd).FRONTMOST_API_KEY || readConfig(env).api_key;
  return key ? checkKey(key) : undefined;
}

/** The project ID from --project, the environment, or ./.env. @param {{ flag?: string, env: Env, cwd: string }} from */
export const projectSetting = ({ flag, env, cwd }) => flag || env.FRONTMOST_PROJECT || dotEnv(cwd).FRONTMOST_PROJECT;

/** True for an https address, or an http address on this computer. @param {string} raw */
export function safeUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (url.protocol === "https:" || (url.protocol === "http:" && LOCAL.has(url.hostname))) && !url.username && !url.password;
}

/** The API address. Only the real environment can change it, and only to https or this computer. @param {Env} env */
export function baseUrl(env) {
  const raw = env.FRONTMOST_API_URL || spec.servers[0].url;
  if (!URL.canParse(raw)) throw new UsageError("FRONTMOST_API_URL is not a URL.");
  if (!safeUrl(raw)) throw new UsageError("FRONTMOST_API_URL must start with https://.");
  return raw.replace(/\/+$/, "");
}
