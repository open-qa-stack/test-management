# Defects

A defect is reported by a person from a test that failed: its title, how serious it is, from `S1` (blocking) to `S4` (cosmetic), a description, the test it comes from and the execution it failed in. The instance keeps it in its database, under a reference such as `D-12`; no tool of tickets is called. The routes are the operation of the engine on the defects, said in HTTP. The web console lists them, and reports one from the card of a test whose last run failed.

A defect is `open` until the person marks it `fixed`. Once fixed, its test is to run again until an execution after the fix ran it and it passed; the defect then counts with those closed. The person may close it, or open it again, which forgets when it was fixed and closed. Each defect is given with where it stands for the person who follows it, its `stage`: `open`, `to_replay`, `replayed` or `closed`.

| Route | Answer |
|---|---|
| `GET /api/defects` | The defects, the latest reported first, each with its stage, and how many each view holds: `{ items, counts: { open, toReplay, closed } }`, the type `DefectList`. |
| `POST /api/defects` | Keeps a defect reported — `{ title, severity, description?, test: { path, title }, execution? }` —, open, and answers it with `201`. |
| `PATCH /api/defects/<id>` | Moves a defect — `{ "status" }`, one of `open`, `fixed` and `closed` — and answers it as it stands. |

The shapes of the bodies are the types of `@open-qa-stack/domain/sessions`. Every answer is given with `cache-control: no-store`; every answer that is not a success is a [problem](sessions.md#problems).

## Problems

| `code` | Status | When |
|---|---|---|
| `invalid_request` | `400` | The body of a report has no title, a title over 200 characters, a severity that is none of `S1` to `S4`, a description over 10,000 characters, or no test; the body of a move names no status of the three. |
| `unknown_defect` | `404` | The instance keeps no defect of the reference. The detail says to list them with `GET /defects`. |
