# The `oqas` command

`oqas` is Open QA Stack in a terminal. In a test repository that holds `oqas.json` — which `oqas --ui` sets up step by step in a folder that has none — it opens a session — it maps the target application, designs Playwright tests on a new local branch, runs them, and gives a verdict per test — and reads, follows, speaks to and interrupts the sessions of that repository. Nothing is pushed.

```sh
oqas
```

In a terminal, `oqas` alone opens [a conversation](#the-conversation): say what to test, watch the agents work, speak to them, stop them. A script, or anything that is no terminal, opens a session with a brief and reads its lines:

```sh
oqas --environment local --brief "Test the search of a customer and their profile."
```

To watch the agents work in a browser, serve the console of the same test repository:

```sh
oqas --ui
```

The command is a presentation of [the operations on sessions](../../../packages/engine/docs/engine.md#the-operations-on-sessions) of the engine, on the database of the instance: the same operations [the API](../../api/docs/sessions.md) says in HTTP, on the same database. A session opened in a terminal is listed, followed, spoken to and interrupted from the console of a server started on the same test repository, and a session opened from the console is listed, followed, spoken to and interrupted from a terminal.

## Commands

| Command | What it does |
| --- | --- |
| `oqas` | In a terminal, opens [the conversation](#the-conversation), where sessions are opened, followed, spoken to and stopped, until the person leaves. |
| `oqas --brief <text>` | Opens a session, runs it in this process, follows it to its end, and exits with [the code of its run](#exit-codes). |
| `oqas sessions` | Lists the sessions of the test repository, the latest first. |
| `oqas show <session>` | Prints a session and its thread so far. |
| `oqas attach <session>` | Follows a session to its end, whoever runs it, and exits with the code of its run. A session that ended is printed whole, at once. |
| `oqas say <session> <text>` | Says something to the agents of a session that goes on: see [Speaking to a session](#speaking-to-a-session). Goes on with a session that ended: see [Going on with a session that ended](#going-on-with-a-session-that-ended). |
| `oqas stop <session>` | Interrupts a session that goes on: see [Stopping a session](#stopping-a-session). |
| `oqas config show` | Prints the configuration in force, and how `oqas.json` stands to it: see [The configuration](#the-configuration). |
| `oqas config import` | Takes `oqas.json` as the configuration in force, when it changed. |
| `oqas config export` | Writes the configuration in force over `oqas.json`, when it changed. |
| `oqas model` | In a terminal, sets the connection to the model step by step: see [The model](#the-model). |
| `oqas model status` | Tests the connection to the model in force, and lists the models it offers: see [The model](#the-model). |
| `oqas model set` | Sets the connection to the model — the GitHub account of the machine, or a provider and its key — then tests it. |
| `oqas knowledge list` | Lists the knowledge sources of the configuration in force, and the documents the instance keeps: see [The knowledge](#the-knowledge). |
| `oqas knowledge add-document <source> <file>...` | Uploads Markdown files as documents of a source declared `"stored": true`. |
| `oqas knowledge mapping` | Tells where the cartography of the knowledge stands, source by source, and its index. |
| `oqas knowledge check [<source>]` | Tests that the knowledge sources answer, or one of them, without the model and indexing nothing. |
| `oqas applications check [<application>]` | Tests that each address of the environments answers, of every application or of one, without the model and writing nothing. |
| `oqas knowledge remap [<source>]` | Maps the knowledge again, one source or every source, in a session it follows to its end. |
| `oqas secrets` | Lists the variables the configuration names, and where the value of each comes from: see [The values of the variables](#the-values-of-the-variables). |
| `oqas secrets set <variable>` | Saves the value of one of them on this machine, out of the test repository, typed unseen or read from the input. |
| `oqas --ui` | Serves the console of the test repository in a browser, and runs the sessions opened in it, until Ctrl-C: see [The console](#the-console). |
| `oqas --init` | Makes a Playwright project of the test repository and runs nothing: see [Initialising a test repository](#initialising-a-test-repository). |
| `oqas --help` | Prints the usage. |

`<session>` is the identifier of a session, such as `session-2026-11-16T08-12-45-120Z-9f3a1c2b`, or the start or the end of it when no other session shares it: `9f3a1c2b` is enough. `oqas --brief` prints the identifier of the session it opens on its first line, on the error output, and `oqas sessions` lists them.

The commands that act on a session that exists run from any terminal, and from any program: they ask nothing, read the database or write to it, and leave. They host nothing: `sessions`, `show` and `attach` only read, `say` and `stop` leave in the database what the process that runs the session then acts on. `say` to a session that ended is the one exception: it resumes the session, and runs its new turn itself.

## Options

| Option                  | Default                       | What it does |
| ----------------------- | ----------------------------- | ------------ |
| `--repository <folder>` | the current folder            | The test repository, which holds `oqas.json` once it is set up. Every command takes it. With `--ui`, a folder that does not exist yet is made, and the project is set up in it. |
| `--environment <name>`  | the only environment declared | With `--brief`, and in the conversation: the environment the sessions run against. With several declared, it must be given. |
| `--brief <text>`        |                               | What to test, in your words: a domain, a ticket, a rule, a journey. The designer looks up what echoes it in the index, explores, and plans its tests from it. |
| `--follow`              | off                           | With `--brief`, `attach` and `show`: prints what the agents do besides what the harness tells of the session: see [The thread](#the-thread). |
| `--output text\|json`   | `text`                        | How the command prints: lines a person reads, or [JSON Lines](#json-output) a program reads. Every command but `--init` takes it. |
| `--ui`                  |                               | Serves [the console](#the-console) and prints its address. It takes `--repository`, `--host` and `--port`, and nothing of a session: with `--brief`, `--environment`, `--follow`, `--output` or a command, it is refused with `3`. |
| `--host <address>`      | `127.0.0.1`                   | With `--ui`: the address to listen on. The default is this machine alone, and should stay so: the console asks nobody who they are. |
| `--port <number>`       | `6727`                        | With `--ui`: the port to listen on, from 0 to 65535. `0` takes any free port, which the address printed tells. A port that is taken is refused with `3`. |
| `--github`              |                               | With `model set`: reach the model with the GitHub account this machine signed in with, for GitHub Copilot. |
| `--provider <provider>` |                               | With `model set`: the name of a provider the console lists, whatever its case, or the address of an OpenAI-compatible server. |
| `--key-env <variable>`  | that of the provider          | With `model set` and `--provider`: the variable that holds the key. A server reached by its address has none unless it is named. |
| `--model <id>`          |                               | With `model set`: the model to use, as the connection names it. |
| `--no-input`            |                               | Never asks anything on the terminal: `oqas` without a command then opens no conversation, and is refused with `3`. A command with `--brief` asks nothing, with or without it. |

`oqas` without `--brief`, without `--ui` and without a command opens the conversation, and only in a terminal: when its input or its output is none — a pipe, a file, a job of a pipeline — or with `--no-input`, `--follow` or `--output`, it is refused with `3`, in a message that names `--brief`.

## The conversation

`oqas`, in a terminal, opens a conversation on the test repository. It is one more presentation of the same operations, on the same database: what it shows of a session is what [the console](#the-console) shows, grouped the same way, and a session opened in one is followed in the other. As the console does, it [maps the knowledge that waits](../../../packages/engine/docs/engine.md#the-knowledge-mapped-as-it-is-added): a source with no card yet is mapped in a session of its own, listed as such; `oqas --brief` maps what its session reads first, as before.

```text
Open QA Stack · tests
/work/tests
environment local · database SQLite

Latest sessions
  9f3a1c2b  tests passed  Test the search of a customer and their profile.

›  What do we test?
  Enter open a session · / commands · Ctrl-C quit
```

It speaks the language of the configuration in force, `language` of `oqas.json`, English by default, as the console does: its words are those of [i18next](https://www.i18next.com), one JSON file per language under `src/conversation/i18n/`, with the same keys in each. What the agents and the harness wrote is shown as they wrote it.

Type what to test and press Enter: a session opens, against the environment `--environment` names or the only one declared, and runs in this process, as with `--brief`. Its thread is written as it goes:

- **Who speaks.** You, the cartographer, the planner, the writer, the reviewers and the harness each have a mark and a name, written once for what they say and do in a row.
- **The phases**, each as a rule across the terminal: the configuration, the cartography, each plan with its level, the writing of each test, the run of the tests, the summary.
- **What an agent does**, a line per action: a spinner while its tool has not answered, then whether it passed, failed or simply ended, and how long it took. An action that failed says why on a second line. A long line is cut, with an ellipsis.
- **The scope of the session**, at its head, once its configuration is resolved: the levels of the pyramid of tests asked, which alone are designed, the applications and the environment, and that `design.levels` in `oqas.json` sets the levels.
- **The verdicts**, of the harness and of the reviewers alike, in one form: the author under its mark, `automatic check` for the harness or `agent` for a reviewer, then what it came to and what it is about on the same line — the code of the gate, the phase, the scenario and the tool of a refusal, what a reviewer reviewed — and under it what it says in full: what was refused, what to do and the page it quotes, or each remark.
- **What the harness decides.** A plan it accepted is written in full, each scenario with what it verifies, its facts, its sources, its data and each step with the texts it expects the screen to show or no longer show; its notes are muted lines.
- **The end**: the verdict of each test, then how the session ended, how long it took, how many requests it sent to the model, how many tests passed and the branch they were written on.

What is finished goes to the scrollback of the terminal, which scrolls and searches it as any other output; only what may still change — an action that goes on, a message no agent took yet — is redrawn, above the input.

While the session goes on, what you type is said to its agents, as [`oqas say`](#speaking-to-a-session) does: the message is shown with its number, `waiting for an agent`, then `delivered to` the agent that took it. Above the input, a line says how the session stands, the phase it is in, the agent at work and how long ago it was opened. Once it ended, what you type goes on with it, as [`oqas say`](#going-on-with-a-session-that-ended) does: a new turn starts on your words, in this terminal, and its thread follows under the end of the turn before. `/new` goes back to the start, where what you type opens another session.

| Command | What it does |
| --- | --- |
| `/sessions` | Lists the latest sessions; the arrows select one, Enter reopens its thread. A session that goes on is followed, whoever runs it. |
| `/new` | Goes back to the start, to open another session. A session this terminal runs goes on, and the next one waits its turn. |
| `/stop` | Stops the session on screen, after a confirmation: Enter stops it, Esc keeps it going. |
| `/ui [port]` | Serves [the console](#the-console) from this process, on `127.0.0.1` and the port given — `6727` by default, `0` for any free one — and writes its address. It is served until you leave. |
| `/model` | Sets the connection to the model step by step, as `oqas model` does: see [The model](#the-model). Followed by `status` or `set` and its options, it runs `oqas model status` or `oqas model set`. |
| `/config show\|import\|export\|history\|check` | Runs [`oqas config`](#the-configuration) with the same words. |
| `/knowledge list\|mapping\|check\|add-document …` | Runs [`oqas knowledge`](#the-knowledge) with the same words. |
| `/tests …` | Runs [`oqas tests`](#the-tests-and-their-executions) with the same words. |
| `/launch …` | Runs [`oqas launch`](#launching-tests) with the same words, in the process of the conversation: the input stays free while the tests run, and their execution is told once they ended. |
| `/campaigns …` | Runs [`oqas campaigns`](#campaigns) with the same words; `/campaigns launch` runs in the process of the conversation, as `/launch` does. |
| `/executions …` | Runs [`oqas executions`](#the-tests-and-their-executions) with the same words. |
| `/secrets` | Runs [`oqas secrets`](#the-values-of-the-variables): the variables the configuration names, and where the value of each comes from. `/secrets set <variable>` opens a field over the input, where the value is typed unseen, then saved as `oqas secrets set` saves it; Esc leaves, and nothing is saved. |
| `/repository` | Runs [`oqas repository`](#the-configuration). |
| `/init` | Runs [`oqas --init`](#initialising-a-test-repository). |
| `/help` | Lists the commands and the keys. |
| `/quit` | Leaves the conversation. |

`/config`, `/knowledge`, `/tests`, `/launch`, `/campaigns`, `/executions`, `/secrets`, `/repository`, `/init` and `/model` followed by words run the code of the command, on the operations the conversation holds, and write the same lines in the thread — in English, as the command writes them —, marked with ✗ when the command did not do all it was asked. What the command refuses, the conversation refuses on the line under the input, with the same words, and so does it refuse `--repository`, `--output` and `--follow`, which it sets itself.

A slash lists the commands as you type; Tab completes the first of them, and the start of a name is enough when no other command shares it.

| Key | What it does |
| --- | --- |
| Enter | Opens a session with what you typed, says it to the agents of the session that goes on, or goes on with the session on screen once it ended. |
| Tab | Completes the command you are typing. |
| Up, Down | Move in the list of the sessions. |
| Esc | Closes the list of the sessions, the confirmation of a stop, or the setting of the model. |
| Ctrl-C | Closes what stands over the input, or clears what you typed. Otherwise, as in the terminal of `oqas --brief`: the first asks the session on screen to stop, when this terminal runs it and it goes on, and the conversation stays to show its end; pressed again at once, it leaves without waiting. Where there is nothing to stop — at the start, on a session that ended, on one another process runs — the first says to press again, and the second leaves. Any other key in between starts over. |

**A session another process runs** — another terminal, a server, the console — is reopened with `/sessions`, followed, spoken to and stopped with `/stop`, through the database, as `oqas attach`, `say` and `stop` do. Ctrl-C never stops it: it is left to its process.

**Leaving** stops what this process hosts: with `/quit`, a session it still runs is asked to stop and awaited up to ten seconds; with a second Ctrl-C it is not awaited, and is left as a second Ctrl-C leaves that of `oqas --brief`. The console `/ui` started stops with it. The conversation then exits with [the code](#exit-codes) of the last session it opened — `5` when that session had not ended — and with `0` when it opened none.

**What fails** is told in the thread, in the words the other commands use, and the conversation goes on: a session that no longer goes on and takes no message, a port that is taken, a database that stopped answering. A database that cannot be reached when the command starts is told on the error output, and no screen is drawn.

**The terminal.** The conversation is laid out for 60 columns and more; a text wraps at the width of the terminal, and what must stay on one line is cut. It draws no colour when `NO_COLOR` is set or the terminal is `dumb`: nothing is told by colour alone, each speaker has its mark and each state its glyph. It draws its marks, its rules and its spinner in ASCII unless the locale — `LC_ALL`, `LC_CTYPE` or `LANG` — names UTF-8; what a thread itself holds is written as it is.

## Where the sessions are kept

The sessions, their events and the messages sent to them are kept in [the database of the instance](../../../packages/store/docs/database.md): a SQLite file in the state folder of the test repository, `.oqas/oqas.db` unless `oqas.json` names another state folder, which the command makes when it is missing — or the database `OQAS_DATABASE_URL` names, when the variable is set. It is the database a server started with the same settings uses, which is all it takes for the two to show the same sessions. A SQLite file is brought to the schema of the version that opens it; a PostgreSQL server is not: the command stops with `3` when migrations are pending on it, and says to apply them with [the migration command](../../../packages/store/docs/database.md#migrations).

A command writes no other file of its own: no journal, no state, no inbox. What stays in the state folder beside the database is what the agents and the tests write, in every host: the cards and the domain index under `index/`, the plan and the state of each design under `designs/`, the traces of the agents under `traces/`, what Playwright wrote when each test was tried under `trials/`, and when the tests ran together under `runs/run-<date>/`. To keep the thread of a session as a file, export it:

```sh
oqas show 9f3a1c2b --output json > session.jsonl
```

## The thread

`oqas --brief` and `oqas attach` print the thread of the session on the error output while it grows, and what the session came to on the standard output once it ended; `oqas show` prints both on the standard output, the session first.

What the harness tells of a phase is always printed, as `[phase]` then what happened; what a person and the harness do to the session is printed after its time:

```text
Session session-2026-11-16T08-12-45-120Z-9f3a1c2b
08:12:45 person: Test the search of a customer and their profile.
08:12:45 session running
[configuration] started
[configuration] scope: environment local; applications shop; levels smoke, functional, business
[configuration] The configuration is valid; the run targets the environment local.
[prerequisites] started
[plan] The plan was accepted: search-customer, open-profile.
[write] started: search-customer
08:19:02 scenario search-customer closed: passed
[execution] passed: customer-management › search-customer.spec.ts:3 › finds a customer by last name.
[summary] The summary of the run was written.
08:21:30 session completed
```

`[phase] error:` opens a refusal of the harness or an error of the run, with the code of the gate that refused when one did, such as `[plan] error: [PLAN-ELEMENT] …`.

With `--follow`, what the agents do is printed too, each on one line cut to 160 characters; the event holds more, and `--output json` gives it:

```text
08:14:07 harness to the planner: Plan Playwright tests for the environment local. Brief of the developer, in their words: …
08:14:20 planner -> shop_fill({"target":{"role":"textbox","name":"Search"},"value":"Mira"})
08:14:20 <- {"url":"http://localhost:3010/orders","code":"await page.getByRole(\"textbox\", …
08:14:22 !! The arguments do not match the schema of shop_click…
08:14:58 planner: The plan covers the search and the profile.
```

`->` is a call of a tool by an agent with its arguments, `<-` its answer, `!!` an answer that is a failure, `planner:` what an agent wrote, `planner thinks:` what it thought when the model gives it, `harness to the writer:` what the harness asked of an agent. Times are in UTC. The secrets of the configuration are masked in every event before it is kept.

Once the session ended, the standard output holds what it came to:

```text
Session session-2026-11-16T08-12-45-120Z-9f3a1c2b: completed, passed, in 512.3 s and 81 model requests.
Tests written on the branch oqas/design-20261116T081401Z.
passed        customer-management › search-customer.spec.ts:3 › finds a customer by last name
passed        customer-management › open-profile.spec.ts:3 › opens the profile of a customer
```

A session that is `completed` says how — `passed`, `failed`, `inconclusive` or `stopped` — then what it took, the branch of its tests and the verdict of each. A session that was `interrupted` has no result: its thread says why.

`oqas sessions` prints a line a session: its identifier, how it stands, when it was opened, and what was asked.

```text
session-2026-11-16T08-30-02-511Z-0b7e9f3a  running  2026-11-16T08:30:02.511Z  Test the returns.
session-2026-11-16T08-12-45-120Z-9f3a1c2b  completed, passed  2026-11-16T08:12:45.120Z  Test the search of a customer and their profile.
```

## JSON output

With `--output json`, the standard output holds JSON Lines and nothing else; what a person is told besides — the identifier of the session opened, a warning — goes to the error output.

| Command | What each line is |
| --- | --- |
| `oqas --brief`, `oqas attach`, `oqas show` | An event of the thread of the session, in the order of their ranks, in the format of [the contract of sessions](../../api/docs/sessions.md): `id`, its rank from 1, `at`, `type`, then what the type carries. Every event is printed, `--follow` or not. `--brief` and `attach` print each as it is told, and end after the `state_changed` that ends the session. |
| `oqas sessions` | A session, as the API serves it: `id`, `purpose` for a session that maps the knowledge, `request`, `environment`, `openedAt`, `lastEventAt`, `state`, and `result` once it is completed. |
| `oqas say` | The receipt of the message: `{"number":2}`; for a session that ended, the events of its new turn, as `--brief` prints them. |
| `oqas stop` | The session as it is once the interruption is asked. |

```sh
oqas --brief "Test the returns." --output json | jq -c 'select(.type == "scenario_closed")'
```

A program reads an event whose type it does not know as one to ignore: types are added over time.

## Initialising a test repository

`oqas --init` makes a Playwright project of a test repository, from [its configuration](#the-configuration): the revision in force, or `oqas.json` taken as the first revision on an instance that keeps none. It is a program, not an agent: it calls no model, installs nothing and needs none of the secrets a run reads. In a folder that is no git repository, it makes one and commits what it created, and `oqas.json` when there is one, as `chore: set up the test repository`, signed by the git identity of the machine or, without one, by `Open QA Stack <oqas@localhost>`; in a git repository, it commits nothing.

| File | What it holds |
|---|---|
| `package.json` | `@playwright/test` at the exact version the browser tools of the agents run with, TypeScript and the types of Node.js, and the scripts: `test`, one per level of the pyramid of tests (`test:smoke`, `test:functional`, `test:business`, `test:cross-application`, `test:end-to-end`), `test:read-only`, `report` and `typecheck`. |
| `playwright.config.ts` | One Playwright project per application of `oqas.json`, read when the tests run; the list, HTML and JUnit reports; the trace and a screenshot kept for a failed test; no retry. |
| `tsconfig.json` | Strict types, for the tests and the configuration. |
| `.gitignore` | The dependencies and what a run leaves in the state folder. |
| `README.md` | The layout, how to run the tests, by application, by level or by tag, and what to read when one fails. |
| `<apps>/shared/fixtures.ts` | The `test` and the `expect` every test imports, with each application as a fixture that holds its page objects. Not written when `design.architecture` is `standalone`. |
| `<apps>/<application>/pages/index.ts` | The file that gathers the page objects of an application, which the design fills. |
| `.github/workflows/tests.yml` | What is verified of the tests on a pull request without an environment: their types, and that Playwright lists them all. |

The folder of each application is created too. **A file the repository already has is kept as it is, never overwritten**: the command says which it created and which it kept, is safe on a repository a team set up, and may be run again. It ends with `0`, or with `3` when `oqas.json` is missing or invalid. `--init` takes `--repository` and nothing else.

Then install, and commit what a repository that was one already now holds, lockfile included:

```sh
npm install
git add -A && git commit -m "chore: initialise the Playwright project"
```

## Steps

The run of a session goes through six steps. Each starts only when the one before succeeded; once the prerequisites passed, the summary runs whatever the end of the others.

1. **Configuration.** The revision in force of [the configuration](#the-configuration) is read, once `oqas.json` is taken when it changed, and validated against the environment; the environment is chosen, and the test charter is resolved. A missing configuration, or a file that changed and is not valid, stops the session before anything else: no model is called, and nothing is written to the repository but the database that keeps the session.
2. **Prerequisites.** The folder is the root of a git repository with a commit, the model server of the configuration answers and takes the key — a key it refuses stops the run with `4`, naming its variable —, `npm` can be run, and the repository is a Playwright project: it has a `playwright.config.ts`. One that has none is [initialised](#initialising-a-test-repository) first.
3. **Cartography.** The sources without an up-to-date card are mapped, `cartography.concurrency` of them at once, then the cards are consolidated into the domain index (see the cartographer of `@open-qa-stack/agents`).
4. **Design.** The dependencies of the test repository and the browsers of its locked version of `@playwright/test` are installed, once for the design and the execution. The tests are then designed in passes, one after the other: one for each level of the pyramid of tests the configuration asks for, from its base to its top, then one for the visual tests. In each pass an agent plans the scenarios of that level alone, from the brief, then another writes the test of each, in a session of its own, each test run against the application before it is kept. A pass commits its tests on a new local branch `oqas/design-<date>`, made from that of the pass before, so that a level is told the tests of the levels below it and builds on them: a scenario a test already covers is set aside. A scenario whose session ends before its test is made to end keeps its last file, classed as unfinished in the design state. With `design.passes` set to `single`, every level is planned in one pass.
5. **Execution.** The tests designed run together, on the machine, with the real runner, except those classed as unfinished or as duplicates of another, which the journal names and which stay in the test repository for a person to decide, and the harness pronounces a verdict per test from the JSON of the reporter (see `docs/pinned-run.md` of `@open-qa-stack/harness`).
6. **Summary.** The messages [sent to the session](#speaking-to-a-session) that no agent received are told, the runtime of the agents is closed, and the session ends with its result: the verdict of each test, the branch, how long it took and how many requests it sent to the model. When the plan says that the brief asks what the application does not allow, the thread says it when the plan is accepted, a line each — `[plan] error: The plan does not cover what the brief asks: Change the address of a customer. No screen offers to edit an address.` — and the file of the plan keeps it under `Not covered`: tests that pass do not mean the brief is covered.

The limits of the autonomy level of the configuration apply to every task. Its guardrail, counted from the start of the run, stops every task of the agents still running when it is reached, at its next call to the model or to a tool, by its duration limit; it bounds neither the installation of the dependencies nor the execution of the tests. A task stopped by a limit is told in the thread with the limit reached, and none of its tests is `passed`. A session whose cartography or design a limit stopped keeps what it produced — the cards made, the plan accepted and the tests kept, on the branch of the design — and says so; it is not resumed: the next session maps only the sources without an up-to-date card, and designs anew.

## The configuration

The configuration of the test repository is kept in [the database of the instance](../../../packages/store/docs/database.md#the-revisions-of-the-configuration), its one source, as revisions, each the whole document with its date and its origin, by [the operations on the configuration](../../../packages/engine/docs/engine.md#the-operations-on-the-configuration). A run reads the revision in force; the console, the conversation and the commands change it. `oqas.json` is a copy of it, as a file: kept with the tests in git, or given to the continuous integration.

- **The file gives an instance its first revision**: the first time a command, a session or the console meets an instance that keeps none, `oqas.json` becomes its first revision, of origin `file`.
- **Afterwards the file is read only when you ask for it**: `oqas config import` takes it, when it differs from the revision in force. A file changed in an editor or by a checkout is not taken otherwise.
- **No change writes the file**: what the console, the conversation or `oqas model set` saves becomes the revision in force, and `oqas.json` then differs from it. `oqas config export` writes it, its keys in the order of the schema: `git diff oqas.json` shows what changed, and it is committed as any other change.
- **A file that is not valid is refused**, and the revision in force kept: `oqas config import` tells the errors of the file, each where it is, and the two ways out — correct the file, or write the revision in force over it with `oqas config export`.

```console
$ oqas config show
Revision 3 of the configuration, saved in the console on 2026-11-18T09:12:45.120Z.
oqas.json differs from it: oqas config export writes the revision in force over it, oqas config import takes it instead.
{
  "formatVersion": 1,
  …
}
```

`oqas config show` writes nothing: when the file differs from the revision in force, it says so, with the two commands that settle it. `import` and `export` print the revision in force once they are done; each does nothing when the file holds it. With `--output json`, each prints the configuration as `GET /api/configuration` gives it: the revision in force, and how the file stands to it. They exit with `0`, or with `3` when the file to take is not valid, or when there is neither a revision nor a file.

`oqas config history` lists the revisions, the latest first, each with its date and where it was made. `oqas config check` checks `oqas.json` without taking it, each error where it is, and exits with `0` when it is valid, with `3` otherwise — and when the file is missing or is no JSON. `oqas project` names the project, as a host on the test repository names it, and its applications; `oqas repository` tells where the test repository stands: whether it is a git repository with a commit, and a Playwright project.

## The model

`oqas model` alone, in a terminal, sets the connection step by step, in the language of the configuration: the person chooses how to reach the model in a list — the GitHub account of this machine, a provider by its name, or another server — types the address of another server and the variable of the key when the connection needs them, and the key itself, unseen, when that variable holds none — it is saved with the connection, out of the test repository —; the connection is tested, and they choose the model among those it offers, or type its name when the server lists none. A connection that does not answer is told with what to do, and may be tested again or changed. Enter records the model chosen, as a revision of origin `command`; Esc leaves, and nothing changes. It exits with `0` once a connection is recorded, with `5` when the person left; with `--no-input`, `--output`, or where there is no terminal, it is refused with `3`. In the conversation, `/model` opens the same setting, and the conversation tests the model in force when it opens: a model that does not answer, or is not among those offered, is told at once, with `/model`.

`oqas model status` tests the connection to the model of the configuration in force, as the console does: it says how the model is reached, whether it answers or what to do when it does not, and the models the connection offers, with whether the model in force is among them.

```console
$ oqas model set --github --model gpt-5
The GitHub account of this machine (GitHub Copilot), model gpt-5.
The model answers, through the GitHub account octo.
2 models are offered:
  gpt-5 — GPT-5
  gpt-5-mini — GPT-5 mini
gpt-5 is among them.
$ oqas model set --provider OpenAI --model gpt-4.1
OpenAI, its key in OPENAI_API_KEY, model gpt-4.1.
OPENAI_API_KEY holds no key: give it with oqas secrets set OPENAI_API_KEY, or set the variable, then run oqas model status again.
```

`oqas model set` takes `--github`, or `--provider` with the name of a provider or the address of a server, and `--model`; a provider of the list gets its address and the variable its key is usually kept in, which `--key-env` replaces. Set again with the same model, the same way, the connection keeps what was tuned on it in the console or in `oqas.json` — whether the model reads images, its effort of reasoning, its wait for an answer —; another model starts without them. It records the connection as a revision of origin `command`, whatever the test then finds: a key not given yet is given afterwards, with `oqas secrets set`, and `oqas model status` tells when the model answers. Both ask nothing, so that a script or an agent can run them: with `--output json`, each prints the connection, what the test found as [the API tells it](../../api/docs/configuration.md#testing-the-connection-to-the-model), and `offered`, whether the model is among those listed, when the connection lists some. They exit with `0` when the model answers and is among those offered, or when the server lists none; with `4` when it does not answer, or is not offered; with `3` when the provider is neither one the list names nor an address.

## The values of the variables

The configuration names the variables that hold the secrets — the key of the model, the connection strings of the databases, the accounts of the tests — and never their values. A value comes from the environment of the process, which wins, as in a CI; or else from the value a person gave on this machine, which `oqas` keeps in the state folder of the test repository, out of git: in the console, beside the variable, in `oqas model`, or with `oqas secrets set`.

```console
$ oqas secrets
SHOP_DB_URL  a connection string, set in the environment
OPENAI_API_KEY  the key of the model, missing
Give a missing value with oqas secrets set <variable>, or in the console (oqas --ui), or set the variable in the environment.
$ oqas secrets set OPENAI_API_KEY
Value of OPENAI_API_KEY (not shown):
OPENAI_API_KEY is saved on this machine, out of the test repository.
```

`oqas secrets set <variable>` asks for the value in a terminal without showing it, and reads it from the input otherwise, without its last line break: `printf %s "$KEY" | oqas secrets set OPENAI_API_KEY`. A value never comes from the arguments, which the history of the shell and the list of the processes keep. A value saved replaces the one saved before, and the next run reads it, whichever process runs it. It is refused, with `3`, for a variable the configuration does not name, an empty one, and one the environment sets. With `--output json`, the list prints `{"secrets":[…]}` as [the API tells it](../../api/docs/configuration.md#secrets).

## The knowledge

The knowledge sources are declared in the configuration, each attached to the applications it describes, or to none for a source of the whole project. A source of `type` `document` declared `"stored": true` holds documents uploaded to the instance rather than files of the test repository: [the database of the instance](../../../packages/store/docs/database.md#the-documents-of-the-knowledge-sources) keeps them, and a session writes them to the state folder, where its agents read them.

```console
$ oqas knowledge add-document underwriting-guides guides/quotes.md guides/claims.md
2 documents were uploaded to underwriting-guides.
  claims.md, 5120 bytes, uploaded on 2026-11-18T09:12:45.120Z
  quotes.md, 2048 bytes, uploaded on 2026-11-18T09:12:45.120Z
$ oqas knowledge list
policy-management-api: OpenAPI contract, http://localhost:8090/v3/api-docs; attached to policy-management.
underwriting-guides: documents the instance keeps; attached to policy-management.
  claims.md, 5120 bytes, uploaded on 2026-11-18T09:12:45.120Z
  quotes.md, 2048 bytes, uploaded on 2026-11-18T09:12:45.120Z
```

`oqas knowledge list` writes nothing; it lists the sources of the configuration in force, which `oqas config import` takes from `oqas.json` when it changed. `add-document` takes the files whose paths it is given, relative to the current folder, each named as its document after the last part of its path, all of them or none, by [the rules of an upload](../../api/docs/knowledge.md#uploading-documents): a document of the same name is replaced. With `--output json`, `list` prints the sources, each with its documents when the instance keeps them, and `add-document` the documents of the source once they are kept. They exit with `0`, or with `3` when the upload breaks a rule — each error is told beside its file — when the source is not declared stored in the configuration in force, or when a file cannot be read.

`oqas knowledge check` tests that each knowledge source of the configuration in force answers, or the one it names, as [the API tests one](../../api/docs/knowledge.md#testing-a-source): without the model, indexing nothing, with the values of the variables saved on this machine.

```console
$ oqas knowledge check
policy-management-api  answers, 42 items
customer-db  does not answer: password authentication failed for user "reader"
underwriting-guides  answers, 2 items
server-log  not tested: logs are read while a session runs
```

It exits with `0` when each answers, with `4` when one does not, and with `3` when the configuration declares no source, or not the one named. With `--output json`, it prints `{"checks":[{"source":…,"check":…}]}`.

`oqas knowledge read <source> <document>` prints a document the instance keeps, and `oqas knowledge remove <source> <document>` removes it; both are refused with `3` for a source or a document the instance does not keep. `oqas knowledge domains` lists the domains the cartography found, each with what it covers.

`oqas applications check` tests that each address of the environments of the applications of the configuration in force answers — that of the interface, those of the APIs —, or of the application it names, as [the API tests one](../../api/docs/configuration.md#testing-an-address-of-an-environment): any HTTP answer within ten seconds, whatever its status, is one. Each line says what is wrong, in words that say what to correct.

```console
$ oqas applications check
policy-management › local › interface  http://localhost:3010/  answers, 200
policy-management › local › backend  http://localhost:8090/  is refused: nothing listens on that port, check the port and that the application runs
customer-core › staging › backend  https://core.staging.exmaple/  names no machine: check the name, often a typo
```

It exits with `0` when each answers, with `4` when one does not, and with `3` when the configuration declares no application, not the one named, or no address. With `--output json`, it prints `{"checks":[{"application":…,"environment":…,"address":…,"check":…}]}`. In the conversation, `/applications check` does the same.

`oqas knowledge remap` maps the knowledge again, as [the API does](../../api/docs/knowledge.md#mapping-the-knowledge-again): the card of the source it names, or of every source, is dropped, and a session that maps the knowledge opens, which this command runs and follows to its end, as `--brief` follows the session it opens. When a session maps the knowledge already, it says which, opens none, and exits with `0`; `oqas attach` follows it. A source the configuration does not declare is refused with `3`. In the conversation, `/knowledge remap` opens the session on screen.

`oqas knowledge mapping` tells where the cartography stands, as [the API tells it](../../api/docs/knowledge.md#where-the-cartography-stands): each source mapped, mapped in part, being mapped or waiting, and the index. It exits with `0`.

## The tests and their executions

`oqas tests` lists the tests of the test repository, a line each: the path of its file, its titles, and its level, domain, functionality and case when its tags give them; then the files whose tests cannot all be listed, two tests that share a title or a syntax error. The configuration in force is brought in step with `oqas.json` first, which says where the applications and the runs are. A test is named by the path of its file, relative to the test repository:

- `oqas tests read <test>` reads it in steps, as the latest run that ran it reported it: what came of it, each step with its state and duration, what the failed assertion expected and received, and whether a trace is kept.
- `oqas tests trace <test> <file>` writes that trace to the file, which `npx playwright show-trace` opens; `oqas tests capture <test> <step> <file>` writes the capture the run attached for the step. Both are refused with `3` when the run kept none.
- `oqas tests executions <test>` lists what came of the tests of the file in the latest executions that ran them; `oqas tests versions <test>` lists their versions, the latest first.

`oqas executions` lists the executions of tests the instance keeps, the latest first, twenty at a time: where each comes from — a session, a campaign or a launch by hand —, when it ran and how many of its tests passed. `--outcome failing` keeps those where a test failed, `--outcome passing` those where none did, and `--before <execution>` starts the page after an execution. `oqas executions show <execution>` prints one, with the verdict and the version of each test, what changed since its last run — a new failure, one that failed already, or a test fixed —, and where and why a test failed. With `--output json`, each command prints what the API answers for the same question.

## Launching tests

`oqas launch [<test>...] --environment <name>` runs tests of the test repository as they are, with no agent: every test, or those of the files named. They run in this process, as a session opened here runs, and the command follows them to their end: each test it finished on the error output, as the runner tells it, then the execution it kept, as `oqas executions show` prints it. The environment may be left out when the configuration declares only one. It exits with `0` when each test passed, `1` when one failed, `2` when one was skipped and none failed, `3` when the launch is refused — another session or launch runs, or the environment is not declared — and `5` when the run kept no execution, with why.

## Campaigns

A campaign is made of tests of the repository chosen one by one, run against one environment until it is closed. `oqas campaigns plan <name> --environment <name>` plans one, with no test yet, and prints its identifier. `oqas campaigns choose <campaign> <test>...` chooses its tests, every test of the files named, while it is planned: they may change until `oqas campaigns ready <campaign>` fixes them. `oqas campaigns launch <campaign>` then launches its tests as [`oqas launch`](#launching-tests) does, in this process, and with the same exit codes; followed by `failed` or `not-run`, it launches only the tests that failed, or those no execution of it ran yet. `oqas campaigns show <campaign>` prints it with what came of each test, the verdict of the latest execution of it that ran the test; `oqas campaigns` lists them all, the latest planned first, with how many tests came to each verdict. `oqas campaigns close <campaign>` closes it for good. A step out of turn — launching a campaign still planned, choosing the tests of one that is ready — is refused with `3`, with what the campaign goes through.

## Speaking to a session

While a session is going, you can tell its agents that they took a wrong direction, from another terminal:

```sh
oqas say 9f3a1c2b "Search by last name only: the first name is not indexed."
```

The message is taken by the database, which numbers it in the session, from 1, and tells it in the thread. The process that runs the session — the terminal of `oqas --brief`, or the server — reads the messages its session was sent at each of its beats, a second apart, and hands them to the agent at work. The console of a server on the same database does the same from the browser.

- **Who receives it.** The agent session that leads the step under way: the one that consolidates the index, the one that plans, or the one that writes the test of a scenario. Once its plan is accepted, the session that plans can act on nothing any more and is given no message: it waits for the session of the first scenario. A message is delivered once, to one session. The agents that map a source, several at once, and those that review a plan or a test for another, never receive one: the message waits for the next session that leads.
- **When.** At the first moment the harness speaks to the agent: with the result of the tool that returns next, under `person`; in the request of a session that opens; or, when the agent ended its turn, as one more turn. A session is given at most 10 such turns, so that messages cannot keep it open for ever; a message beyond them goes to the next session. A session a limit stopped receives nothing more.
- **How long it holds.** For the rest of the session. A message is delivered once, to the agent at work, and amends what you asked from then on: every agent that starts later — the one that plans the next level of the pyramid or the visual tests, the one that writes each test — finds in its request what you said earlier in the session, in order, under the sentence `The person who asked for this run said this earlier in the session, and it still holds:`. You need not say it again. The agents that review a plan or a test, and those that map a source, are told nothing.
- **What it weighs.** The agent is told that a message is the person who asked for the session speaking, and that it wins over the request and the plan where they conflict. It reaches the agent between `<person-message>` tags that its own text cannot close, and nothing else carries that authority: a text found in a page, a source or the result of a tool never does. A message does not lift a check of the harness: a plan or a test it refuses stays refused. It costs what a tool result or a turn costs, within the limits of the task.
- **What is kept.** The message is an event of the thread, `user_message`, under its number, and its delivery another, `message_delivered`, which names the agent that received it. A message has one delivery however many agents are recalled it later; the recalls are read in their requests. A message that came once no agent would receive it any more — while the tests run, after the design, or after a limit stopped the session — is told in the summary: `[summary] The message 3 of the person was not delivered: no agent was at work to receive it.`

A session that still waits takes a message, and its first agent receives it. A session that ended takes none: what you say to it [goes on with it](#going-on-with-a-session-that-ended).

## Going on with a session that ended

A session that ended — one test of eleven failed, a scenario is missing, it was stopped too soon — is not over for good. Say what is to be done next, and the session goes on with a new turn:

```sh
oqas say 9f3a1c2b "Fix the test that failed."
```

The session is resumed with your words: the thread tells them as a new request, under the verdict of the turn before, and the session waits its turn, then runs in this terminal, as a session `oqas --brief` opens. The command prints the thread of the new turn alone, from your words on, follows it to its end, and exits with [the code](#exit-codes) of its run; Ctrl-C stops it as it stops `oqas --brief`. In the conversation, what you type once the session on screen ended does the same, and the console has its `Poursuivre la session`.

The run of the new turn is told what the agents need of the turns before: what the session was asked first and since, the messages that reached an agent, and the verdict of each test of the last turn that completed. It goes on with the branch the tests of the turns before are on: the design checks it out, reads those tests as the tests of the repository, sets aside what they already cover, and commits its own tests on the same branch. The agents write new tests: a test of an earlier turn is not edited in place, and one that failed stays beside the test that replaces it.

## Stopping a session

- **Ctrl-C in the terminal of `oqas --brief`** asks the session to stop: its agents refuse to go on, in the middle of a call to the model, no other step starts, and the session is told `interrupted`. What runs outside the agents and is under way, an installation or the tests, goes to its end first. The command follows the session to that end and exits with `5`. **A second Ctrl-C** leaves at once, with `5`, without waiting: the session is left `running` in the database, marked as left, and is interrupted by the next `oqas stop` or the next process that hosts sessions.
- **`oqas stop <session>`**, from any terminal, interrupts a session that goes on. One that waits is interrupted at once. One that another process runs is asked to stop through the database: that process reads the request at its next beat, within a second, stops the run as above and tells the session interrupted; `oqas stop` returns once the request is kept, and `oqas attach` shows the end. A session whose process died is interrupted at once.
- **Ctrl-C in the terminal of `oqas attach`** stops following, and nothing else: the session goes on.
- **In [the conversation](#the-conversation)**, `/stop` interrupts the session on screen after a confirmation, whoever runs it, and Ctrl-C does what it does in the terminal of `oqas --brief` for a session the conversation runs.

## The console

`oqas --ui` shows the sessions of the test repository in a browser: what each agent thinks, does and hands in, every refusal of the harness, a field to speak to the agents and a way to stop them. It maps the knowledge as it is added: a source saved with no card yet is mapped at once, in a session listed as « Mapping of the knowledge ». It lists the tests of the repository too, application by application, narrowed to a level of the pyramid and to the words of a search, as their files are now.

```text
$ oqas --ui
The console of /work/tests is served at the address below. Ctrl-C stops it.
http://127.0.0.1:6727
```

The address goes to the standard output, alone; what a person is told besides goes to the error output. The command opens no browser.

**In a folder without `oqas.json`**, the console starts all the same, on the database of the default state folder, `.oqas`, and opens on « Get started »: the applications, what the agents may read, the model, then a summary that saves the first configuration, in the database of the instance, and sets the folder up as `--init` does, a git repository with its commit included when it was none. `oqas`, in a terminal, sets such a folder up too, step by step, as the console does: the name of the application, what it exposes and its address; what the agents may read — a contract of the API, the source code, a database, documents —, each source tested as soon as it is added; the model, as `oqas model` sets it, its key typed unseen; then a summary that creates the project, in the language of the terminal, and opens the conversation, where the knowledge is mapped at once. Esc leaves, and nothing is written; in the field of a source, Esc gives that source up. Every other command refuses such a folder with `3`, and says to start with `oqas` in a terminal or `oqas --ui`.

It is not a server to connect to: it is one more presentation of the same operations, on the database the other commands reach. The process of the command serves, on one address, the console at `/` and [the routes of the API](../../api/docs/sessions.md) under `/api` — the application [the API package](../../api/docs/running.md#starting-the-api-from-a-program) starts, given what the command read from its arguments. There is no database to install and nothing else to start.

- **A session opened in the console runs in the process of `oqas --ui`**, one at a time, the next waiting its turn, with the variables of its environment — the key of the model, the test accounts — as `oqas --brief` reads them.
- **A session another terminal runs is shown in it**, followed, spoken to and stopped from it, as from any terminal; and a session opened in the console is listed by `oqas sessions`, followed by `oqas attach`, spoken to by `oqas say` and stopped by `oqas stop`.
- **Ctrl-C stops it**: the streams of the browsers end, the session it runs is asked to stop and is awaited up to ten seconds, its beats are withdrawn, and the command exits with `0`. The sessions that waited stay `queued`, and run when a console or a server is started again on the repository. **A second Ctrl-C** leaves at once, with `5`, without waiting: a session still running is left to the next process that hosts sessions, or to `oqas stop`.
- **It listens on this machine alone**, `127.0.0.1:6727`, unless `--host` and `--port` say otherwise. The console asks nobody who they are: whoever reaches the address reads the sessions, opens one — which runs with the secrets of the environment of the command — and stops one. Do not give it an address others reach; the command warns when it is given one.

The command serves the console as it was last built, the folder `dist` of the package `@open-qa-stack/web`; a console that was not built is refused with `3`, in a message that says to run `pnpm build` at the root of the workspace, which builds the console and the API.

## Several processes on one test repository

A session is run by the process that opened it, and by no other: `oqas --brief` runs the session it opens, in its terminal; a server or `oqas --ui` runs those opened through it, one at a time. Each process that runs sessions beats on them in the database, every second.

- The conversation runs the sessions opened in it, one at a time, as `oqas --brief` runs its own; with `/ui`, the console it serves runs those opened in the browser, in the same process.
- A process that starts leaves the sessions of a process that beats alone. Starting `oqas --brief` while a server runs a session interrupts nothing, and neither does starting a server while a terminal runs one.
- A process that has not beaten for 15 seconds died. The session it left `running` is interrupted by the next process that hosts sessions, at its next beat, or at once by `oqas stop`. The sessions it left `queued` are taken over, and run, by a server or by `oqas --ui`: `oqas --brief` runs the session it opens and no other, and leaves them waiting. Until then such a session reads as it was left: `oqas sessions` lists it `running` or `queued`, and `oqas attach` waits on it; `oqas stop` ends it.
- Two processes that each run a session on the same test repository work in the same folder at the same time, each on the branch of its design: run one at a time on a repository, as a server alone does.

## Exit codes

`oqas --brief`, `oqas attach` and `oqas say` to a session that ended exit with the code of the run of the session, read from how the session ended, and so does the conversation for the last session it opened:

| Code | Meaning                                                                                                                                                                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | The session is completed, `passed`: the whole chain ran, and every test passed.                                                                                                                                                                                              |
| `1`  | The session is completed, `failed`: the whole chain ran, and a test failed.                                                                                                                                                                                                  |
| `2`  | The session is completed, `inconclusive`: the whole chain ran without a failure, but a test was `blocked`, `indeterminate`, `skipped` or `not_run`; or the design gave no test, its plan holding no scenario because no test can do what the brief asks; or the design left a scenario of its plan without a test: the tests it gave are run, and the session does not end as passed. |
| `3`  | The session was interrupted in its configuration: `oqas.json` is missing or invalid, or the environment is not declared. Also, for every command: an argument is wrong, the session named does not exist or is named by several, the session no longer goes on and takes no message nor interruption, `OQAS_DATABASE_URL` is no database URL, or the database is on a server that has migrations pending. |
| `4`  | The session was interrupted in its prerequisites: one of the machine is missing.                                                                                                                                                                                             |
| `5`  | The session did not go to its end: it is completed, `stopped` — no index was written, the dependencies could not be installed, the design gave no test to run or was cut short by a limit, a step stopped on an unexpected error, which the thread tells — or it was interrupted, by Ctrl-C, by `oqas stop`, from the console, or because its process died. Also, for every command: the database cannot be reached, or the command stopped on an unexpected error, which goes to the error output. |

`oqas sessions`, `show`, `say` to a session that goes on, `stop`, `config`, `--init` and `--help` exit with `0` once they did what they were asked, and `oqas model` as [the model](#the-model) says, and so does a conversation that opened no session. A conversation left while the last session it opened still went on exits with `5`. `oqas --ui` exits with `0` once it was stopped, with `5` when it was left at once or could not start, and with `3` when its port is taken or the console is not built.

## The command and the engine

The command holds no rule of a session: it reads its arguments, assembles the database of the instance with [`InstanceDatabase`](../../../packages/store/docs/database.md#the-database-of-an-instance-assembled) of `@open-qa-stack/store` as the API does, gives its stores to the `Sessions` and the `Configuration` of [`@open-qa-stack/engine`](../../../packages/engine/docs/engine.md#the-operations-on-sessions), and says one operation:

| Command | Operation |
| --- | --- |
| `oqas` | In the conversation: `sessions` at the start and for `/sessions`; `open` for a request, `say` for what is typed while a session goes on, `resume` for what is typed once it ended, `events` and then `session` for the thread on screen; `/stop` and Ctrl-C are `interrupt`. |
| `oqas --brief` | `open`, then `events` to the end of the session, then `session`; Ctrl-C is `interrupt`. |
| `oqas sessions` | `sessions`. |
| `oqas show` | `session`, then `thread`. |
| `oqas attach` | `events` to the end of the session, then `session`. |
| `oqas say` | `say`, or `resume` for a session that ended, then `events` and `session`. |
| `oqas stop` | `interrupt`, then `session`. |
| `oqas config` | On the `Configuration` of the engine: `view` for `show`; `synchronise`, then `view`, for `import`; `restore`, then `view`, for `export`. |
| `oqas model` | `synchronise` on the `Configuration` of the engine, then `check` on its `ModelConnection`; `set`, and the setting step by step, save the connection with `save`, of origin `command`. |
| `oqas --init` | `current` on the `Configuration` of the engine. |

`oqas`, `oqas --brief`, `oqas say` and `oqas --ui` are the commands that host — `say` only the session it resumes: each gives the operations its test repository, and stops them, within ten seconds, before it leaves. `oqas --ui` says no operation itself: it starts the REST presentation of `@open-qa-stack/api` in its process, whose routes say them, and loads that package only then — no other command pays for an HTTP server. The conversation is drawn with [Ink](https://github.com/vadimdemedes/ink) and React, which are loaded when it opens and by no other command; its screen is a function of a state that one reducer gives, in `src/conversation/`, in the words of i18next, and what it reads of a thread — the steps and their turns — is the code the console reads it with, in `@open-qa-stack/domain/sessions`.

## What it never does

It pushes nothing, changes no remote nor the git configuration of the repository, and leaves an uncommitted change as it is: the designer refuses to start on a repository with one. It uses no container: the tests run on the machine, at the locked version of `@playwright/test`.
