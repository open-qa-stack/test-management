# Running the API

`@open-qa-stack/api` is the back end of an instance: a NestJS application on the Fastify adapter. It keeps its state in one PostgreSQL database, described in [the database](database.md), and needs no identity provider, secret manager or cache.

```sh
pnpm --filter @open-qa-stack/api build
OQAS_DATABASE_URL=postgres://oqas@127.0.0.1:5432/oqas pnpm --filter @open-qa-stack/api migrate
OQAS_PORT=8080 OQAS_DATABASE_URL=postgres://oqas@127.0.0.1:5432/oqas pnpm --filter @open-qa-stack/api start
```

## Configuration

The API reads its configuration once, at startup, from environment variables only. Nothing else is read later.

| Variable | Type | Required | Secret | Default | Example | What it sets |
|---|---|---|---|---|---|---|
| `OQAS_HOST` | a text that is not empty | no | no | `0.0.0.0` | `127.0.0.1` | The address the API listens on. |
| `OQAS_PORT` | an integer from 1 to 65535 | yes | no | | `8080` | The TCP port the API listens on. |
| `OQAS_DATABASE_URL` | a PostgreSQL connection URL with a host name, starting with postgres:// or postgresql:// | yes | yes | | `postgres://oqas:change-me@127.0.0.1:5432/oqas` | The connection URL of the PostgreSQL database of the instance. |
| `OQAS_SOLO_REPOSITORY` | an absolute path | no | no | | `/srv/tests` | The test repository whose runs of the oqas command line the instance shows as sessions: a bridge, until workers write the sessions to the database. |
| `OQAS_SOLO_COMMAND` | a program and its arguments, separated by spaces, one that holds a space between quotes | no | no | | `node /clone/packages/cli/src/main.ts` | The command that starts oqas, which opening a session from the instance runs on that repository: part of the same bridge. |

A missing required variable or an invalid value stops the startup before anything listens. The process exits with code `1` and writes to the error output one line per variable at fault, naming the variable and the rule it breaks, never its value:

```text
The configuration is invalid:
- OQAS_PORT must be an integer from 1 to 65535.
```

A variable marked secret never appears in a log, an error message or a response, neither whole nor in part: an error of connection to the database is reported without the URL and without its password.

## Startup

The API checks its database before it listens:

- when the database answers and has applied every migration, the API starts;
- when the database answers but migrations are pending, the API does not start: the process exits with code `1` and writes to the error output how many migrations are pending, and that the migration command applies them;
- when the database cannot be reached, the API starts all the same, logs a warning, and reports itself not ready until the database answers.

Pending migrations are checked before the API listens, and by the readiness route; the other routes do not check them. A database that cannot be reached at startup and comes back later with migrations pending makes the readiness route answer `migrations_pending`, while the other routes keep serving on that schema: route requests to an instance only once it reports itself ready, and apply the migrations to make it ready.

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

## Errors

Every answer that is not a success is a problem, as RFC 9457 describes one, served as `application/problem+json`: a route that does not exist, a body the API cannot read and a failure of the API included. The readiness route alone answers `503` with the body above. A failure of the API is answered `500` without its message, which is logged. The body and its codes are described in [the problems](sessions.md#problems).

## Sessions

The routes of the project and of the sessions, the stream of their events and the two variables that bridge an instance to the `oqas` command line are described in [the sessions](sessions.md).

The stream of events is long-lived: a proxy before the API must not buffer `text/event-stream` answers. The stream carries a comment every 15 seconds, so an idle timeout of the proxy above that is enough. The command `OQAS_SOLO_COMMAND` names is started with the environment of the API without the variables marked secret above.

## Stopping

On `SIGTERM` or `SIGINT`, the API ends the streams of events still open, closes its modules and its server, then exits on that signal.

## Development

NestJS relies on legacy TypeScript decorators and on the metadata the compiler emits for them, which Node cannot strip from a `.ts` file. Unlike the other packages, this one is therefore compiled to `dist/` before it runs, and its tests run on the compiled files; coverage is mapped back to `src/` through the source maps.

The tests of data access run against a real PostgreSQL server; see [the database](database.md#tests).

Under that mapping, a line before the first or after the last statement that emits code counts as uncovered: in a module that holds code, put the value imports first, and keep a type declared alone at the top or at the bottom of a module in its own file.
