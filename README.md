# Frontmost AI CLI

See how AI apps answer your buyers' questions, from the terminal.
Read your visibility, rivals, sources, and answers. Add and change the questions that Frontmost AI asks.

## Install

You need Node.js 22.12 or later.

```bash
npm install -g github:frontmost-ai/cli
```

## Sign in

1. Create an API key on the [Team page](https://app.frontmost.ai/team).
2. Run `frontmost login` and paste the key.

In scripts and CI, set `FRONTMOST_API_KEY` instead. The CLI also reads `FRONTMOST_API_KEY` from a `.env` file in the current folder.

A Read Only key can run all the commands under **Read**. The commands under **Change** need a Read and Write key.

## Commands

### Read

| Command | Result |
| --- | --- |
| `frontmost whoami` | Your workspace, plan, and limits |
| `frontmost projects` | Your projects |
| `frontmost projects get [project-id]` | One project |
| `frontmost scans` | Delivered scans, newest first |
| `frontmost metrics` | Visibility, Win Rate, Position, and Sentiment |
| `frontmost rivals` | Rivals that the answers named, most named first |
| `frontmost sources` | Sites that the answers cited, most cited first |
| `frontmost answers` | Answers, without their text |
| `frontmost answers get <id>` | One answer with its text and citations |
| `frontmost questions` | The questions of the project |
| `frontmost recommendations` | Recommendations, open first |

### Change

| Command | Result |
| --- | --- |
| `frontmost projects create <domain>` | Create a project from a website |
| `frontmost projects update [project-id]` | Rename a project, or start or stop its daily scans |
| `frontmost questions add "<question>"...` | Add one or more questions |
| `frontmost questions update <question-id>` | Reword, move, pause, or resume a question |
| `frontmost profiles add <name>` | Add a buyer profile |
| `frontmost profiles update <id>` | Rename or describe a buyer profile |
| `frontmost profiles remove <id>` | Remove a buyer profile. Its questions stay |
| `frontmost recommendations done <id>` | Mark a recommendation done |
| `frontmost recommendations dismiss <id>` | Dismiss a recommendation |
| `frontmost recommendations reopen <id>` | Open a recommendation again |

Run `frontmost <command> --help` to see the options of one command.

## Examples

```bash
# This week against last week, for unbranded questions
frontmost metrics --period week --questions unbranded

# Answers in ChatGPT that did not name you
frontmost answers --app chatgpt --no-named

# Every source, as JSON
frontmost sources --all --json

# Add two questions under one topic
frontmost questions add "Which CRM is best for agencies?" "Which CRM has the best reporting?" --topic CRM

# Pause a question
frontmost questions update 412 --no-active
```

## Projects

When your workspace has one project, the CLI uses it. When it has more, name the project:

```bash
frontmost projects
frontmost metrics --project 12
```

You can also set `FRONTMOST_PROJECT` in the environment or in `.env`.

`frontmost projects create` takes a few minutes, because Frontmost AI reads the website and writes the first questions. The command waits and then prints the project. Add `--no-wait` to return at once.

## AI agents and scripts

- Set `FRONTMOST_API_KEY`. No sign-in step is needed.
- Add `--json` to every command. The output is the API response, unchanged. Errors go to stderr as JSON.
- Add `--all` to get every page of a list.
- Exit code `0` is success. `1` is an API or network error. `2` is a wrong command, option, or setting.
- `frontmost api [METHOD] <path>` calls any route of the [API](https://app.frontmost.ai/docs/api.md).

Without `--json`, the output is a table on a terminal and tab-separated text in a pipe.

## Where the key comes from

The CLI uses the first key that it finds:

1. `--api-key`
2. `FRONTMOST_API_KEY` in the environment
3. `FRONTMOST_API_KEY` in `.env` in the current folder
4. The key that `frontmost login` saved

`frontmost logout` removes the saved key. See [SECURITY.md](SECURITY.md) for how the CLI protects the key.

## Development

```bash
npm install
npm test
npm run typecheck
```

The commands and options come from [`openapi.json`](openapi.json), a copy of the live API description. When the API gets a new route or option, run `npm run check-spec -- --write` and the CLI has it.

## License

MIT
