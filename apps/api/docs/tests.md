# Tests

The tests of an instance are the Playwright tests of its test repository, whoever wrote them: a design of the agents, or a person. The API lists them as their files are now, read at each call under the folder of the applications of the configuration in force (`repository.appsDir`, `apps` by default). Nothing is kept: a test added, changed or removed in the repository is listed so at the next call. The route is the operation of the engine that reads them, said in HTTP. The web console lists the tests through it.

The shape of the body is the type `RepositoryTestList` of `@open-qa-stack/domain/sessions`. A client ignores a field it does not know.

| Route | Answer |
|---|---|
| `GET /api/tests` | The tests of the test repository, in the order of their paths. |
| `PATCH /api/tests` | Changes the title of a test, or the text of one of its steps, in its file. |
| `GET /api/tests/source?path=<path>` | The code of the file of a test, as it is now. |
| `GET /api/tests/reading?path=<path>[&execution=<id>]` | A test in steps, from the latest run that ran it, or from the execution named. |
| `GET /api/tests/capture?path=<path>&step=<number>[&execution=<id>]` | The capture that run attached for a step. |
| `GET /api/tests/trace?path=<path>[&execution=<id>]` | The trace that run kept of the test. |
| `GET /api/tests/executions?path=<path>` | What came of the tests of the file in its latest executions, the latest first. |
| `GET /api/tests/verdicts` | What came of each test the last time an execution ran it and did not skip it, whatever the environment: `{ "items": [{ "path", "title", "verdict" }] }`. |
| `GET /api/tests/versions?path=<path>` | The versions of the tests of the file, the latest first. |

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
  ],
  "anomalies": [{ "kind": "duplicate", "path": "apps/policy-management/tests/policies/policy-detail/policy-detail-nominal.spec.ts", "title": "Display the detail of a policy" }]
}
```

The tests are read from each file whose name ends with `.spec.ts` or `.test.ts` under the folder of the applications, but those of `node_modules`, in the order of their paths. Each test of a file is one item: its `title` is its titles as the runner reports them — those of the groups `test.describe` that hold it, then its own, as `<describe>… › <title>` — its `tags` those of its details, and its `steps` the titles of its `test.step(…)`, in order. A file whose tests cannot be read, or which names none by a plain title — such as tests built in a loop — is one item, titled by its path, with what its text gives of tags and steps.

`anomalies` tells what keeps a file from being listed as it is:

| `kind` | When | With |
|---|---|---|
| `duplicate` | Two tests of the file share a title: the runner and the results take them as one test, the first of the file. | `path`, `title` |
| `unreadable` | The file holds a syntax error: none of its tests is read. | `path` |

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

### The identifier of a test

`id` is the identifier of a test, the UUID of its tag `@oqas-id-<uuid>`, such as `@oqas-id-3f0c2b9e-8d4a-4f1e-9b7a-2c5d6e7f8a90`. It stays with the test when its title, its steps or its file change, and a run selects the test by it: `npx playwright test --grep @oqas-id-3f0c2b9e-8d4a-4f1e-9b7a-2c5d6e7f8a90`. The harness writes it on every test a design writes, and a repair keeps it; a test written by hand is given one the first time it is [changed](#changing-a-test). Listing the tests never writes a file.

The instance keeps each test that bears an identifier under it, with where the repository last told it is: the path of its file and its titles. The [versions](#the-versions-of-a-test) and the [executions](#the-executions-of-a-test) of a test are kept under that place; when a test keeps its identifier and changes its place — renamed, moved to another file, by the console or by hand —, its versions, its results and the campaigns that chose it follow it to the new place at the next listing. They stay where they were when the new place already has versions of its own, and an identifier two tests bear, such as that of a test copied whole, moves nothing.

An instance without a test repository, or before a revision of its configuration is in force, lists no test.

## The code of a test

```http
GET /api/tests/source?path=apps%2Fpolicy-management%2Ftests%2Fpolicies%2Fpolicy-detail%2Fpolicy-detail-nominal.spec.ts
```

```json
{
  "path": "apps/policy-management/tests/policies/policy-detail/policy-detail-nominal.spec.ts",
  "content": "import { expect, test } from \"../../../../shared/fixtures.ts\";\n\ntest(\"Display the detail of a policy\", …"
}
```

Only the files the tests are listed from are read. The shape of the body is the type `TestSource` of `@open-qa-stack/domain/sessions`.

## Changing a test

```http
PATCH /api/tests
content-type: application/json

