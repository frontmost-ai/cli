# Frontmost AI CLI

See how AI apps answer your buyers' questions, from the terminal.

```console
$ frontmost questions
ID  TEXT                                       TOPIC     ACTIVE  IS_BRANDED  PROFILE_ID
5   Which bank is best for freelancers?        Business  true    false       2
4   Which bank has the best business account?  Business  true    false
1   Is Papaya a good bank for a mortgage?                false   true
```

## Install

With Homebrew:

```bash
brew install frontmost-ai/tap/frontmost
```

With npm (Node.js 22.12 or later):

```bash
npm install -g github:frontmost-ai/cli
```

## Sign in

Create an API key on the [Team page](https://app.frontmost.ai/team). Then:

```bash
frontmost login
```

In scripts and CI, set `FRONTMOST_API_KEY` instead.

## Commands

**Read.** Any key works.

```
frontmost whoami                 Your workspace, plan, and limits
frontmost projects               Your projects
frontmost scans                  Delivered scans, newest first
frontmost metrics                Visibility, Win Rate, Position, and Sentiment
frontmost rivals                 Rivals that the answers named
frontmost sources                Sites that the answers cited
frontmost answers                Answers in a scan
frontmost answers get <id>       One answer, with its text and citations
frontmost questions              The questions that Frontmost AI asks
frontmost profiles               Your buyer profiles
frontmost recommendations        What to do next
```

**Change.** Needs a Read and Write key.

```
frontmost projects create <domain>          Start tracking a website
frontmost projects update                   Rename a project, or start or stop daily scans
frontmost questions add "<question>"...     Add questions
frontmost questions update <id>             Reword, move, pause, or resume a question
frontmost profiles add <name>               Add a buyer profile
frontmost profiles update <id>              Rename or describe a buyer profile
frontmost profiles remove <id>              Remove a buyer profile
frontmost recommendations done <id>         Mark a recommendation done
frontmost recommendations dismiss <id>      Dismiss a recommendation
frontmost recommendations reopen <id>       Open a recommendation again
```

`frontmost <command> --help` shows the options of one command.

## Examples

```bash
# This week against last week, unbranded questions only
frontmost metrics --period week --questions unbranded

# ChatGPT answers that did not name you
frontmost answers --app chatgpt --no-named

# Add two questions under one topic
frontmost questions add "Which CRM is best for agencies?" "Which CRM has the best reporting?" --topic CRM

# Pause a question
frontmost questions update 412 --no-active
```

## Projects

With one project, there is nothing to set. With more, name the project:

```bash
frontmost metrics --project 12
```

Or set `FRONTMOST_PROJECT`. `frontmost projects` lists the IDs.

`frontmost projects create` takes a few minutes while Frontmost AI reads the website and writes the first questions. It waits, then prints the project. Add `--no-wait` to return at once.

## AI agents and scripts

| | |
| --- | --- |
| Sign in | Set `FRONTMOST_API_KEY`. |
| Output | Add `--json`. You get the API response, unchanged. |
| Paging | Add `--all` to get every page of a list. |
| Errors | With `--json`, errors are JSON on stderr, with a `code` and a `request_id`. |
| Exit codes | `0` success. `1` API or network error. `2` wrong command or option. |
| Any route | `frontmost api [METHOD] <path>` calls the [API](https://app.frontmost.ai/docs/api.md) directly. |

Without `--json`, output is a table on a terminal and tab-separated text in a pipe.

## Your API key

The CLI uses the first key that it finds:

1. `--api-key`
2. `FRONTMOST_API_KEY` in the environment
3. `FRONTMOST_API_KEY` in `.env` in the current folder
4. The key that `frontmost login` saved

The key goes only to `app.frontmost.ai`. The CLI never prints it, and `frontmost logout` removes the saved copy. More in [SECURITY.md](SECURITY.md).

## Contributing

```bash
npm install
npm test
```

Commands and options come from [`openapi.json`](openapi.json), a copy of the live API description. `npm run check-spec -- --write` updates it.

## License

[MIT](LICENSE)
