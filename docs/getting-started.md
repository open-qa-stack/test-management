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

Your tests live in a git repository of their own, with a commit at least, on a machine that has npm. Put an `oqas.json` at its root — [`packages/shared/examples/lakeside-mutual/oqas.json`](../packages/shared/examples/lakeside-mutual/oqas.json) is a complete one — then make it a Playwright project and commit:

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

## Watch the agents work

To watch the agents instead of reading their lines, start the API of an instance on the same repository and the console, each in a terminal of its own:

```sh
pnpm --dir <clone> --filter @open-qa-stack/api build
OQAS_HOST=127.0.0.1 OQAS_PORT=8080 OQAS_DATABASE_URL=postgres://oqas@127.0.0.1:5432/oqas \
  OQAS_SOLO_REPOSITORY=<test repository> OQAS_SOLO_COMMAND="node <clone>/packages/cli/src/main.ts" \
  pnpm --dir <clone> --filter @open-qa-stack/api start
pnpm --dir <clone> --filter @open-qa-stack/web dev
```

Open the address the console prints. Each run of `oqas` in the repository is a session: its thread fills while the agents work — what each of them thinks, does and hands in, and every refusal of the harness — and a request written in the console opens a session as `oqas --brief` does. [Sessions](../packages/api/docs/sessions.md) describes what the API serves and where sessions come from today; the API starts without its database, and reports itself not ready until one answers.

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

- [The command](../packages/cli/docs/solo-command.md): its options, what each step does, its exit codes.
- [The configuration](../packages/shared/docs/configuration.md): every key of `oqas.json`; [its schema](../packages/shared/schema/oqas.schema.json) is the reference.
- [The test charter](../packages/harness/docs/test-charter.md): the rules every generated test is held to.
- [How the tests are designed](../packages/agents/docs/designer.md): the agents, what the harness checks, what it refuses.
