# Sessions

A session is a request made to the agents, and the work it opened. The API gives the project of the instance, its sessions, the events of each session as they happen, and opens new sessions. The web console follows the agents through these routes.

The shapes of every body are the types of `@open-qa-stack/shared/sessions`. A client ignores a field, a type of event or a value it does not know: fields, types and values are added over time.

| Route | Answer |
|---|---|
| `GET /project` | The project. |
| `GET /sessions` | The list of the sessions, the latest first. |
| `GET /sessions/:id` | One session. |
| `GET /sessions/:id/events` | The events of a session, as a stream of server-sent events. |
| `POST /sessions` | Opens a session. |

The project, the list and a session are answered with `cache-control: no-store`: they are read as they are now. Every answer that is not a success is [a problem](#problems).

## Project

```http
GET /project

HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
cache-control: no-store

{"name":"shop-tests","applications":[{"id":"shop","name":"Shop"}]}
```

| Field | Value |
|---|---|
| `name` | The name of the project; left out on an instance without a source of sessions. |
| `applications` | Its applications, each with its `id` and its `name`. |

## Session

```http
GET /sessions/oqas-2026-11-14T09-00-00-000Z

HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
cache-control: no-store

{"id":"oqas-2026-11-14T09-00-00-000Z","request":"cover the search of a customer","environment":"local","openedAt":"2026-11-14T09:00:00.000Z","lastEventAt":"2026-11-14T09:01:53.612Z","state":"completed","result":{"outcome":"passed","durationMs":113600,"modelRequests":50,"branch":"oqas/design-20261114T090002Z","tests":[{"id":"shop › customers.spec.ts:3 › Search a customer","verdict":"passed","reason":"Every attempt passed."}]}}
```

| Field | Value |
|---|---|
| `id` | The identifier of the session. |
| `request` | What was asked, in the words of the person; left out when nothing was, or while it is not known yet. |
| `environment` | The environment the work targets, once it is known. |
| `openedAt` | When the session was opened, as an ISO 8601 date. |
| `lastEventAt` | When its last event happened. |
| `state` | See below. |
| `result` | What the session came to; present once it is `completed`. |

| State | Meaning |
|---|---|
| `running` | The agents work. |
| `completed` | The work ended; `result` tells how. |
| `interrupted` | The work stopped without ending. |

A client reads a state it does not know as a session that no longer goes on.

| Field of `result` | Value |
|---|---|
| `outcome` | `passed` when every test passed, `failed` when one failed, `inconclusive` when one has no verdict of success or failure, `stopped` when the work did not go to its end. |
| `durationMs` | How long the work took, in milliseconds. |
| `modelRequests` | How many requests it sent to the model. |
| `branch` | The branch of the test repository its tests were written on, when they were. |
| `tests` | The verdict of each test: its `id`, its `verdict` and the `reason`. The verdict is `passed`, `failed`, `blocked`, `indeterminate`, `skipped` or `not_run`; anything else a session came to is told as `indeterminate`. |

`GET /sessions` answers the sessions, the latest first, as the `items` of an object, which leaves room for what a list will carry besides them:

```http
GET /sessions

HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
cache-control: no-store

{"items":[{"id":"oqas-2026-11-14T09-00-00-000Z","openedAt":"2026-11-14T09:00:00.000Z","lastEventAt":"2026-11-14T09:01:53.612Z","state":"interrupted"}]}
```

## Events

`GET /sessions/:id/events` answers `text/event-stream`: every event of the session in the order of their identifiers, then each new one as it happens. Each event is one message, whose `id` is the identifier of the event and whose data is the event as JSON:

```http
GET /sessions/oqas-2026-11-14T09-00-00-000Z/events

HTTP/1.1 200 OK
content-type: text/event-stream

id: 0
retry: 3000

id: 1
data: {"id":1,"at":"2026-11-14T09:00:00.000Z","type":"phase_started","phase":"configuration"}

id: 2
data: {"id":2,"at":"2026-11-14T09:00:00.004Z","type":"note","phase":"configuration","text":"The configuration is valid; the run targets the environment local."}
```

Every event has an `id`, its rank in the session from 1, the date `at` it happened, and a `type`:

| Type | Meaning |
|---|---|
| `user_message` | The person asked something: `text`. |
| `agent_message` | An agent wrote something, or reasoned when `reasoning` is true: `agent`, `text`. |
| `harness_message` | The harness asked something of an agent, `to`: its request, then each reminder; `level` when it asks for the plan of one level of the test pyramid. |
| `phase_started` | A `phase` of the work started, on a knowledge `source` or for the test of a `scenario` when it has one. |
| `action_started` | An agent called a `tool` with `arguments`; `action` identifies the call. |
| `action_finished` | The tool answered: the `action`, its `outcome` (`passed`, `failed`, or `done` when the answer says neither), the `result`, `durationMs`, and the `look` of the page it rendered or of the file it was handed. |
| `plan_accepted` | The harness accepted a plan: its `scenarios`. |
| `refusal` | The harness refused what an agent handed in, or the work hit an error: `phase`, `text`, and the `code` of the gate when one refused. |
| `note` | The harness noted something it did or saw: `phase`, `text`. |
| `scenario_closed` | The harness closed a `scenario` with a `verdict`, at the `level` of its plan when known. |
| `state_changed` | The session changed `state`. |

The agents are `cartographer`, `planner`, `plan_reviewer`, `writer`, `coherence_reviewer` and `code_reviewer`. The phases are `configuration`, `prerequisites`, `survey`, `card`, `consolidation`, `index`, `plan`, `review`, `write`, `execution` and `summary`.

A client ignores an event whose type it does not know, and reads a value it does not know — a phase, an agent, an outcome — as it would an absent one.

The texts of the events are those the agents and the harness wrote, never reworded. An event is bounded, whatever an agent handed to a tool; a text that is cut ends on `…`:

| What | Bound |
|---|---|
| The `text` of a message, of a note or of a refusal | 2000 characters. |
| Every text the `arguments` of an action hold, however deep | 2000 characters each. |
| The `result` of an action | 1000 characters. |
| The `look` of an action | Its first 28 lines, 240 characters each. |

### Following and resuming

The stream opens on a message without data: its `retry` tells the client how long to wait, in milliseconds, before it opens a stream that was cut again, and its `id` repeats the identifier the stream resumes after, `0` from the start.

While the session has nothing to say, the stream carries a comment every 15 seconds, which keeps a proxy from cutting a connection it believes idle during a long call to a model. `EventSource` ignores comments:

```text
: heartbeat
```

The stream ends once the session is no longer running: after the `state_changed` event that tells it is `completed` or `interrupted`, the server closes the stream, and the session then carries its result. The client closes its side when it gets that event: an `EventSource` left open would reconnect, and get a stream that ends at once.

A client that reconnects names the last event it got, and gets only the events after it. `EventSource` does so by itself, in the `Last-Event-ID` header. A client that opens a new stream and cannot set a header names it in the address instead; the header wins when both are present:

```http
GET /sessions/oqas-2026-11-14T09-00-00-000Z/events
Last-Event-ID: 2
```

```http
GET /sessions/oqas-2026-11-14T09-00-00-000Z/events?after=2
```

An identifier that is no whole number is refused with `400` and the code `invalid_request`, in the header as in the address.

The server also ends the stream when the events can no longer be read, which it logs as a warning, and when the API stops. The client opens it again.

## Opening a session

```http
POST /sessions
content-type: application/json

{"request":"cover the search of a customer","environment":"local"}

HTTP/1.1 201 Created
content-type: application/json; charset=utf-8
location: sessions/oqas-2026-11-16T08-12-45-120Z

{"id":"oqas-2026-11-16T08-12-45-120Z","openedAt":"2026-11-16T08:12:45.120Z","lastEventAt":"2026-11-16T08:12:45.131Z","state":"running"}
```

| Field | Value |
|---|---|
| `request` | What to test, in the words of the person: a text that is not empty, of 4000 characters at most, that does not start with `--`. |
| `environment` | The environment to work against: a text that is not empty and does not start with `--` when given; the only one the project declares when left out. |

The answer is the session, `running`. `Location` is where to read it, as a reference relative to the address of the request: it resolves to the session behind a proxy that serves the API under a prefix. Any other field is refused.

One session works at a time: while a session is `running`, or another is being opened, the answer is `409` with the code `session_running`.

## Problems

Every answer of the API that is not a success — of these routes, of a route that does not exist, of a body that cannot be read — is a problem, as [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) describes one, served as `application/problem+json`. The readiness route alone keeps [a body of its own](running.md#readiness).

```http
HTTP/1.1 404 Not Found
content-type: application/problem+json; charset=utf-8

{"type":"/problems/unknown-session","title":"Unknown session","status":404,"detail":"No session oqas-2026-11-14T09-00-00-000Z.","code":"unknown_session"}
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
| `invalid_request` | `400` | `/problems/invalid-request` | The request is not valid: a body that is not JSON, a field of `POST /sessions` at fault, an identifier of event that is none. The detail names what is at fault. |
| `session_running` | `409` | `/problems/session-running` | A session is running, or being opened: it must end before another is opened. |
| `unavailable` | `503` | `/problems/unavailable` | The instance cannot open sessions; the detail says what to configure. |
| `not_opened` | `502` | `/problems/not-opened` | What runs the sessions did not open it; the log of the instance says why. |
| `opening_timed_out` | `503` | `/problems/opening-timed-out` | The session did not start in time. |
| `error` | any other | `/problems/error` | Anything else: a route that does not exist (`404`), a media type the API does not read (`415`), or a failure of the API (`500`). |

A failure of the API is logged on the instance and answered `500` with a detail that says nothing of it: the message of such an error may name a file or an address of the machine.

## Where sessions come from

The routes read the sessions from one source, behind which the rest of the API knows nothing of where they are kept.

Workers will run the agents and write the events of each session to the database of the instance; the source will then read them there. Workers do not exist yet. Until they do, an instance can show the runs of the `oqas` command line in a test repository on its own machine:

- `OQAS_SOLO_REPOSITORY` names the test repository. Each run it holds is a session, under the identifier of the run; its events are read from the journal and the traces the run writes in the state folder of the repository, which the API never writes to. A run is `running` from its start, `completed` once it wrote its state, and `interrupted` when it wrote no state and nothing else for ten minutes. The state folder is the one the configuration of the repository declares, `repository.stateDir` of `oqas.json`, when it is a relative path that stays inside the repository; otherwise the instance logs a warning and reads the default folder, `.oqas`.
- `OQAS_SOLO_COMMAND` names the command that starts `oqas`. `POST /sessions` starts it, without a shell, with `--repository`, `--brief` and, when the request names one, `--environment`. The command is given the environment of the API without the variables [marked secret](running.md#configuration): the URL of the database does not reach it. The run goes on when the request is answered, and when the API stops. The request is answered once the journal of the run exists. When the command stops before that, the answer is `502`: what the command wrote to its error output is logged on the instance as a warning, its last ten lines at most, and never answered. When the run has not started after 30 seconds, the command and every program it started are stopped, and the answer is `503`.

Two runs must not work in the same repository at once: a session is opened only when no run of the repository is `running`, the runs someone started by hand included, and one at a time. A run that was killed without writing its state therefore holds the next opening back until it is called `interrupted`, ten minutes after its last write.

Without `OQAS_SOLO_REPOSITORY`, the instance has no session and its project has no name; without `OQAS_SOLO_COMMAND`, it shows sessions and cannot open one. `POST /sessions` then answers `503` with the code `unavailable`. At startup, the instance logs a warning when `OQAS_SOLO_REPOSITORY` names what is no folder, and when `OQAS_SOLO_COMMAND` is set without it; it starts all the same. See [the configuration](running.md#configuration).

This bridge has limits the database will not have:

- The events of a session are numbered by reading the files of its run from their start, every 250 milliseconds while a stream follows it. A line is told once the date it bears is older than that pace, which leaves the run the time to write the lines it dated before: every reading then numbers the events the same. Their identifiers are stable as long as those files only grow, which is what a run does. A file that is rewritten or removed, or a run that writes again after it was called interrupted, renumbers the events that follow: a client that resumes from an identifier it got before may then miss an event, or get one twice.
- A stream ends when its run is called `interrupted`. A run that writes again afterwards is `running` again, and a stream opened then follows it.
- A scenario of an accepted plan that names no level, in a pass that names none, is left out of `plan_accepted`: the contract requires the level of a scenario.
- A run someone starts by hand in the same repository at the moment a session is opened is taken for that session.
- The end of a phase, the counts of the harness and the end of a turn of an agent are not told: the events have no type for them.
