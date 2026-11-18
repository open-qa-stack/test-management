# Getting started

From an empty folder to Playwright tests on a branch, on your machine.

## Install

Open QA Stack is run from a clone of this repository, with the Node.js `.nvmrc` names and [pnpm](https://pnpm.io).

```sh
git clone https://github.com/open-qa-stack/test-management.git
cd test-management
pnpm install --frozen-lockfile
pnpm --filter @open-qa-stack/tools exec playwright-core install chromium
```

## Set up your test repository

Your tests live in a git repository of their own, with a commit at least, on a machine that has npm. Put an `oqas.json` at its root — [`packages/domain/examples/lakeside-mutual/oqas.json`](../packages/domain/examples/lakeside-mutual/oqas.json) is a complete one — then make it a Playwright project and commit:

```sh
node <clone>/packages/cli/src/main.ts --repository <test repository> --init
cd <test repository> && npm install && git add -A && git commit -m "chore: initialise the test repository"
```

## Ask for tests

Then ask for tests, in your words:

```sh
export OQAS_MODEL_API_KEY=…   # the variable oqas.json names for the key of the model
node <clone>/packages/cli/src/main.ts --repository <test repository> \
  --brief "search a customer and open their profile" --follow
```

The tests are written on a new local branch of the test repository. Nothing is pushed: you read the branch, and you merge it or not.

The request is a session, kept with its thread in a file of the state folder of your test repository, `.oqas/oqas.db`. While it runs, another terminal lists the sessions, follows one, tells its agents they took a wrong direction, or stops it:

```sh
alias oqas="node <clone>/packages/cli/src/main.ts --repository <test repository>"
oqas sessions
oqas attach 9f3a1c2b --follow          # the end of the identifier is enough
oqas say 9f3a1c2b "Search by last name only: the first name is not indexed."
oqas stop 9f3a1c2b
```

## Watch the agents work

The command line alone needs nothing more. To watch the agents instead of reading their lines, and to ask for tests from a browser, run a server on the same machine, and the console. There is no database to install: the server uses the file the command line does, `.oqas/oqas.db` in the state folder of your test repository, and so shows the sessions you opened from a terminal, as a terminal shows those opened from the console.

Start the server with its test repository, and the console, each in a terminal of its own, from the clone:

```sh
export OQAS_MODEL_API_KEY=…   # the variable oqas.json names for the key of the model
pnpm --filter @open-qa-stack/api build
OQAS_HOST=127.0.0.1 OQAS_PORT=8080 OQAS_REPOSITORY=<test repository> pnpm --filter @open-qa-stack/api start
```

```sh
pnpm --filter @open-qa-stack/web dev
```

Open the address the console prints, and write what to test. The request is a session: the server runs it in your test repository as `oqas --brief` does, and its thread fills while the agents work — what each of them thinks, does and hands in, and every refusal of the harness. A message written under the thread reaches the agent at work, and a session can be interrupted. The tests are written on a new local branch, as with the command line, and nothing is pushed.

The server runs the sessions opened through it one at a time: the next one waits its turn. A session opened with `oqas --brief` runs in its terminal; run one at a time on a test repository. `<test repository>` is an absolute path; without `OQAS_REPOSITORY` the server only shows the sessions it holds. [Running the API](../packages/api/docs/running.md) says how it is configured and how it stops, [sessions](../packages/api/docs/sessions.md) what it serves, and [the database](../packages/store/docs/database.md) what the instance keeps.

An instance that several people share can keep its database on a PostgreSQL server instead: give the server its URL in `OQAS_DATABASE_URL`, and nothing else changes. [The database](../packages/store/docs/database.md#one-schema-two-databases) says how.

## What the repository holds afterwards

A Playwright project a team would have set up by hand, which runs without Open QA Stack:

```
<test repository>/
  oqas.json  playwright.config.ts  package.json  tsconfig.json  README.md
  apps/
    shared/
      fixtures.ts                      the test and the expect every test imports
    customer-management/
      pages/                           one page object per screen
        home.page.ts
        index.ts
      tests/
        customers/                     a folder per domain
          customer-search/             then one per functionality
            search-customer.spec.ts
```

Every test bears the tags of what it is: its level in the pyramid of tests, its domain, its functionality, the applications it acts on, and whether it reads the data of the environment or writes some. `npm run test:smoke`, `npm run test:read-only` and `npx playwright test --grep @domain-<domain>` select them.

## Going further

- [The command](../packages/cli/docs/solo-command.md): every command and option, what each step does, the JSON output, the exit codes.
- [The configuration](../packages/domain/docs/configuration.md): every key of `oqas.json`; [its schema](../packages/domain/schema/oqas.schema.json) is the reference.
- [The test charter](../packages/harness/docs/test-charter.md): the rules every generated test is held to.
- [How the tests are designed](../packages/agents/docs/designer.md): the agents, what the harness checks, what it refuses.