{
  "path": "apps/policy-management/tests/policies/policy-detail/policy-detail-nominal.spec.ts",
  "title": "Display the detail of a policy",
  "change": { "step": 2, "text": "Read the amounts of the policy" }
}
```

`path` and `title` name the test as `GET /api/tests` gives it. `change` is one of:

| `change` | What changes |
|---|---|
| `{ "title": "…" }` | The own title of the test: the titles of the groups `test.describe` that hold it stay. |
| `{ "step": <number>, "text": "…" }` | The title of its step of that number, from 1, as its `steps` give them. A number the harness wrote before it, such as `2. `, stays. |

A text is trimmed; it is one line of 300 characters at most. The file is changed from its syntax tree: the literal of the title or of the step is replaced where it is, in its own quotes, and the rest of the file is kept as it is, to the character. A test that bears no [identifier](#the-identifier-of-a-test) is given one in the same write, added to its tags. The file is then committed alone on the branch checked out, with the identity git knows in the test repository, as `test: rename "<title>" to "<new title>"` or `test: reword step <number> of "<title>"`: whatever else the repository has changed or staged stays as it is. A change is refused before anything is written when the file cannot be committed so — no git repository with a commit, no branch checked out, a merge, a rebase, a cherry-pick or a revert under way, changes of the file not committed —, and the detail says what to do first. A commit git refuses, for want of an identity or by a hook, puts the file back as it was.

The body is the type `TestChange` of `@open-qa-stack/domain/sessions`. The answer is the test as its file now tells it, with its `id`, an item as `GET /api/tests` lists it.

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
  },
  "traced": true
}
```

