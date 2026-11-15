<h1 align="center">Open QA Stack</h1>

<p align="center"><strong>Test campaigns for Playwright, drafted by agents and decided by people.</strong></p>

<p align="center">
  Point it at a test environment and at what you know of your applications.<br>
  It maps them, plans the tests, writes them as a Playwright project you own, runs them, and tells you what each one is worth.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-16181B?style=flat-square"></a>
  <img alt="Node.js" src="https://img.shields.io/badge/node-22-16181B?style=flat-square">
  <img alt="Playwright" src="https://img.shields.io/badge/tests-Playwright-16181B?style=flat-square">
</p>

<p align="center">
  <a href="#how-it-works">How it works</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#what-you-get">What you get</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#the-command">The command</a> ·
  <a href="#development">Development</a>
</p>

---

## The problem

An agent that is told "write Playwright tests for this application" writes tests that pass: locators it guessed, assertions it weakened until they held, the same journey five times under five names. Nobody can tell what such a suite verifies, and nobody keeps it.

Open QA Stack puts a harness between the agents and your test repository. The agents explore, propose and write. The harness holds what they submit to what was really seen: a locator comes from a screen an agent opened, an expected text from what that screen showed, a value from a source that returned it. What cannot be shown is refused, with what to do instead, and every test is run before it is kept.

## How it works

One command runs the chain, on your machine, against a test environment.

1. **Map.** One agent per knowledge source — an OpenAPI contract, a PostgreSQL schema, a folder of documents, a source repository, the logs of a container — writes what the source holds. The functional domains of your applications are drawn from them, and each element is filed under its domain.
2. **Plan.** For each level of the pyramid of tests asked for — smoke, functional, business, cross-application, end-to-end — an agent explores the screens with a real browser and proposes scenarios for that level alone. A scenario that verifies what another scenario, or a test already in the repository, verifies is set aside, with the reason.
3. **Write.** Another agent writes the test of each scenario, from the plan alone. Each test is checked against the plan and the test charter, then run; a test that writes data is run twice, and the step that puts back what it changed runs even when the test fails.
4. **Review.** Two more agents read each test that passed: one against its scenario, one for the quality of its code.
5. **Compare.** A last pass plans visual tests: the states of the screens worth comparing with a reference image, a page reached by a click included.

Each level starts once the one below it is over, and builds on its tests. Nothing is lost on the way: a scenario set aside, a test that fails, a request the application does not allow are kept, each with who decided, why and when.

## Quick start

