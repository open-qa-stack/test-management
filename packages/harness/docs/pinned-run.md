# Running the tests

`PinnedRun` runs the given test files of a test repository with the real Playwright runner, on the machine, at the version of `@playwright/test` the repository locks, and pronounces a verdict per test from the JSON of the reporter. No container is needed.

```ts
const outcome = await new PinnedRun({ config, environment: "local", repositoryRoot, tests }).run();
// outcome.result.tests: [{ id, verdict, reason }, …]
```

## The version

The version is the one of `@playwright/test` that `package-lock.json` installs, not the range `package.json` declares. No version of Playwright is written in the harness. The dependencies are installed from the lockfile with `npm ci`, then the browsers of that version with `playwright install chromium`; the version then installed must be the locked one, exactly.

## The steps

Each step is a command run without a shell, in the test repository. It gets `OQAS_ENVIRONMENT`, the base address of each application and the variables of the test accounts, with only the variables of the process that npm, the runner and the browsers need: no key of a model nor connection string reaches the tests.

1. **Install** the dependencies from the lockfile.
2. **Install the browsers** of the locked version.
3. **Check the version** installed against the locked one.
4. **List** the given files with `playwright test --list --reporter=json`: these are the listed tests.
5. **Check the addresses**: each address of the applications of the environment, interface and APIs, is called as declared. It answers when any HTTP response comes within the time limit, whatever its status.
6. **Run** the given files with `playwright test --reporter=json`, the JSON and what the runner leaves, traces and screenshots, written to the run folder.
7. **Check again** the declared addresses that failed tests met a network error towards.

When the lockfile cannot be read, the dependencies or the browsers cannot be installed, the versions differ, the list fails or the addresses cannot be checked, no test runs, and each given file gets `not_run` with the reason. When an address does not answer before the run, no test runs, and each listed test gets `blocked` with the address.

## The base of the test repository

`testRepositoryBase(version)` gives the files the tests need to run: a `package.json` with `@playwright/test` at that exact version, and a `playwright.config.ts` that declares a project per application of `oqas.json`, its tests in `<appsDir>/<application>`. What the runner leaves of a run, traces and screenshots of failures, goes to `<stateDir>/test-results`, out of the tracked files. The lockfile is made from it with `npm install`. The configuration imports only `@playwright/test` and modules of Node.js. Each project gets its base address from `OQAS_BASE_URL_<APPLICATION>` (see `baseUrlVariable`), set by the run, or else from `oqas.json`: the interface of the environment `OQAS_ENVIRONMENT`, or its first API for an application without one.

## The verdicts

The verdicts are pronounced by `testVerdicts`, a pure function of the domain, from the statuses of the reporter. In doubt, a test is `indeterminate`, never `passed`. The exit code of the runner is recorded, never read as a verdict.

| Reporter | Verdict |
|---|---|
| `expected`, with attempts that all passed | `passed` |
| `expected`, without an attempt, or with one that did not pass | `indeterminate` |
| `unexpected` | `failed`, with the first line of its first error |
| `unexpected`, on a network error towards a declared address that the check after the run finds unreachable | `blocked` |
| `unexpected`, on a network error towards a declared address that answers after the run, or that the check could not confirm | `indeterminate` |
| `skipped` | `skipped` |
| `flaky`, an attempt `interrupted`, or a test marked as expected to fail | `indeterminate` |
| listed, but absent from the JSON | `not_run` |
| any test, when the JSON is missing, empty or unreadable | `indeterminate`, and the output of the runner is kept |

A network error is a connection the browser or Node.js could not make (`net::ERR_CONNECTION_REFUSED`, `ECONNREFUSED`…). An HTTP error answered by the server, or an aborted navigation, is not one.

## The result

The result is written to `<stateDir>/runs/run-<date>.json`: each test with its identifier, verdict and reason, the version of Playwright, the addresses checked, the exit code of the runner, and the path of the raw JSON in `<stateDir>/runs/run-<date>/`, or of the output of the runner when the JSON could not be read. Nothing is committed nor pushed.

## Trying a test while it is written

`TrialRunner` implements `TestRunner` for the designer: it tries one test file at a time. The run is prepared once, at the first trial. The trials run one at a time. The file is written at its path for the time of its run, then removed; its report and its traces stay in its folder of `<stateDir>/trials/`. A trial gives each test of the file with its verdict and, for one that did not pass, every error of its last attempt, the step that failed and the path of its trace, relative to the test repository. A file already at that path is not overwritten: the trial says so. The references a visual comparison lacks are made at the first run (`--update-snapshots=missing`); the file then runs again against them, and they are given with the trial, then removed from the folder, to be written with the test. A folder of references already there is left as it is.

## The commands

The commands go through `CommandRunner`, an interface of the domain. `LocalRunner` runs them on the machine, in the test repository, with the environment of the process; the tests of the harness give another, so that they install and run nothing.
