# The `oqas` command

`oqas` is Open QA Stack in a terminal. In a test repository that holds `oqas.json`, it opens a session — it maps the target application, designs Playwright tests on a new local branch, runs them, and gives a verdict per test — and reads, follows, speaks to and interrupts the sessions of that repository. Nothing is pushed.

```sh
oqas --environment local --brief "Test the search of a customer and their profile."
```

The command is a presentation of [the operations on sessions](../../engine/docs/engine.md#the-operations-on-sessions) of the engine, on the database of the instance: the same operations [the API](../../api/docs/sessions.md) says in HTTP, on the same database. A session opened in a terminal is listed, followed, spoken to and interrupted from the console of a server started on the same test repository, and a session opened from the console is listed, followed, spoken to and interrupted from a terminal.

## Commands

| Command | What it does |
| --- | --- |
| `oqas --brief <text>` | Opens a session, runs it in this process, follows it to its end, and exits with [the code of its run](#exit-codes). |
| `oqas sessions` | Lists the sessions of the test repository, the latest first. |
| `oqas show <session>` | Prints a session and its thread so far. |
| `oqas attach <session>` | Follows a session to its end, whoever runs it, and exits with the code of its run. A session that ended is printed whole, at once. |
| `oqas say <session> <text>` | Says something to the agents of a session that goes on: see [Speaking to a session](#speaking-to-a-session). |
| `oqas stop <session>` | Interrupts a session that goes on: see [Stopping a session](#stopping-a-session). |
| `oqas --init` | Makes a Playwright project of the test repository and runs nothing: see [Initialising a test repository](#initialising-a-test-repository). |
| `oqas --help` | Prints the usage. |

`<session>` is the identifier of a session, such as `session-2026-11-16T08-12-45-120Z-9f3a1c2b`, or the start or the end of it when no other session shares it: `9f3a1c2b` is enough. `oqas --brief` prints the identifier of the session it opens on its first line, on the error output, and `oqas sessions` lists them.

The commands that act on a session that exists run from any terminal, and from any program: they ask nothing, read the database or write to it, and leave. They host nothing: `sessions`, `show` and `attach` only read, `say` and `stop` leave in the database what the process that runs the session then acts on.

## Options

| Option                  | Default                       | What it does |
| ----------------------- | ----------------------------- | ------------ |
| `--repository <folder>` | the current folder            | The test repository, which holds `oqas.json`. Every command takes it. |
| `--environment <name>`  | the only environment declared | With `--brief`: the environment to run against. With several declared, it must be given. |
| `--brief <text>`        |                               | What to test, in your words: a domain, a ticket, a rule, a journey. The designer looks up what echoes it in the index, explores, and plans its tests from it. |
| `--follow`              | off                           | With `--brief`, `attach` and `show`: prints what the agents do besides what the harness tells of the session: see [The thread](#the-thread). |
| `--output text\|json`   | `text`                        | How the command prints: lines a person reads, or [JSON Lines](#json-output) a program reads. Every command but `--init` takes it. |
| `--no-input`            |                               | Never asks anything on the terminal. The command asks nothing yet, and the option changes nothing: it is accepted so that a script that sets it keeps working once a session can ask a question. |

A session is always opened by a brief: `oqas` without `--brief` and without a command is refused, with `3`.

## Where the sessions are kept

The sessions, their events and the messages sent to them are kept in [the database of the instance](../../store/docs/database.md): a SQLite file in the state folder of the test repository, `.oqas/oqas.db` unless `oqas.json` names another state folder, which the command makes when it is missing — or the database `OQAS_DATABASE_URL` names, when the variable is set. It is the database a server started with the same settings uses, which is all it takes for the two to show the same sessions. A SQLite file is brought to the schema of the version that opens it; a PostgreSQL server is not: the command stops with `3` when migrations are pending on it, and says to apply them with [the migration command](../../store/docs/database.md#migrations).

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
[configuration] The configuration is valid; the run targets the environment local.
[prerequisites] started
[plan] The plan was accepted: search-customer, open-profile.
[write] started: search-customer
08:19:02 scenario search-customer closed: passed
[execution] passed: customer-management › search-customer.spec.ts:3 › finds a customer by last name.
[summary] The summary succeeded.
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
| `oqas sessions` | A session, as the API serves it: `id`, `request`, `environment`, `openedAt`, `lastEventAt`, `state`, and `result` once it is completed. |
| `oqas say` | The receipt of the message: `{"number":2}`. |
| `oqas stop` | The session as it is once the interruption is asked. |

```sh
oqas --brief "Test the returns." --output json | jq -c 'select(.type == "scenario_closed")'
```

A program reads an event whose type it does not know as one to ignore: types are added over time.

## Initialising a test repository

`oqas --init` makes a Playwright project of a test repository, from its `oqas.json`. It is a program, not an agent: it calls no model, installs nothing, commits nothing and needs none of the secrets a run reads.

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

Then install and commit, lockfile included:

```sh
npm install
git add -A && git commit -m "chore: initialise the Playwright project"
```

## Steps

The run of a session goes through six steps. Each starts only when the one before succeeded; once the prerequisites passed, the summary runs whatever the end of the others.

1. **Configuration.** `oqas.json` is read and validated, the environment is chosen, and the test charter is resolved. A missing or invalid configuration stops the session before anything else: no model is called, and nothing is written to the repository but the database that keeps the session.
2. **Prerequisites.** The folder is the root of a git repository with a commit, the model server of the configuration answers, `npm` can be run, and the repository is a Playwright project: it has a `playwright.config.ts`. One that has none is [initialised](#initialising-a-test-repository) first.
3. **Cartography.** The sources without an up-to-date card are mapped, `cartography.concurrency` of them at once, then the cards are consolidated into the domain index (see the cartographer of `@open-qa-stack/agents`).
4. **Design.** The dependencies of the test repository and the browsers of its locked version of `@playwright/test` are installed, once for the design and the execution. The tests are then designed in passes, one after the other: one for each level of the pyramid of tests the configuration asks for, from its base to its top, then one for the visual tests. In each pass an agent plans the scenarios of that level alone, from the brief, then another writes the test of each, in a session of its own, each test run against the application before it is kept. A pass commits its tests on a new local branch `oqas/design-<date>`, made from that of the pass before, so that a level is told the tests of the levels below it and builds on them: a scenario a test already covers is set aside. A scenario whose session ends before its test is made to end keeps its last file, classed as unfinished in the design state. With `design.passes` set to `single`, every level is planned in one pass.
5. **Execution.** The tests designed run together, on the machine, with the real runner, except those classed as unfinished or as duplicates of another, which the journal names and which stay in the test repository for a person to decide, and the harness pronounces a verdict per test from the JSON of the reporter (see `docs/pinned-run.md` of `@open-qa-stack/harness`).
6. **Summary.** The messages [sent to the session](#speaking-to-a-session) that no agent received are told, the runtime of the agents is closed, and the session ends with its result: the verdict of each test, the branch, how long it took and how many requests it sent to the model. When the plan says that the brief asks what the application does not allow, the thread says it when the plan is accepted, a line each — `[plan] error: The plan does not cover what the brief asks: Change the address of a customer. No screen offers to edit an address.` — and the file of the plan keeps it under `Not covered`: tests that pass do not mean the brief is covered.

The limits of the autonomy level of the configuration apply to every task. Its guardrail, counted from the start of the run, stops every task of the agents still running when it is reached, at its next call to the model or to a tool, by its duration limit; it bounds neither the installation of the dependencies nor the execution of the tests. A task stopped by a limit is told in the thread with the limit reached, and none of its tests is `passed`. A session whose cartography or design a limit stopped keeps what it produced — the cards made, the plan accepted and the tests kept, on the branch of the design — and says so; it is not resumed: the next session maps only the sources without an up-to-date card, and designs anew.

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

A message is refused, with `3`, by a session that ended. A session that still waits takes it, and its first agent receives it.

## Stopping a session

- **Ctrl-C in the terminal of `oqas --brief`** asks the session to stop: its agents refuse to go on, in the middle of a call to the model, no other step starts, and the session is told `interrupted`. What runs outside the agents and is under way, an installation or the tests, goes to its end first. The command follows the session to that end and exits with `5`. **A second Ctrl-C** leaves at once, with `5`, without waiting: the session is left `running` in the database, marked as left, and is interrupted by the next `oqas stop` or the next process that hosts sessions.
- **`oqas stop <session>`**, from any terminal, interrupts a session that goes on. One that waits is interrupted at once. One that another process runs is asked to stop through the database: that process reads the request at its next beat, within a second, stops the run as above and tells the session interrupted; `oqas stop` returns once the request is kept, and `oqas attach` shows the end. A session whose process died is interrupted at once.
- **Ctrl-C in the terminal of `oqas attach`** stops following, and nothing else: the session goes on.

## Several processes on one test repository

A session is run by the process that opened it, and by no other: `oqas --brief` runs the session it opens, in its terminal; a server runs those opened through it, one at a time. Each process that runs sessions beats on them in the database, every second.

- A process that starts leaves the sessions of a process that beats alone. Starting `oqas --brief` while a server runs a session interrupts nothing, and neither does starting a server while a terminal runs one.
- A process that has not beaten for 15 seconds died. The session it left `running` is interrupted by the next process that hosts sessions, at its next beat, or at once by `oqas stop`. The sessions it left `queued` are taken over, and run, by a server: `oqas --brief` runs the session it opens and no other, and leaves them waiting. Until then such a session reads as it was left: `oqas sessions` lists it `running` or `queued`, and `oqas attach` waits on it; `oqas stop` ends it.
- Two processes that each run a session on the same test repository work in the same folder at the same time, each on the branch of its design: run one at a time on a repository, as a server alone does.

## Exit codes

`oqas --brief` and `oqas attach` exit with the code of the run of the session, read from how the session ended:

| Code | Meaning                                                                                                                                                                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | The session is completed, `passed`: the whole chain ran, and every test passed.                                                                                                                                                                                              |
| `1`  | The session is completed, `failed`: the whole chain ran, and a test failed.                                                                                                                                                                                                  |
| `2`  | The session is completed, `inconclusive`: the whole chain ran without a failure, but a test was `blocked`, `indeterminate`, `skipped` or `not_run`; or the design gave no test, its plan holding no scenario because no test can do what the brief asks; or the design left a scenario of its plan without a test: the tests it gave are run, and the session does not end as passed. |
| `3`  | The session was interrupted in its configuration: `oqas.json` is missing or invalid, or the environment is not declared. Also, for every command: an argument is wrong, the session named does not exist or is named by several, the session no longer goes on and takes no message nor interruption, `OQAS_DATABASE_URL` is no database URL, or the database is on a server that has migrations pending. |
| `4`  | The session was interrupted in its prerequisites: one of the machine is missing.                                                                                                                                                                                             |
| `5`  | The session did not go to its end: it is completed, `stopped` — no index was written, the dependencies could not be installed, the design gave no test to run or was cut short by a limit, a step stopped on an unexpected error, which the thread tells — or it was interrupted, by Ctrl-C, by `oqas stop`, from the console, or because its process died. Also, for every command: the database cannot be reached, or the command stopped on an unexpected error, which goes to the error output. |

`oqas sessions`, `show`, `say`, `stop`, `--init` and `--help` exit with `0` once they did what they were asked.

## The command and the engine

The command holds no rule of a session: it reads its arguments, assembles the database of the instance with [`InstanceDatabase`](../../store/docs/database.md#the-database-of-an-instance-assembled) of `@open-qa-stack/store` as the API does, gives its store to the `Sessions` of [`@open-qa-stack/engine`](../../engine/docs/engine.md#the-operations-on-sessions), and says one operation:

| Command | Operation |
| --- | --- |
| `oqas --brief` | `open`, then `events` to the end of the session, then `session`; Ctrl-C is `interrupt`. |
| `oqas sessions` | `sessions`. |
| `oqas show` | `session`, then `thread`. |
| `oqas attach` | `events` to the end of the session, then `session`. |
| `oqas say` | `say`. |
| `oqas stop` | `interrupt`, then `session`. |

`oqas --brief` is the one command that hosts: it gives the operations its test repository, and stops them, within ten seconds, before it leaves.

## What it never does

It pushes nothing, changes no remote nor the git configuration of the repository, and leaves an uncommitted change as it is: the designer refuses to start on a repository with one. It uses no container: the tests run on the machine, at the locked version of `@playwright/test`.