Open QA Stack is run from a clone of this repository, with the Node.js `.nvmrc` names and [pnpm](https://pnpm.io).

```sh
git clone https://github.com/open-qa-stack/test-management.git
cd test-management
pnpm install --frozen-lockfile
pnpm --filter @open-qa-stack/tools exec playwright-core install chromium
```

Your tests live in a git repository of their own, with a commit at least, on a machine that has npm. Put an `oqas.json` at its root — [`packages/shared/examples/lakeside-mutual/oqas.json`](packages/shared/examples/lakeside-mutual/oqas.json) is a complete one — then make it a Playwright project and commit:

```sh
node <clone>/packages/cli/src/main.ts --repository <test repository> --init
cd <test repository> && npm install && git add -A && git commit -m "chore: initialise the test repository"
```

Then ask for tests, in your words:

```sh
export OQAS_MODEL_API_KEY=…   # the variable oqas.json names for the key of the model
node <clone>/packages/cli/src/main.ts --repository <test repository> \
  --brief "search a customer and open their profile" --follow
```

The tests are written on a new local branch of the test repository. Nothing is pushed: you read the branch, and you merge it or not.

## What you get

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

- **Tests against page objects.** `await customerManagement.home.searchTextbox.fill("Ado")`: a locator that changes is changed once. A page object says where the elements of a screen are; what a test expects stays in the test.
- **Tags on every test**: its level, its domain, its functionality, the applications it acts on, and whether it reads the data of the environment or writes some. `npm run test:smoke`, `npm run test:read-only`, `npx playwright test --grep @domain-customers`.
- **Tests of several applications**, each application in a tab of its own.
- **Visual tests** of the whole page, the zones that change masked by their own locator.
- **Your architecture, when you have one.** A fixtures file already there is kept as it is; `design.architecture` chooses between page objects, fixtures alone, or tests that each stand alone.
- **A plan you can read**, kept in the repository: each scenario with its steps, the code of each, what it expects and where it was seen, and what was set aside.

## Configuration

`oqas.json`, at the root of the test repository, declares the applications, what is known of them, and the model. [Its schema](packages/shared/schema/oqas.schema.json) describes every key.

```json
{
  "formatVersion": 1,
  "applications": [
    {
      "id": "shop",
      "name": "Shop",
      "type": "web",
      "authentication": { "method": "none" },
      "environments": [{ "name": "local", "uiUrl": "http://localhost:3000" }]
    }
  ],
  "knowledge": [{ "id": "shop-api", "type": "openapi", "path": "contracts/shop.json", "attachments": [{ "application": "shop" }] }],
  "model": { "mode": "provider-key", "provider": "openai", "baseUrl": "https://api.openai.com/v1", "model": "<model>", "apiKeyEnv": "OQAS_MODEL_API_KEY" }
}
```

| Key | What it sets |
|---|---|
| `applications` | Each application, its type (`web`, `api`, `web-and-api`), how a user signs in, and where each environment is reached. |
| `knowledge` | The sources the agents read: `openapi`, `postgresql`, `document`, `source-code`, `logs`. |
| `model` | The model the agents run on, and the name of the environment variable that holds its key. A secret is never written in the file. |
| `autonomy` | `autonomous`, or `bounded` by limits a run may not pass; a run a limit stopped is resumed with `--resume`. |
| `design.levels` | The levels of the pyramid of tests asked for; `smoke`, `functional` and `business` by default. |
| `design.passes` | `by-level`, one level after the other, by default; `single`, every level in one plan. |
| `design.architecture` | `page-objects` by default, `fixtures`, or `standalone`. |
| `design.visualTests` | Whether visual tests are designed; `design.visualTolerance` sets the share of pixels that may differ. |
| `design.reviewPlan`, `reviewTests`, `reviewCode` | Whether each reviewer reads what it reviews; all three by default. |
| `charter` | Rules of the default test charter to leave out, with the reason, and rules of your own to add. |

Open QA Stack is made for test environments: it types the accounts you declare, creates and changes data there, and a model that is paid by the token is paid for each run.

## The command

```
oqas [--repository <folder>] [--environment <name>] [--brief <text>] [--force-cartography] [--follow]
oqas [--repository <folder>] --resume <run> [--follow]
oqas [--repository <folder>] --init
```

| Option | What it does |
|---|---|
| `--repository <folder>` | The test repository, which holds `oqas.json`; the current folder by default. |
| `--environment <name>` | The environment to run against; the only one declared by default. |
| `--brief <text>` | What to test, in your words: a domain, a ticket, a rule, a journey. |
| `--force-cartography` | Map every source again, even those whose card is up to date. |
| `--follow` | Print what the agents do while they do it. |
| `--resume <run>` | Resume a run a limit stopped, from what it kept. |
| `--init` | Initialise the test repository as a Playwright project: write the files it lacks, overwrite none, run nothing. |

It ends with `0` when every test passed, `1` when a test failed, `2` when a test was blocked, indeterminate, skipped or not run, `3` when the configuration or the options are invalid, `4` when a prerequisite is missing, and `5` when the chain did not go to its end.

## Status

Open QA Stack is not published on npm: it is run from a clone, as above. What an agent plans varies from one run to the next, and so do the tests it writes; a run tells what it did not cover. The references of the visual tests are those of one browser on one machine.

## Development

### Checking a change

`pnpm check`, run at the root of the repository with the Node.js `.nvmrc` names, tells whether a commit can be delivered. It runs the steps below in order, stops at the first that fails, names it, and changes no file.

1. **typecheck**: `tsc` in strict mode on every package and on the lint rules of the workspace.
2. **lint**: oxlint with type information and the lint rules of the workspace, in `lint/`, warnings denied, then the check of the manifests against [the package boundaries](#package-boundaries). An explicit `any` fails.
3. **format**: Prettier, without rewriting anything. `pnpm format` rewrites the files it would change.
4. **build**: the `build` script of every package that has one. The packages that run their TypeScript sources as they are have none.
5. **coverage directives**: a `node:coverage ignore` or `node:coverage disable` comment in a source file gives, on its line or the line before, the URL of the issue of this repository that explains it, such as `https://github.com/open-qa-stack/test-management/issues/1`.
6. **secrets**: no file of the index holds a secret, by the rules of [the scan](#scanning-before-publishing).
7. **tests and coverage**: the tests of every package, four packages at a time and the test files of a package side by side, which cover 100 % of the lines, branches and functions of every file of code under its `src` folder, files no test loads included. The output of a package is written in one piece once its tests have ended. Tests, scripts, fixtures and configuration files live outside `src` and are not measured, and neither is a file that only declares types. The check reads what was covered from a report of the test runner: a `test` script that lowers a threshold or leaves a file out of the measure changes nothing, and a file of code missing from the report fails. A module that only runs in a browser, listed under `coverage.measuredInBrowser` in the manifest of its package, is left to the tests of that package, which measure it there. The `test` script of a package with source files starts the test runner with `--experimental-test-coverage`, which Node.js does not accept from `NODE_OPTIONS`.
8. **lint rules**: the tests of the lint rules of the workspace, which cover all of `lint/`.

Once the dependencies are installed with `pnpm install --frozen-lockfile`, the check needs no network.

### Package boundaries

Each package depends only on the packages its row names. `pnpm lint` refuses any other import in the sources of a package, under its `src` folder, whatever its form: the name of the package or a path into it, a relative path out of the folder of the package or through its `node_modules`, a dynamic import or a `require` of a constant string, an `import … = require(…)`, a type-only import or a re-export. It refuses the same dependency in the `dependencies`, `peerDependencies` and `optionalDependencies` of the manifest of the package. Each refusal names the file, the line, the package, what it imports and the rule.

| Package   | Folder             | Depends on                                       |
| --------- | ------------------ | ------------------------------------------------ |
| `domain`  | `packages/domain`  | nothing                                          |
| `shared`  | `packages/shared`  | nothing                                          |
| `api`     | `packages/api`     | `domain`, `shared`                               |
| `harness` | `packages/harness` | `domain`, `shared`                               |
| `tools`   | `packages/tools`   | `domain`, `shared`                               |
| `agents`  | `packages/agents`  | `domain`, `shared`, `tools`                      |
| `worker`  | `packages/worker`  | `harness`, `agents`, `tools`, `domain`, `shared` |
| `cli`     | `packages/cli`     | `shared`, `harness`, `agents`, `tools`, `domain` |
| `web`     | `apps/web`         | `shared`                                         |

- `worker` has no folder yet: the table bounds it from its first file.
- The domain imports no external module, those of Node.js included, but the ones listed under `external` in its row of the table, none for now. It holds no decorator, of the experimental TypeScript kind or of the standard one.
- The command line keeps its two modes apart, the solo mode in `src/solo/` and the connected mode in `src/connected/`. An override of the lint configuration on `src/connected/` lets its files import `shared` only among the packages of the workspace, and no other file of the command line.
- `@github/copilot-sdk` is imported under `packages/harness/src/copilot/` only, by the implementation of the agent runtime, and by no other file, a test included.
- The tests of a package and its `devDependencies` are left out of the table: a test may run a package with the ones that use it, and the private `testing` package holds what the tests share.

The table lives in `.oxlintrc.json`, as the options of the rule `open-qa-stack/package-boundaries`, which `lint/check-manifests.ts` also reads.

### Commits

A commit is ready when `pnpm check` passes on it. Its message follows [Conventional Commits](https://www.conventionalcommits.org/): a type among `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore` and `revert`, the scope between parentheses when there is one, and a subject of 72 bytes at most, which is 72 characters in ASCII, such as `feat(check): scan the commits of a branch`. A commit is the work of its author: its message carries no `Co-authored-by` or `Generated-by` trailer.

A merge commit is a commit like the others. The message git proposes for it, `Merge branch '<branch>'`, does not follow the convention: give the merge a subject of its own, which says what the merged branch brings.

```sh
git merge --no-ff -m "feat(check): scan the commits of a branch" <branch>
```

### Continuous integration

The pipeline of the repository, in `.github/workflows/`, runs on every pull request and on every commit of `main`; `ci` can also be started by hand. The workflows that verify a change, `ci` and `release`, only read the repository, hold no secret and publish nothing, so they run the same way for a pull request that comes from a fork. The workflow `cla` is the one that writes: it comments on a pull request and records a signature, on the code of `main` and never on that of the pull request. Every action they use is pinned to a commit.

| Workflow | Job | What it verifies |
|---|---|---|
| `ci` | `check` | `pnpm check` on a clean clone, with the Node.js `.nvmrc` names, the dependencies installed from the frozen lockfile and the Chromium the workspace pins. |
| `ci` | `hygiene` | `pnpm scan` on every commit the pull request brings, not only its last: the message of each, and the lines it adds. |
| `ci` | `advisories` | No production dependency has a known vulnerability of moderate severity or more. |
| `release` | `candidate` | Started by hand for a version: the check, the scan of the whole history, the advisories, then the tarball of every package, kept as artifacts of the run. It publishes nothing and tags nothing. |
| `cla` | `cla` | Every author of a pull request has signed the [contributor license agreement](CLA.md); the signatures are kept in the branch `cla-signatures`. The maintainer and the bots that open dependency pull requests are exempt. |

A pull request can be merged once `check`, `hygiene`, `advisories` and `cla` are green: they are the required checks of `main`. `.github/dependabot.yml` proposes, each week, the updates of the pinned dependencies and those of the actions, each kind in one pull request, so that the pipeline runs once for them.

### Scanning before publishing

`pnpm scan` looks for what must not be published, and changes nothing.

- Without arguments, it scans the files of the index for secrets.
- With revision ranges, as `git log` reads them (`pnpm scan main..HEAD`), or with `--all` for every branch and tag, it also scans the commits they select: the message of each commit, by the rules of the section above, and the lines it adds, for secrets. The lines a merge adds are those its author wrote on top of what git would have merged by itself, which needs git 2.36 or later.

Its rules find a secret by its format: `private-key` a private key in the PEM format, and `github-token` a token in the format of a GitHub token. A finding names the file, the commit when there is one, and the rule, never the secret. The scan ends with `0` when it found nothing, `1` when it found something, and `2` when its arguments or a revision are wrong.

## Contributing

Contributions are accepted under the [contributor license agreement](CLA.md): you keep your copyright, the project keeps one legal basis. On your first pull request you are asked to sign it, once, by a comment; a check reminds you and holds the merge until the signature is recorded. It is not an assignment: it grants the maintainer a license broad enough to defend the code, answer for its provenance and adapt how the project is licensed without tracking down every past author. If you contribute for an employer, the employer signs it as an entity.

## License

Open QA Stack is licensed under the [Apache License, Version 2.0](LICENSE) (`Apache-2.0`).

Copyright 2026 Quentin Joly and the Open QA Stack contributors.
