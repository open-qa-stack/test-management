# Running the API

`@open-qa-stack/api` is the back end of an instance: a NestJS application on the Fastify adapter. It keeps its state in one database, described in [the database](../../store/docs/database.md): a SQLite file in its test repository unless it is given another. It needs nothing installed beside it: no database server, identity provider, secret manager or cache. SQLite comes with the dependencies, as [a native module whose binaries are in its package](../../store/docs/database.md#sqlite). It is the one process of an instance: it serves the sessions, and runs those it is asked for with [the engine](../../engine/docs/engine.md), one at a time, in the test repository it is given.

```sh
pnpm --filter @open-qa-stack/api build
OQAS_PORT=8080 OQAS_REPOSITORY=/srv/tests pnpm --filter @open-qa-stack/api start
```

To keep the database on a PostgreSQL server instead, give its URL, and apply its migrations before the API starts:

```sh
OQAS_DATABASE_URL=postgres://oqas@127.0.0.1:5432/oqas pnpm --filter @open-qa-stack/api migrate
OQAS_PORT=8080 OQAS_DATABASE_URL=postgres://oqas@127.0.0.1:5432/oqas OQAS_REPOSITORY=/srv/tests \
  pnpm --filter @open-qa-stack/api start
```

## Configuration

The API reads its configuration once, at startup, from environment variables only. Nothing else is read later.

| Variable | Type | Required | Secret | Default | Example | What it sets |
|---|---|---|---|---|---|---|
| `OQAS_HOST` | a text that is not empty | no | no | `0.0.0.0` | `127.0.0.1` | The address the API listens on. |
| `OQAS_PORT` | an integer from 1 to 65535 | yes | no | | `8080` | The TCP port the API listens on. |
| `OQAS_DATABASE_URL` | a database URL: postgres:// or postgresql:// with a host name for a PostgreSQL server, or sqlite: followed by the path of a file | no | yes | | `postgres://oqas:change-me@127.0.0.1:5432/oqas` | The connection URL of the database of the instance, to keep it elsewhere than in the test repository. Without it, the database is a SQLite file in the state folder of the test repository. |
| `OQAS_REPOSITORY` | the absolute path of a folder that holds oqas.json | no | no | | `/srv/tests` | The test repository the sessions run in. Without it, the API serves the sessions it holds and opens none. |

The database is a setting, and has a default:

- **Without `OQAS_DATABASE_URL`**, the database is a SQLite file, `oqas.db`, in the state folder of the test repository — `.oqas`, unless `oqas.json` names another under `repository.stateDir`. The API makes the folder and the file when they are missing; there is nothing to install and nothing to prepare. `oqas --init` has git ignore the file.
- **With `OQAS_DATABASE_URL`**, the database is the one the URL names: a PostgreSQL server, `postgres://…`, or a SQLite file kept elsewhere, `sqlite:<path>`. Everything the API does is the same on both; [the database](../../store/docs/database.md#one-schema-two-databases) says what each is for.

One of `OQAS_DATABASE_URL` and `OQAS_REPOSITORY` must be set: the API refuses to start with neither, in a message that names both.

`OQAS_REPOSITORY` names the test repository the sessions run in, on the machine of the API. Without it the API starts, serves the project and the sessions its database holds, and refuses to open a session with `503` and the code [`unavailable`](sessions.md#problems), in a detail that says what to set.

The variables [the configuration of the test repository](../../domain/docs/configuration.md) names — the key of the model, the test accounts, a connection string — are read from the same environment by each run, as the command line reads them: set them for the API as you would for `oqas`. The programs a run starts — npm, the tests — are given the variables they need and no other: the URL of the database does not reach them.

A missing required variable or an invalid value stops the startup before anything listens. The process exits with code `1` and writes to the error output one line per variable at fault, naming the variable and the rule it breaks, never its value:

```text
The configuration is invalid:
- OQAS_PORT must be an integer from 1 to 65535.
```

A variable marked secret never appears in a log, an error message or a response, neither whole nor in part: an error of connection to the database is reported without the URL and without its password.

## Startup

The API brings its database in order before it listens. What it does depends on whom the database belongs to.

**A SQLite file** belongs to the instance alone, so there is no one to warn before its schema changes:

- the API opens the file, which it makes when it is missing, and applies the migrations it has not applied yet, then starts;
- when the file cannot be opened — its folder cannot be made, or the process may not write there — the API does not start: the process exits with code `1` and writes to the error output why, with the path of the file.

**A PostgreSQL server** may be shared, and may come back when it is away:

- when the database answers and has applied every migration, the API starts;
- when the database answers but migrations are pending, the API does not start: the process exits with code `1` and writes to the error output how many migrations are pending, and that [the migration command](../../store/docs/database.md#migrations) applies them;
- when the database cannot be reached, the API starts all the same, logs a warning, and reports itself not ready until the database answers. Until then, its routes of the project and of the sessions answer `503` with the code [`unavailable`](sessions.md#problems); once the database answers, they serve it, without the API being started again.

Once its database answered, the API puts it in order before it runs anything: it saves the project of its test repository, interrupts the sessions an earlier process left `running` — a process that was killed in the middle of one — which it logs, and starts the sessions that waited, in the order they were asked for. When the database did not answer at startup, this is done when a session is next opened.

On a server, pending migrations are checked before the API listens, and by the readiness route; the other routes do not check them. A database that cannot be reached at startup and comes back later with migrations pending makes the readiness route answer `migrations_pending`, while the other routes keep serving on that schema: route requests to an instance only once it reports itself ready, and apply the migrations to make it ready.

## Health

`GET /health` answers as long as the process serves requests, without authentication:

```http
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8

{"status":"ok"}
```

| Field | Value |
|---|---|
| `status` | Always `ok`: the process answered. |

The route reveals neither the configuration, nor the versions of the dependencies, nor anything about the host.

## Readiness

`GET /health/ready` tells whether the instance can serve, without authentication. It answers `200` when the database answers and has applied every migration, and `503` otherwise; the process keeps answering in both cases.

```http
HTTP/1.1 503 Service Unavailable
content-type: application/json; charset=utf-8

{"status":"not_ready","checks":{"database":"unreachable"}}
```

| Field | Value |
|---|---|
| `status` | `ready` or `not_ready`. |
| `checks.database` | `up`: the database answers and its schema is up to date. `unreachable`: no connection can be opened. `migrations_pending`: the database answers, but has not applied every migration. |

Each change of the state of the database is logged once, from the check at startup on, as a warning when the instance is not ready.

With a SQLite file, the route says little more than the health route: the API does not start without its file nor with a migration pending, and holds the file open from then on, so an instance that started answers `ready` as long as its process runs. It is kept so that whatever watches an instance asks the same question whichever database it has.

## Errors

Every answer that is not a success is a problem, as RFC 9457 describes one, served as `application/problem+json`: a route that does not exist, a body the API cannot read and a failure of the API included. The readiness route alone answers `503` with the body above. A failure of the API is answered `500` without its message, which is logged. The body and its codes are described in [the problems](sessions.md#problems).

## Sessions

The routes of the project and of the sessions and the stream of their events are described in [the sessions](sessions.md). The API hosts [the operations on sessions](../../engine/docs/engine.md#the-operations-on-sessions) of the engine: it keeps the sessions in the database, and runs them itself, one at a time, by calling the engine in its own process. There is no other process to start, and nothing between processes: no queue, no lock, no heartbeat.

The API holds no connection besides those to its database, the pool of a server or the one of a file: the streams of events are woken in memory, by the process that writes the events.

The stream of events is long-lived: a proxy before the API must not buffer `text/event-stream` answers. The stream carries a comment every 15 seconds, so an idle timeout of the proxy above that is enough.

What the API logs of the sessions, under `Sessions`: a session that starts, one that is over, a session whose run failed, a write to the database that waits then goes through again, and the sessions it found left running.

## Stopping

On `SIGTERM` or `SIGINT`, the API ends the streams of events still open, starts no other session, and asks the session that runs to stop: its agents refuse to go on, its run ends by itself, and the session is written `interrupted`. The API waits for that up to 10 seconds, then closes its connections to the database, its modules and its server, and exits on that signal. The sessions that waited stay `queued`, and run when the API is back.

When the session did not end in time — an installation or the tests were under way — the API logs it and exits all the same: the session stays `running` in the database until the API starts again, and interrupts it. So does the session of an API that was killed without a signal it can handle. A session that was interrupted is not resumed: ask for it again. What its run wrote in the test repository stays there — the branch of the design and its commits, the cards, the traces.

## Development

NestJS relies on legacy TypeScript decorators and on the metadata the compiler emits for them, which Node cannot strip from a `.ts` file. Unlike the other packages, this one is therefore compiled to `dist/` before it runs, and its tests run on the compiled files; coverage is mapped back to `src/` through the source maps. The packages of the workspace it imports, `@open-qa-stack/engine` and `@open-qa-stack/store` among them, hold no decorator: Node runs them from their sources.

The tests that go through a database are written once and run on both, a SQLite file and a real PostgreSQL server; see [the database](../../store/docs/database.md#tests). Those that run a session do so in a test repository made for them, with a model server that answers as scripted and doubles of npm and Playwright: no test calls a model.

Under that mapping, a line before the first or after the last statement that emits code counts as uncovered: in a module that holds code, put the value imports first, and keep a type declared alone at the top or at the bottom of a module in its own file.
