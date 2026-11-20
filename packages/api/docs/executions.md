# Executions

An execution is a run of the Playwright tests of the test repository, with what came of each test. The instance keeps
them in its database. For now each execution comes from a session of design: once a session runs the tests it wrote,
the execution is kept from the report of the runner, before the session ends. The route is the operation of the engine
that reads them, said in HTTP.

The runs the test repository ran before the instance kept its executions, the folders `<stateDir>/runs/run-<date>/`, are taken when the API starts, once each: they are dated by the start of their run, belong to no session, and keep no version, since the commit and the files of then are gone.

A test is named by the path of its file, relative to the root of the test repository, and by its titles: those of the
`describe` that hold it, then its own. Each result also keeps the version the test ran at:

- the commit the test repository was at;
- the SHA-256 of the file of the test, which tells a change that was not committed yet.

The shapes of the bodies are the types `ExecutionList` and `Execution` of `@open-qa-stack/domain/sessions`. A client ignores a field it does not know. What came of the tests of one file in each execution is told by [the tests](tests.md#the-executions-of-a-test).

| Route | Answer |
|---|---|
| `GET /api/executions[?limit=<n>&before=<id>&outcome=<outcome>]` | A page of the executions, the latest first, each with what came of each of its tests. |
| `GET /api/executions/<id>` | One execution, with what came of each of its tests. |

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
        }
      ]
    }
  ],
  "next": "5b0c8f2e-6a51-4d1e-9a3f-2c7d1e0b9a44"
}
```

A page holds `limit` executions, 25 when the query does not say, 100 at most. The executions are ordered by date, then by identifier for the same date; `next` names the last one of a page, and the page after it is asked with `before=<next>`: a page starts after that execution, whatever was kept since, so that no execution is told twice nor skipped. The last page has no `next`. `outcome=failing` keeps the executions where a test failed, `outcome=passing` those where none did.

| Field | What it says |
|---|---|
| `origin` | Where the execution comes from: `design` for the tests a session of design ran. |
| `sessionId` | The session that ran it; left out once that session is gone, or for an execution no session ran. |
| `commit` | The commit the test repository was at; left out for a folder without one. |
| `report` | The report of the runner, relative to the test repository. |
| `results[].verdict` | `passed`, `failed`, `flaky` when the test passed only on a retry, or `skipped`. |
| `results[].durationMs` | How long its attempts took together. |
| `results[].fileDigest` | The SHA-256 of its file when the execution was kept; left out when the file could not be read. |

## One execution

```http
GET /api/executions/5b0c8f2e-6a51-4d1e-9a3f-2c7d1e0b9a44
```

The answer is the execution, as a page tells it.

## Problems

| `code` | Status | When |
|---|---|---|
| `invalid_request` | `400` | `limit` is not a number from 1 to 100, `before` is empty, or `outcome` is neither `failing` nor `passing`. |
| `unknown_execution` | `404` | The execution of the route, or the one `before` names, is not kept by the instance. |
