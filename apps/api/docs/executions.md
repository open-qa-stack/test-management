# Executions

An execution is a run of the Playwright tests of the test repository, with what came of each test. The instance keeps
them in its database. An execution comes from a session of design — once a session runs the tests it wrote, the execution
is kept from the report of the runner, before the session ends — or from a [launch of tests](#launching-tests): tests of the
repository a person runs again as they are, with no agent. Its `origin` says which: `design` or `manual`. The routes are the
operations of the engine, said in HTTP.

The runs the test repository ran before the instance kept its executions, the folders `<stateDir>/runs/run-<date>/`, are taken when the API starts, once each: they are dated by the start of their run, belong to no session, and keep no version, since the commit and the files of then are gone.

A test is named by the path of its file, relative to the root of the test repository, and by its titles: those of the
`describe` that hold it, then its own. Each result also keeps the version the test ran at:

- the commit the test repository was at;
- the SHA-256 of the file of the test, which tells a change that was not committed yet;
- the SHA-256 of the test itself, read as code without its comments nor its layout, and whether the test was the same in the commit;
- the [version of the test](tests.md#the-versions-of-a-test) it ran at, which the instance numbers by that digest.

The shapes of the bodies are the types `ExecutionList` and `Execution` of `@open-qa-stack/domain/sessions`. A client ignores a field it does not know. What came of the tests of one file in each execution is told by [the tests](tests.md#the-executions-of-a-test).

| Route | Answer |
|---|---|
| `GET /api/executions[?limit=<n>&before=<id>&outcome=<outcome>&origin=<origin>&since=<date>]` | A page of the executions, the latest first, each with what came of each of its tests. |
| `GET /api/executions/<id>` | One execution, with what came of each of its tests. |
| `POST /api/launches` | Launches tests of the repository as they are; `202` with the launch, which runs. |
| `GET /api/launches` | The launch that runs, and the last one that ended, with the execution it kept. |

Every answer is given with `cache-control: no-store`; every answer that is not a success is a [problem](sessions.md#problems).

## The executions

```http
GET /api/executions?limit=25
```

```json
{
  "items": [
    {
      "id": "5b0c8f2e-6a51-4d1e-9a3f-2c7d1e0b9a44",
      "origin": "design",
      "sessionId": "8d3f1a52-0c4e-4b8a-9e61-7f2a5c9d0b13",
      "ranAt": "2026-11-19T10:00:05.000Z",
      "commit": "4f2a9c01d3b6e8a7f5c2d1e0b9a8c7d6e5f4a3b2",
      "report": ".oqas/runs/run-2026-11-19T10-00-00-000Z/report.json",
      "results": [
        {
          "path": "apps/policy-management/tests/policies/policy-detail/policy-detail-nominal.spec.ts",
          "title": "Display the detail of a policy",
          "project": "policy-management",
          "verdict": "passed",
          "durationMs": 2140,
          "fileDigest": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
        },
        {
          "path": "apps/policy-management/tests/policies/policy-list/policy-list-nominal.spec.ts",
          "title": "List the policies of a customer",
          "project": "policy-management",
          "verdict": "failed",
          "durationMs": 5320,
          "failure": {
            "step": { "number": 3, "title": "Filter the policies by state" },
            "message": "Error: expect(locator).toHaveCount(expected) failed",
            "expected": "2",
            "received": "0"
          }
        }
      ]
    }
  ],
  "total": 132,
  "start": 0,
  "next": "5b0c8f2e-6a51-4d1e-9a3f-2c7d1e0b9a44"
}
```

A page holds `limit` executions, 25 when the query does not say, 100 at most. The executions are ordered by date, then by identifier for the same date; `next` names the last one of a page, and the page after it is asked with `before=<next>`: a page starts after that execution, whatever was kept since, so that no execution is told twice nor skipped. The last page has no `next`. `outcome=failing` keeps the executions where a test failed, `outcome=passing` those where none did; `origin=<origin>` those of an origin; `since=<date>`, an ISO 8601 date such as `2026-11-20` or `2026-11-20T08:00:00Z`, those kept from then on. `total` tells how many executions the query keeps, every page together, and `start` the rank of the first one of the page among them, from 0: a page shows its executions `start + 1` to `start + items.length` of `total`.

| Field | What it says |
|---|---|
| `origin` | Where the execution comes from: `design` for the tests a session of design ran, `manual` for tests a person launched, `campaign` for those of a campaign. |
| `sessionId` | The session that ran it; left out once that session is gone, or for an execution no session ran. |
| `environment` | The environment its tests ran against; left out for an execution kept before the instance kept it. |
| `commit` | The commit the test repository was at; left out for a folder without one. |
| `report` | The report of the runner, relative to the test repository. |
| `results[].verdict` | `passed`, `failed`, `flaky` when the test passed only on a retry, or `skipped`. |
| `results[].durationMs` | How long its attempts took together. |
| `results[].fileDigest` | The SHA-256 of its file when the execution was kept; left out when the file could not be read. |
| `results[].testDigest` | The SHA-256 of the test itself, its call of `test` read without its comments nor its layout; left out when its file could not be read, or does not write its titles as plain texts. |
| `results[].committed` | Whether the test was the same in the commit; left out with `testDigest`, or without a commit. |
| `results[].version` | The [version of the test](tests.md#the-versions-of-a-test) it ran at, from 1; left out with `testDigest`. |
| `results[].failure` | Where a test that failed failed and why, from its last attempt: its first `test.step` that failed, the first line of its error, and what its assertion expected and received when the message says both. Each part is left out when the report does not say it, and the whole for a test kept before the instance kept them. |

## One execution

```http
GET /api/executions/5b0c8f2e-6a51-4d1e-9a3f-2c7d1e0b9a44
```

The answer is the execution, as a page tells it, with one more field: `results[].previous` is the verdict of the test in the last execution before this one that ran it, against the same environment and in the same project of the runner — `passed`, `failed` or `flaky`. It is left out when none ran it before. A test is compared with its own last run, so that an execution of a few files compares as well as one of them all.

## Launching tests

```http
POST /api/launches
content-type: application/json

{ "paths": ["apps/shop/tests/search.spec.ts"], "environment": "local" }
```

A launch runs tests of the repository as they are, with no agent and no model: the runner of the test repository, at the
version its lockfile installs, runs them against an environment the configuration declares, after it checked that its
addresses answer, as the end of a session does. A test that fails is run once more (`--retries=1`, whatever the
configuration of Playwright of the repository says): one that passes then is `flaky`. Its execution is kept with the origin `manual`, and no session.

| Field | |
|---|---|
| `paths` | The files of tests, relative to the root of the test repository and inside it; at most 500. Every test of the repository when left out or empty. |
| `environment` | The environment the tests run against; may be left out when the configuration declares only one. |

The answer, `202`, is the launch as it started: `startedAt`, `environment` and `paths`. It runs in the process of the API,
which hosts the sessions, and takes their turn: it is refused while a session runs, and a session opened while it runs
waits until it ended. Every test of a file runs, so a file of several tests keeps them all.

```http
GET /api/launches
```

The answer tells the launch that `running`, with its `progress` once the runner started: the `total` of the tests it
runs once the runner listed them, then each test it `finished` — `path`, `title`, `verdict` — in the order they finished,
which a reporter the instance gives the runner writes to `<stateDir>/launches/launch-<date>/progress.jsonl`. It tells the
`last` one that ended in this process, with `endedAt` and either the
identifier of the `execution` it kept, or the `failure` that says why it kept none: the dependencies or the browsers could
not be installed, an address of the environment did not answer, the runner wrote no report, or the database refused the
execution. Neither is kept: the API forgets them when it stops, and the execution stays.

The shapes of the bodies are the types `LaunchRequest`, `TestLaunch` and `LaunchState` of `@open-qa-stack/domain/sessions`.

## Problems

| `code` | Status | When |
|---|---|---|
| `invalid_request` | `400` | `limit` is not a number from 1 to 100, `before` is empty, `outcome` is neither `failing` nor `passing`, or `since` is no ISO 8601 date; for a launch, `paths` is not a list of at most 500 files inside the test repository, or `environment` is not a text. |
| `unknown_execution` | `404` | The execution of the route, or the one `before` names, is not kept by the instance. |
| `launch_refused` | `409` | Tests cannot be launched now: a session or another launch runs, the instance stops, or the environment is not one the configuration declares, or is left out while it declares several. The detail says which, and what to do. |
| `invalid_configuration`, `no_configuration` | `422`, `404` | The configuration in force is not valid, or there is none: see [the configuration](configuration.md#problems). |
| `unavailable` | `503` | The API was started without a test repository: it launches no test. |