The runs are the folders `<stateDir>/runs/run-<date>/` of the test repository, each with the report the runner wrote, `report.json`; the latest one whose report holds the test counts. `view` is that test read in steps by `qaViews` of `@open-qa-stack/domain`, which tells its rules: the `test.step` it calls, numbered, their states and durations, the capture of each step — the one the test attached under the number of the step, or, at the step that failed with none of its own, the page the runner captured at the failure —, the first step that failed, what the failed assertion `expected` and `received` when its message says both, and the details. `ranAt` is the date that run started, read from the name of its folder. `traced` says whether that run kept a trace of the test in the test repository, which [its trace](#the-trace-of-a-test) serves. A test no run kept ran has neither `run`, `ranAt`, `view` nor `traced`.

With `execution`, the test is read from the run of that [execution](executions.md) instead, whatever ran later: `run` is the folder of its report, `ranAt` the date of the execution. An execution whose report is gone, or did not hold the test, gives none of them; one the instance does not keep is refused. `status` is the one the reporter gives; the verdict of the harness, told by the session that ran the test, is never changed by it.

## The capture of a step

```http
GET /api/tests/capture?path=…&step=1
```

The answer is the capture itself, of the media type the run attached it with, such as `image/png`. A capture the report holds is served from it; one the runner wrote to a file is served from that file, only when it is in the test repository.

## The trace of a test

```http
GET /api/tests/trace?path=…&execution=5b0c8f2e-6a51-4d1e-9a3f-2c7d1e0b9a44
```

The answer is the archive the runner wrote, `application/zip`: the trace of the latest attempt of the test that kept one, as the configuration of Playwright of the test repository asks (`trace: "retain-on-failure"`, for instance). It is served only when its file is in the test repository. A trace holds what the test typed and the pages it saw, the test values it signed in with included: it is served by the instance alone, as the rest of the API.

Where the API serves the console, it also serves beside it the trace viewer of Playwright, as `playwright-core` builds it, under `/trace-viewer/`: `/trace-viewer/index.html?trace=<address of a trace>` opens a trace on the same origin, which its service worker asks for. A viewer older than the Playwright of the test repository may refuse a trace that version recorded.

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

## The versions of a test

```http
GET /api/tests/versions?path=apps%2Fpolicy-management%2Ftests%2Fpolicies%2Fpolicy-detail%2Fpolicy-detail-nominal.spec.ts
```

```json
{
  "items": [
    {
      "path": "apps/policy-management/tests/policies/policy-detail/policy-detail-nominal.spec.ts",
      "title": "Display the detail of a policy",
      "number": 2,
      "digest": "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
      "since": "2026-11-20T09:12:40.000Z",
      "executions": 1
    },
    {
      "path": "apps/policy-management/tests/policies/policy-detail/policy-detail-nominal.spec.ts",
      "title": "Display the detail of a policy",
      "number": 1,
      "digest": "fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9",
      "commit": "4f2a9c01d3b6e8a7f5c2d1e0b9a8c7d6e5f4a3b2",
      "since": "2026-11-19T10:00:05.000Z",
      "executions": 3
    }
  ]
}
```

A version of a test is numbered from 1 each time an execution runs the test changed since its latest version. A test is told changed by the SHA-256 of its call of `test` — its title, its details and its body — read as code without its comments nor its layout: a comment, a formatting, or a change to another test of the file makes no new version. A test that comes back to what it was at an earlier version is still a new one. A test whose titles are no plain texts, such as one built in a loop, has no version.

A version takes the commit the test repository was at when an execution first ran it committed: a version a session of design ran before it committed the test takes it at the next execution, and one never run committed has none. `since` is when an execution first ran it, `executions` how many executions ran it. The items come the latest first, then by the titles of the tests. The shape of the body is the type `TestVersionList` of `@open-qa-stack/domain/sessions`.

## The review of the tests the agents wrote

The tests the agents wrote wait for a person to decide of them. The queue of the review lists those a design kept as passing, or failing because of the application, whose file its branch still has: the state of each design, in the state folder of the test repository (`repository.stateDir`), names them, its plan gives their scenarios, and the tag `@oqas-id-…` of each file gives its identifier. A test a later design wrote again is the one of that design. What a person decided of a test is kept in the database of the instance, by its identifier: a test validated has entered the working branch and leaves the queue; one set aside stays listed, with why. Nothing else is kept: the queue is read at each call.

| Route | Answer |
|---|---|
| `GET /api/reviews` | The tests to review and those set aside, the oldest design first, and how many of each: the type `ReviewQueue`. |
| `GET /api/reviews/<id>` | What a person reads to decide of a test: the brief of its design, why it was written, its sources, its steps and what each expects, why it stands as it does, the remarks of the agents that reviewed its coherence and its code, the files its design wrote for it — its own, then those it relies on, such as page objects, with the lines each added — and the decision made of it: the type `TestProposal`. |
| `PUT /api/reviews/<id>/decision` | Keeps what a person decides of a test to review — `{ "status": "validated" }`, or `{ "status": "set_aside", "reason", "coveredBy"?, "note"? }` with a reason among `covered`, `out_of_scope`, `wrong_oracle` and `wrong_level`, `coveredBy` the path of the test that covers one `covered`, and a note of 500 characters at most —, and answers the type `DecidedTest`: the decision kept, and for a test validated the working branch it entered and whether a commit took it there. A test validated is committed on the working branch, in the checkout of the repository, which is left on it; nothing is pushed. |
| `DELETE /api/reviews/<id>/decision` | Puts a test set aside back in review, as it was: the decision made of it is forgotten, and it waits for a new one. Answers `204`. A test in review or validated is refused. |

`<id>` is the identifier of a test, the UUID of its tag. Both answers are given with `cache-control: no-store`.

## Problems

| `code` | Status | When |
|---|---|---|
| `invalid_request` | `400` | The body of a decision is none, `path` is missing or empty, `step` is not a number from 1, `execution` is empty, or the body of a change is not `{ path, title, change }` with `change` one of its two shapes. |
| `unknown_test` | `404` | The repository lists no file of tests of the path, or the file declares no test of the title. |
| `test_change_refused` | `422` | The change cannot be written: the text is empty, of several lines or too long, another test of the file has the title, the test has no step of the number, its tags are not written as a text or a list of texts, the file holds a syntax error, or it cannot be committed alone. The detail says which, and what to do. |
| `unknown_execution` | `404` | The query names an execution the instance does not keep. |
| `unknown_capture` | `404` | The run of the test that was read attached no capture for the step that can be read: no run ran the test, it attached none for the step, or its file is gone or outside the repository. The detail says to read the test again, whose steps say which have a capture. |
| `unknown_trace` | `404` | The run of the test that was read kept no trace of it that can be read: no run ran the test, it kept none, or its file is gone or outside the repository. |
| `unknown_proposal` | `404` | No design of the test repository gives a test of the identifier for a person to review. The detail says to list them with `GET /reviews`. |
| `review_refused` | `409` | The decision cannot be taken now: the test was decided of already, or is not set aside when put back in review, a session runs or waits, a tracked file of the repository is changed, no branch of the person can be told to take the test, or git refuses the commit. The detail says which, and what to do. |

