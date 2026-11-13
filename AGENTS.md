# Rules for the Frontmost AI CLI

This repository is public. Never commit a key, a customer name, or private data.

## What this CLI is

The CLI is a thin client of the Frontmost AI `/v1` API. It has no product logic of its own.

- Commands, options, and help text come from `openapi.json` at runtime (`src/spec.js`).
- `openapi.json` is a copy of `https://app.frontmost.ai/api/v1/openapi.json`. Never edit it by hand.
- A new API route becomes a command with no new code. Never write a command by hand for one route.
- The only hand-written names are in `src/spec.js`: `RENAMES`, `POSITIONAL`, and `SHORTCUTS`. Add one only when the derived command reads badly.
- Zero runtime dependencies. Plain JavaScript with JSDoc types. Node.js 22.12 or later.

## Keep in sync with the API

The API is the source. The CLI follows it. Do these steps after every `/v1` change is live:

1. Run `npm run check-spec -- --write`. It copies the live API description into `openapi.json`.
2. Run `npm run typecheck && npm test`.
3. Run each new or changed command with `--help`. Read the output as a customer.
4. Update the command list in `README.md`.
5. Commit, push, and release (below).

The `spec` job in `.github/workflows/ci.yml` runs `npm run check-spec` each day. A red `spec` job means that the API changed and this repository did not. Fix it the same day.

Do not add an option, a field, or a command that the API does not have. Change the API first.

## Release

1. Set the new version in `package.json`. Use a minor version for new commands and a patch version for fixes.
2. Commit, then `git tag v<version> && git push origin main v<version>`.
3. In `frontmost-ai/homebrew-tap`, open a pull request that sets `url` and `sha256` in `Formula/frontmost.rb` to the new tag, and removes the `bottle do` block.
   Get the hash with `curl -sL <url> | shasum -a 256`.
4. Wait for the `brew test-bot` checks. They build the prebuilt packages.
5. Run `gh workflow run publish.yml --repo frontmost-ai/homebrew-tap -f pull_request=<number>`. It publishes the packages and merges the change.
6. Run `brew update && brew upgrade frontmost && frontmost --version`.

Never push a formula change to the tap's `main` branch directly. A direct push ships no prebuilt package, and the install then needs Xcode tools.

## Checks before each push

- `npm run typecheck && npm test` passes. Chain the push after it with `&&`.
- Output and help use the customer's words: scans, questions, AI apps, rivals, recommendations.
- A key or a sign-in token never appears in output, errors, or logs.
