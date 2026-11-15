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
