// Entry point for the standalone binaries that install.sh downloads. Only `bun build --compile` reads this file.
// It embeds openapi.json and package.json, because a binary has no files next to it.
import spec from "../openapi.json" with { type: "json" };
import pkg from "../package.json" with { type: "json" };

/** @type {any} */ (globalThis).__FRONTMOST_EMBED__ = { spec, version: pkg.version };
await import("../bin/frontmost.js");
