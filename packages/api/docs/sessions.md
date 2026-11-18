# Sessions

A session is a request made to the agents, and the work it opened. The API gives the project of the instance, its sessions, the events of each session as they happen, takes the sessions a person asks for and the messages a person sends to a session that goes on, and interrupts a session. Each route is one of [the operations on sessions](../../engine/docs/engine.md#the-operations-on-sessions) of the engine, said in HTTP: the API runs the sessions it is asked for, in its own process. The web console follows the agents through these routes.

Every route of the API is under `/api`, wherever the API runs: what is under that path is REST, and nothing else is — the rest of the address is [the console](running.md#the-console), when the API serves it.

The shapes of every body are the types of `@open-qa-stack/domain/sessions`. A client ignores a field, a type of event or a value it does not know: fields, types and values are added over time.

| Route | Answer |
|---|---|
| `GET /api/project` | The project. |
| `GET /api/sessions` | The list of the sessions, the latest first. |
| `GET /api/sessions/:id` | One session. |
| `GET /api/sessions/:id/events` | The events of a session, as a stream of server-sent events. |
| `POST /api/sessions` | Asks for a session. |
| `POST /api/sessions/:id/messages` | Sends a message to a session that goes on. |
| `POST /api/sessions/:id/interruption` | Interrupts a session that goes on. |

The project, the list and a session are answered with `cache-control: no-store`: they are read as they are now. Every answer that is not a success is [a problem](#problems).

## Project

```http
GET /api/project

HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
cache-control: no-store

{"name":"shop-tests","applications":[{"id":"shop","name":"Shop"}]}
```

| Field | Value |
|---|---|
| `name` | The name of the project: that of the folder of the test repository the API was started with; left out on an instance that never had one. |
| `applications` | Its applications, each with its `id` and its `name`. |

## Session

```http
GET /api/sessions/session-2026-11-14T09-00-00-000Z-9f3a1c2b

HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
cache-control: no-store

{"id":"session-2026-11-14T09-00-00-000Z-9f3a1c2b","request":"cover the search of a customer","environment":"local","openedAt":"2026-11-14T09:00:00.000Z","lastEventAt":"2026-11-14T09:01:53.612Z","state":"completed","result":{"outcome":"passed","durationMs":113600,"modelRequests":50,"branch":"oqas/design-20261114T090002Z","tests":[{"id":"shop › customers.spec.ts:3 › Search a customer","verdict":"passed","reason":"Every attempt passed."}]}}
```

| Field | Value |
|---|---|
| `id` | The identifier of the session. |
| `request` | What was asked, in the words of the person. |
| `environment` | The environment the work targets, when the person named one. |
| `openedAt` | When the session was opened, as an ISO 8601 date. |
| `lastEventAt` | When its last event happened. |
| `state` | See below. |
| `result` | What the session came to; present once it is `completed`. |

| State | Meaning |
|---|---|
| `queued` | The session was asked for, and waits its turn: one session runs at a time, in the order they were asked for. |
| `running` | The agents work. |
| `completed` | The work ended; `result` tells how. |
| `interrupted` | The work stopped without ending: its run stopped before it had a result, the session was interrupted, or the API stopped, or died. |

A client reads a state it does not know as a session that no longer goes on.

| Field of `result` | Value |
|---|---|
| `outcome` | `passed` when every test passed, `failed` when one failed, `inconclusive` when one has no verdict of success or failure, `stopped` when the work did not go to its end. |
| `durationMs` | How long the work took, in milliseconds. |
| `modelRequests` | How many requests it sent to the model. |
| `branch` | The branch of the test repository its tests were written on, when they were. |
| `tests` | The verdict of each test: its `id`, its `verdict` and the `reason`. The verdict is `passed`, `failed`, `blocked`, `indeterminate`, `skipped` or `not_run`; anything else a session came to is told as `indeterminate`. |

`GET /api/sessions` answers the sessions, the latest first, as the `items` of an object, which leaves room for what a list will carry besides them:

```http
GET /api/sessions

HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
cache-control: no-store

{"items":[{"id":"session-2026-11-14T09-00-00-000Z-9f3a1c2b","openedAt":"2026-11-14T09:00:00.000Z","lastEventAt":"2026-11-14T09:01:53.612Z","state":"interrupted"}]}
```

## Events

`GET /api/sessions/:id/events` answers `text/event-stream`: every event of the session in the order of their identifiers, then each new one as it happens. Each event is one message, whose `id` is the identifier of the event and whose data is the event as JSON:

```http
GET /api/sessions/session-2026-11-14T09-00-00-000Z-9f3a1c2b/events

HTTP/1.1 200 OK
content-type: text/event-stream

id: 0
retry: 3000

id: 1
data: {"id":1,"at":"2026-11-14T09:00:00.000Z","type":"user_message","text":"cover the search of a customer"}

id: 2
data: {"id":2,"at":"2026-11-14T09:00:00.412Z","type":"state_changed","state":"running"}

id: 3
data: {"id":3,"at":"2026-11-14T09:00:00.420Z","type":"phase_started","phase":"configuration"}
```

Every event has an `id`, its rank in the session from 1, the date `at` it happened, and a `type`:

| Type | Meaning |
|---|---|
| `user_message` | The person said something: `text`. What opened the session, its first event, has no `number`; a message sent while it went on has its `number`, from 1. |
| `message_delivered` | A message sent while the session was going on reached an `agent`: `message` is the number of the message. |
| `agent_message` | An agent wrote something, or reasoned when `reasoning` is true: `agent`, `text`. |
| `harness_message` | The harness asked something of an agent, `to`: its request, then each reminder; `level` when it asks for the plan of one level of the test pyramid. |
| `phase_started` | A `phase` of the work started, on a knowledge `source` or for the test of a `scenario` when it has one. |
| `action_started` | An agent called a `tool` with `arguments`; `action` identifies the call. The `look` of the file the agent handed the tool, such as the test it runs, when it handed one: it can be read while the tool works. |
| `action_finished` | The tool answered: the `action`, its `outcome` (`passed`, `failed`, or `done` when the answer says neither), the `result`, `durationMs`, the `look` of the page it rendered, and the `tests` a run of a file of tests ran, each with its `id` and its `verdict`. A session told before the start of an action carried its file tells that file here. |
| `plan_accepted` | The harness accepted a plan: its `scenarios`, [each whole](#the-scenarios-of-a-plan). |
| `refusal` | The harness refused what an agent handed in, or the work hit an error: `phase`, `text`, and the `code` of the gate when one refused. |
| `note` | The harness noted something it did or saw: `phase`, `text`. |
| `scenario_closed` | The harness closed a `scenario` with a `verdict`, at the `level` of its plan when known. |
| `state_changed` | The session changed `state`: `running` once it started, then `completed` or `interrupted`. |

The agents are `cartographer`, `planner`, `plan_reviewer`, `writer`, `coherence_reviewer` and `code_reviewer`. The phases are `configuration`, `prerequisites`, `survey`, `card`, `consolidation`, `index`, `plan`, `review`, `write`, `execution` and `summary`.

A client ignores an event whose type it does not know, and reads a value it does not know — a phase, an agent, an outcome — as it would an absent one.

The texts of the events are those the agents and the harness wrote, never reworded, and whole: a message, a note, a refusal, every text the `arguments` of an action hold, its `result`, every line of its `look`. A person reads them to the end, and the end of a refusal says what to do. Only a runaway is cut, such as a tool that answers with a dump, so that an event every follower receives stays of a reasonable size: a text longer than 1 048 576 characters keeps that many, and ends on `…`.

### The scenarios of a plan

A scenario of a `plan_accepted` always has its `id`, its `title` and its `level`. The rest is what the plan said of it, each field present when the plan gave it, absent from a thread told before it was:

| Field | Meaning |
|---|---|
| `application`, `case` | The application it tests; `nominal`, or `negative` when the input matches nothing, is wrong or is forbidden. |
| `intent` | What it verifies, and why, in a sentence. |
| `kind` | What it checks: `functional`, `visual`, `accessibility` or `other`. |
| `effect` | `read` when its test only reads the data of the environment, `write` when it changes some. |
| `domain`, `feature` | The domain of the index it comes from, and the functionality of that domain it verifies. |
| `sources` | The sources it relies on: each a `source`, and the `item` of it the plan names. |
| `data` | The values its test enters: each a `value`, and `from`, the source or application that showed it, or `made-up`. |
| `steps` | Its steps, in order: each an `action` of the user, the `expects` it is checked by — a `result`, the texts the screen `shows` and those it no longer shows, `absent` — and `restores`, true for the step that puts back what the scenario changed. |

The numbers of the browser actions a step cites are left out: the harness alone reads them.

### Following and resuming

The stream opens on a message without data: its `retry` tells the client how long to wait, in milliseconds, before it opens a stream that was cut again, and its `id` repeats the identifier the stream resumes after, `0` from the start.

While the session has nothing to say, the stream carries a comment every 15 seconds, which keeps a proxy from cutting a connection it believes idle during a long call to a model. `EventSource` ignores comments:

```text
: heartbeat
```

The stream ends once the session ended: after the `state_changed` event that tells it is `completed` or `interrupted`, the server closes the stream, and the session then carries its result. A session that waits its turn has not ended: its stream stays open, and carries its events once it started. The client closes its side when it gets the event that ends the session: an `EventSource` left open would reconnect, and get a stream that ends at once.

A client that reconnects names the last event it got, and gets only the events after it. `EventSource` does so by itself, in the `Last-Event-ID` header. A client that opens a new stream and cannot set a header names it in the address instead; the header wins when both are present:

```http
GET /api/sessions/session-2026-11-14T09-00-00-000Z-9f3a1c2b/events
Last-Event-ID: 2
```

```http
GET /api/sessions/session-2026-11-14T09-00-00-000Z-9f3a1c2b/events?after=2
```

An identifier that is no whole number is refused with `400` and the code `invalid_request`, in the header as in the address.

The server also ends the stream when the events can no longer be read, which it logs as a warning, and when the API stops. The client opens it again, and resumes after the last event it got.

## Opening a session

```http
POST /api/sessions
content-type: application/json

{"request":"cover the search of a customer","environment":"local"}

HTTP/1.1 201 Created
content-type: application/json; charset=utf-8
location: sessions/session-2026-11-16T08-12-45-120Z-4be07d1a

{"id":"session-2026-11-16T08-12-45-120Z-4be07d1a","request":"cover the search of a customer","environment":"local","openedAt":"2026-11-16T08:12:45.120Z","lastEventAt":"2026-11-16T08:12:45.131Z","state":"running"}
```

| Field | Value |
|---|---|
| `request` | What to test, in the words of the person: a text that is not empty, of 4000 characters at most, that does not start with `--`. |
| `environment` | The environment to work against: a text that is not empty and does not start with `--` when given; the only one the project declares when left out. |

The answer is the session: `running` when it started at once, `queued` when another session runs and it waits its turn. `Location` is where to read it, as a reference relative to the address of the request: it resolves to the session behind a proxy that serves the API under a prefix. Any other field is refused.

The API takes every session it is asked for, whatever runs already: one session runs at a time, in the test repository the API was started with, and the next starts when it ended, in the order they were asked for. A request the run cannot go through — an environment the project does not declare, a prerequisite the machine lacks — is taken all the same: its session tells why in its events, and ends `interrupted`.

| Status | Code | When |
|---|---|---|
| `400` | `invalid_request` | The body is not valid; the detail names the field at fault. |
| `503` | `unavailable` | The API was started without a test repository, and the detail says to set `OQAS_REPOSITORY`; or the database of the instance cannot be reached. |

## Sending a message

A person corrects the direction of a session that goes on by sending it a message:

```http
POST /api/sessions/session-2026-11-16T08-12-45-120Z-4be07d1a/messages
content-type: application/json

{"text":"not the admin pages: only what a customer sees"}

HTTP/1.1 202 Accepted
content-type: application/json; charset=utf-8

{"number":1}
```

| Field | Value |
|---|---|
| `text` | What the person says to the agents: a text that is not empty, of 4000 characters at most. |

Any other field is refused. The answer is `202`: the message is taken, not delivered yet. `number` is its number in the session, from 1, which the events repeat.

The stream of the session then tells what becomes of it:

1. A `user_message` with that `number`, once the message is taken.
2. A `message_delivered` whose `message` is that number, once it reached an `agent`. A message reaches the agent at work at its next action. When no agent that can receive it is at work — the session still waits its turn, for one — it waits for the next agent that can, and is delivered then.
3. No `message_delivered` when no agent is at work any more: the session then tells it, before it ends, with a `note` of the `summary` phase that names the message.

A message is given to one agent, once. Where it conflicts with the request that opened the session, or with the plan, the agents follow the message.

| Status | Code | When |
|---|---|---|
| `400` | `invalid_request` | The body is not valid; the detail names the field at fault. |
| `404` | `unknown_session` | The session does not exist. |
| `409` | `session_ended` | The session is `completed` or `interrupted`: it takes no message. Open another session to go on. |
| `503` | `unavailable` | The database of the instance cannot be reached. |

## Interrupting a session

```http
POST /api/sessions/session-2026-11-16T08-12-45-120Z-4be07d1a/interruption

HTTP/1.1 202 Accepted
```

The request has no body, and neither has the answer. A session that waits its turn is interrupted at once, and never runs. A session that runs is asked to stop: nothing is killed, its agents refuse to go on — in the middle of a call to the model too — and its run ends by itself, which takes a moment longer when an installation or the tests are under way. The stream of the session tells what the run still said, then a `state_changed` to `interrupted`, which ends it. What the run wrote in the test repository stays there, and the session has no result.

| Status | Code | When |
|---|---|---|
| `404` | `unknown_session` | The session does not exist. |
| `409` | `session_ended` | The session is `completed` or `interrupted` already. |
| `503` | `unavailable` | The database of the instance cannot be reached. |

## Problems

Every answer of the API that is not a success — of these routes, of a route that does not exist, of a body that cannot be read — is a problem, as [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) describes one, served as `application/problem+json`. The readiness route alone keeps [a body of its own](running.md#readiness).

```http
HTTP/1.1 404 Not Found
content-type: application/problem+json; charset=utf-8

{"type":"/problems/unknown-session","title":"Unknown session","status":404,"detail":"No session session-2026-11-14T09-00-00-000Z-9f3a1c2b.","code":"unknown_session"}
```

| Field | Value |
|---|---|
| `type` | A reference that names the kind of problem, relative to the root of the API; the same for every problem of one code. |
| `title` | The kind of problem, in a few words; the same for every problem of one code. |
| `status` | The HTTP status of the answer. |
| `detail` | What went wrong this time, and what to do about it. |
| `code` | What a client decides on. |

| Code | Status | Type | When |
|---|---|---|---|
| `unknown_session` | `404` | `/problems/unknown-session` | The session does not exist. |
| `invalid_request` | `400` | `/problems/invalid-request` | The request is not valid: a body that is not JSON, a field of `POST /api/sessions` or of a message at fault, an identifier of event that is none. The detail names what is at fault. |
| `session_ended` | `409` | `/problems/session-ended` | The session no longer goes on: it takes no message, and no interruption. |
| `unavailable` | `503` | `/problems/unavailable` | The database of the instance cannot be reached: neither the project nor a session can be read, asked for or sent a message; try again once [the instance reports itself ready](running.md#readiness). Or a session is asked of an API that was started without a test repository: the detail says what to set. |
| `error` | any other | `/problems/error` | Anything else: a route that does not exist (`404`), a media type the API does not read (`415`), or a failure of the API (`500`). |

A failure of the API is logged on the instance and answered `500` with a detail that says nothing of it: the message of such an error may name a file or an address of the machine.

The contract of the problems, in `@open-qa-stack/domain/sessions`, still names three codes the API no longer answers, `session_running`, `not_opened` and `opening_timed_out`: a client written for an earlier version reads them, and none is sent.

## Where sessions are kept, and what runs them

The routes hold no rule of the sessions. Each calls one operation of `Sessions`, of `@open-qa-stack/engine`, which this process hosts; the pipes that validate a body, the problems and the stream of server-sent events are all the API adds, since they are how HTTP says things.

| Route | Operation |
|---|---|
| `GET /api/project` | `project()` |
| `GET /api/sessions` | `sessions()` |
| `GET /api/sessions/:id` | `session(id)` |
| `GET /api/sessions/:id/events` | `events(id, after)`, whose events the API sends as they are told |
| `POST /api/sessions` | `open(opening)` |
| `POST /api/sessions/:id/messages` | `say(id, message)` |
| `POST /api/sessions/:id/interruption` | `interrupt(id)` |

The operations keep the sessions in [the database](../../store/docs/database.md#tables) of the instance — each change is one command of [the life of a session](../../store/docs/database.md#the-life-of-a-session) — and run each session opened here with the engine, in the test repository the API [was started with](running.md#configuration). What a session tells is written to the database, then the streams open on it are woken in the memory of the process: nothing listens to the database, and nothing polls it for a session the API runs. The identifier of an event is its rank in its session, given once when the event is written and never changed: a client that resumes a stream after an identifier gets the same events whatever happened since.

When it starts, the API saves the project of its test repository — the name of its folder, and the applications its `oqas.json` declares — interrupts the sessions a process that died left `running`, takes over those it left waiting, and starts them in order. [The engine](../../engine/docs/engine.md#the-operations-on-sessions) tells how a message and an event travel, and how a session ends.

[The `oqas` command](../../cli/docs/solo-command.md) says the same operations in a terminal, on the same database: a session `oqas --brief` opens is a session of the instance, which runs in the process of that terminal. The API lists it and gives it by its identifier as any other; its stream follows it by reading the database again, twice a second; a message sent to it is taken, numbered and answered `202`, and the terminal that runs it hands it to its agents within a second; an interruption is answered `202`, and that terminal interrupts the session within a second — at once when the terminal died. [The engine](../../engine/docs/engine.md#several-processes-on-one-store) tells how the processes meet in the database.

### Without the database

An instance [starts all the same](running.md#startup) when its database cannot be reached, and reports itself not ready. It then has nothing to serve: every route of the project and of the sessions answers `503` with the code `unavailable`, a stream included, and a stream that was open ends, which the instance logs as a warning. Once the database answers, the same routes serve it: nothing is to be started again. An API whose database did not answer when it started puts it in order — the project, the sessions left running — when a session is next opened.

### What a session tells

What a run says — the entries of its journal and the lines of the traces of its agents — and how it reads as the events of a session are declared in `@open-qa-stack/domain`: `RunThread` writes the thread, the same for every host of the engine. The operations give it each entry and each line as the run tells it, and append what comes out; the store tells itself what the person says, and the delivery of each message.

What the agents do comes from the traces, and what the run does around them from its journal. The journal also relays, once a step is over, what the harness journaled in the traces of the cartography and of the design: those entries are left out, but the errors no trace tells, which are what the run says itself — why a design stopped before any agent worked, for one. Such an error is a `refusal`, under the phase `survey` for the cartography and `plan` for the design, since the journal names the step and not the phase. An error is the same as one a trace tells when it bears the same message, after the name of its source when the trace gives one; the same message journaled twice is two errors.

An agent builds its plan over several calls of `propose_plan`, and closes it with a call that proposes nothing: the call the harness accepts does not carry the plan. The `scenarios` of a `plan_accepted` are those the agent proposed since its plan phase started, a later one replacing an earlier one of the same identifier. When the harness journals which scenarios it accepted, `The plan was accepted: a, b.`, they are those it names, in that order: it may have refused or set aside others in between.

What the thread does not tell:

- A scenario of an accepted plan that names no level, in a pass that names none, is left out of `plan_accepted`: the contract requires the level of a scenario.
- A scenario the harness accepted and the agent did not propose in the same plan phase is left out of `plan_accepted` too: only its identifier is known.
- An error of the journal of the cartography is told under `survey` whatever phase it happened in.
- The end of a phase, the counts of the harness and the end of a turn of an agent are not told: the events have no type for them.
- A message taken at the very moment its run ends may be neither delivered nor told as not delivered: the run had already read its messages for the last time.
