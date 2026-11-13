#!/usr/bin/env node
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`Error: frontmost needs Node.js 22.12 or later. This is Node.js ${process.versions.node}.`);
  process.exit(2);
}

// "frontmost answers --all | head" closes the pipe early. That is not an error.
process.stdout.on("error", (e) => process.exit(e.code === "EPIPE" ? 0 : 1));

try {
  const { run } = await import("../src/cli.js");
  process.exitCode = await run(process.argv.slice(2));
} catch (e) {
  console.error(`Error: ${e instanceof Error ? e.message : e}`);
  console.error("This is a fault in the CLI. Report it at https://github.com/frontmost-ai/cli/issues");
  process.exitCode = 1;
}
