# Tests

The tests of an instance are the Playwright tests of its test repository, whoever wrote them: a design of the agents, or a person. The API lists them as their files are now, read at each call under the folder of the applications of the configuration in force (`repository.appsDir`, `apps` by default). Nothing is kept: a test added, changed or removed in the repository is listed so at the next call. The route is the operation of the engine that reads them, said in HTTP. The web console lists the tests through it.

The shape of the body is the type `RepositoryTestList` of `@open-qa-stack/domain/sessions`. A client ignores a field it does not know.

| Route | Answer |
|---|---|
| `GET /api/tests` | The tests of the test repository, in the order of their paths. |
| `GET /api/tests/reading?path=<path>[&execution=<id>]` | A test in steps, from the latest run that ran it, or from the execution named. |
| `GET /api/tests/capture?path=<path>&step=<number>[&execution=<id>]` | The capture that run attached for a step. |
| `GET /api/tests/executions?path=<path>` | What came of the tests of the file in its latest executions, the latest first. |

`<path>` is the path of a test, relative to the root of the test repository, as `GET /api/tests` gives it. Every answer is given with `cache-control: no-store`; every answer that is not a success is a [problem](sessions.md#problems).

## The tests of the repository

```http
GET /api/tests
```

```json
{
  "items": [
    {
      "path": "apps/policy-management/tests/policies/policy-detail/policy-detail-nominal.spec.ts",
      "title": "Display the detail of a policy",
      "steps": ["1. Open the policy of the customer"],
      "tags": ["@level-functional", "@domain-policies", "@feature-policy-detail", "@app-policy-management", "@kind-functional", "@case-nominal", "@data-read"],
      "applications": ["policy-management"],
      "level": "functional",
      "domain": "policies",
      "feature": "policy-detail",
      "kind": "functional",
      "case": "nominal",
      "data": "read"
    }
  ]
}
```

A test is each file whose name ends with `.spec.ts` or `.test.ts` under the folder of the applications, but those of `node_modules`. Its `title` is that of its first `test(…)`, its path when it has none, and its `steps` the titles of its `test.step(…)`, in order.

What a test is, beyond its file, is what its tags say of it, each `@<prefix>-<value>` as the harness writes them from the scenario of the test:

| Field | Tag | Values the harness writes |
|---|---|---|
| `applications` | `@app-…`, each once | the applications the test acts on; several for a test that crosses them |
| `level` | `@level-…` | `smoke`, `functional`, `business`, `cross-application`, `end-to-end` |
| `domain` | `@domain-…` | a domain of the knowledge of the applications |
| `feature` | `@feature-…` | a functionality of that domain |
| `kind` | `@kind-…` | `functional`, `visual`, … |
| `case` | `@case-…` | `nominal`, `negative` |
| `data` | `@data-…` | `read`, `write` |

The first tag of a prefix counts. A test without a tag of a prefix has no such field; a test written by hand may have none of them. `tags` gives every tag as the file does, those of other prefixes too.

An instance without a test repository, or before a revision of its configuration is in force, lists no test.

## A test in steps

```http
GET /api/tests/reading?path=apps%2Fpolicy-management%2Ftests%2Fpolicies%2Fpolicy-detail%2Fpolicy-detail-nominal.spec.ts
```

```json
{
  "path": "apps/policy-management/tests/policies/policy-detail/policy-detail-nominal.spec.ts",
  "run": "run-2026-11-19T00-29-03-488Z",
  "ranAt": "2026-11-19T00:29:03.488Z",
  "view": {
    "id": "policy-management › policy-management/tests/policies/policy-detail/policy-detail-nominal.spec.ts:3 › Display the detail of a policy",
    "status": "unexpected",
    "steps": [
      { "number": 1, "title": "1. Open the policy of the customer", "state": "passed", "duration": 224, "capture": { "name": "1", "contentType": "image/png" }, "steps": [] },
      { "number": 2, "title": "2. Read its amounts", "state": "failed", "duration": 5012, "steps": [] }
    ],
    "failedStep": 2,
    "uncaptured": [2],
    "details": { "error": "Error: expect(locator).toBeVisible() failed…", "stdout": [], "stderr": [], "trace": "/work/tests/.oqas/test-results/…/trace.zip", "screenshots": [] }
  }
}
```

The runs are the folders `<stateDir>/runs/run-<date>/` of the test repository, each with the report the runner wrote, `report.json`; the latest one whose report holds the test counts. `view` is that test read in steps by `qaViews` of `@open-qa-stack/domain`, which tells its rules: the `test.step` it calls, numbered, their states and durations, the capture of each step — the one the test attached under the number of the step, or, at the step that failed with none of its own, the page the runner captured at the failure —, the first step that failed, what the failed assertion `expected` and `received` when its message says both, and the details. `ranAt` is the date that run started, read from the name of its folder. A test no run kept ran has neither `run`, `ranAt` nor `view`.

With `execution`, the test is read from the run of that [execution](executions.md) instead, whatever ran later: `run` is the folder of its report, `ranAt` the date of the execution. An execution whose report is gone, or did not hold the test, gives none of them; one the instance does not keep is refused. `status` is the one the reporter gives; the verdict of the harness, told by the session that ran the test, is never changed by it.

## The capture of a step

```http
GET /api/tests/capture?path=…&step=1
```

The answer is the capture itself, of the media type the run attached it with, such as `image/png`. A capture the report holds is served from it; one the runner wrote to a file is served from that file, only when it is in the test repository.

## The executions of a test

```http
GET /api/tests/executions?path=apps%2Fpolicy-management%2Ftests%2Fpolicies%2Fpolicy-detail%2Fpolicy-detail-nominal.spec.ts
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
      "result": { "path": "apps/policy-management/tests/policies/policy-detail/policy-detail-nominal.spec.ts", "title": "Display the detail of a policy", "project": "policy-management", "verdict": "passed", "durationMs": 2140 }
    }
  ]
}
```

Each item is an execution that ran a test of the file, with what came of that test but not of its other tests: a file of several tests gives one item for each of them in each execution. The latest 100 are told, the latest first. The shape of the body is the type `TestExecutionList` of `@open-qa-stack/domain/sessions`.

## Problems

| `code` | Status | When |
|---|---|---|
| `invalid_request` | `400` | `path` is missing or empty, `step` is not a number from 1, or `execution` is empty. |
| `unknown_execution` | `404` | The query names an execution the instance does not keep. |
| `unknown_capture` | `404` | The run of the test that was read attached no capture for the step that can be read: no run ran the test, it attached none for the step, or its file is gone or outside the repository. The detail says to read the test again, whose steps say which have a capture. |

