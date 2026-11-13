// Compare the API description in this repo with the live one. Run with --write to take the live copy.
import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("../openapi.json", import.meta.url);
const live = await (await fetch("https://app.frontmost.ai/api/v1/openapi.json", { redirect: "error" })).json();
const text = `${JSON.stringify(live, null, 2)}\n`;

if (text === readFileSync(file, "utf8")) {
  console.log("openapi.json matches the live API.");
} else if (process.argv.includes("--write")) {
  writeFileSync(file, text);
  console.log("openapi.json updated. Run the tests, then commit it.");
} else {
  console.error('openapi.json is behind the live API. Run "npm run check-spec -- --write", run the tests, then commit.');
  process.exitCode = 1;
}
