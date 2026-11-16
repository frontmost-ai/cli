# Frontmost AI CLI

See how AI apps answer your buyers' questions, from the terminal.

```console
$ frontmost

  ” frontmost   Fieldnote · Scale

  Fieldnote
  Scan of Oct 5 · 31 answers · 6 AI apps

  Visibility   32%  ●●●●●●●●●●○○○○○○○○○○○○○○○○○○○○○  10 of 31  ▲ 2 pts
  Win rate      3%  ●○○○○○○○○○○○○○○○○○○○○○○○○○○○○○○   1 of 31  ▼ 10 pts
  Position     2.4  average place when named · was 2

  Named most
    1  Waypoint Notes   18 of 31
    2  Trailbook        16 of 31
    3  Inkfield         15 of 31
    ⋮
    5  You              10 of 31

  Next  frontmost rivals  ·  frontmost answers  ·  frontmost --help
```

Run `frontmost` with no command to see your latest scan. Each dot is one answer. A filled dot is an answer that named you. The example uses sample data.

## Install

On macOS or Linux:

```bash
curl -fsSL https://frontmost.ai/install | bash
```

The installer downloads one program for your system, checks its checksum, and puts it in `~/.frontmost/bin`. It needs nothing else.

With Homebrew:

```bash
brew install frontmost-ai/tap/frontmost
```

With npm (Node.js 22.12 or later):

```bash
npm install -g frontmost
```

## Sign in

```bash
frontmost login
```

Your browser opens. Sign in there, and the CLI is ready. You stay signed in until `frontmost logout`.

On a computer with no browser, such as one that you reach over SSH, run `frontmost login --no-browser`. It shows a code to enter on any device.

In scripts and CI, create an API key on the [Team page](https://app.frontmost.ai/team) and set `FRONTMOST_API_KEY`.

## Commands

**Read.** Any key works.

```
frontmost whoami                 Your workspace, plan, and limits
frontmost projects               Your projects
frontmost projects get           One project
frontmost scans                  Delivered scans, newest first
frontmost metrics                Visibility, Win Rate, Position, and Sentiment
frontmost rivals                 Rivals that the answers named
frontmost sources                Sites that the answers cited, with each site's channel
frontmost answers                Answers in a scan
frontmost answers get <id>       One answer, with its text and citations
frontmost questions              The questions that Frontmost AI asks
frontmost profiles               Your buyer profiles
frontmost recommendations        What to do next
```

**Change.** Needs a Read and Write key.

```
frontmost projects create <domain>          Start tracking a website. Add --apps, --cadence, or --no-weekly-brief
frontmost projects update                   Rename a project, or change its AI apps, cadence, or weekly brief
frontmost questions add "<question>"...     Add questions
frontmost questions update <id>             Reword or move a question
frontmost questions pause <id>              Pause a question. It keeps its history and uses no credits
frontmost questions resume <id>             Ask a paused question again
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

# Ask ChatGPT and Gemini on Monday, Wednesday, and Friday. The reply's run_config.cost.monthly_max is the most credits a month
frontmost projects update --apps chatgpt,gemini --cadence mwf --json

# Review sites that the answers cited
frontmost sources --channel review_sites

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
| Sign in | Set `FRONTMOST_API_KEY`. Or ask the person to run `frontmost login` one time. |
| Output | Add `--json`. You get the API response, unchanged. |
| Paging | Add `--all` to get every page of a list. |
| Errors | With `--json`, errors are JSON on stderr, with a `code` and a `request_id`. |
| Exit codes | `0` success. `1` API or network error. `2` wrong command or option. |
| Any route | `frontmost api [METHOD] <path>` calls the [API](https://app.frontmost.ai/docs/api.md) directly. |

Without `--json`, output is a table on a terminal and tab-separated text in a pipe.
On a terminal, a rate shows its counts: `16% (4/25)`. In a pipe, the counts are separate columns, such as `visibility.numerator`.
In a pipe, one object is one `key<tab>value` line per field, and long text is on one line.
`frontmost` with no command prints the help in a pipe or with `--json`. Only a terminal gets the scan screen.
Color is off in a pipe, with `NO_COLOR`, and with `TERM=dumb`. `FORCE_COLOR=1` turns it on.

## How the CLI signs in

The CLI uses the first of these that it finds:

1. `--api-key`
2. `FRONTMOST_API_KEY` in the environment
3. `FRONTMOST_API_KEY` in `.env` in the current folder
4. The sign-in that `frontmost login` saved

A browser sign-in can read and change, the same as you can in the app. To give a script less, use a Read key.

`frontmost login --with-key` saves an API key in place of a browser sign-in.

The CLI never prints a key or a sign-in. `frontmost logout` removes the saved copy. More in [SECURITY.md](SECURITY.md).

## Contributing

```bash
npm install
npm test
```

Commands and options come from [`openapi.json`](openapi.json), a copy of the live API description. `npm run check-spec -- --write` updates it.

## License

[MIT](LICENSE)
