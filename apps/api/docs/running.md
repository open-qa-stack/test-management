# Running the API

`@open-qa-stack/api` is the back end of an instance: a NestJS application on the Fastify adapter. It keeps its state in one database, described in [the database](../../../packages/store/docs/database.md): a SQLite file in its test repository unless it is given another. It needs nothing installed beside it: no database server, identity provider, secret manager or cache. SQLite comes with the dependencies, as [a native module whose binaries are in its package](../../../packages/store/docs/database.md#sqlite). It is the process of an instance that stays: it serves the sessions under `/api`, and [the console](#the-console) beside them when it is given one, and runs those it is asked for with [the engine](../../../packages/engine/docs/engine.md), one at a time, in the test repository it is given. [The `oqas` command](../../cli/docs/oqas-command.md), run on the same test repository, reaches the same database: the API serves the sessions a terminal opened, and a terminal reads, follows, speaks to and interrupts those the API runs.

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
| `OQAS_REPOSITORY` | the absolute path of a folder | no | no | | `/srv/tests` | The test repository the sessions run in. Without it, the API serves the sessions it holds and opens none. |
| `OQAS_CONSOLE` | the absolute path of a folder that holds index.html | no | no | | `/srv/console` | The built console, which the API then serves on its own address, beside its routes. Without it, the API serves its routes alone. |

The database is a setting, and has a default:

- **Without `OQAS_DATABASE_URL`**, the database is a SQLite file, `oqas.db`, in the state folder of the test repository — `.oqas`, unless `oqas.json` names another under `repository.stateDir`. The API makes the folder and the file when they are missing; there is nothing to install and nothing to prepare. `oqas --init` has git ignore the file.
- **With `OQAS_DATABASE_URL`**, the database is the one the URL names: a PostgreSQL server, `postgres://…`, or a SQLite file kept elsewhere, `sqlite:<path>`. Everything the API does is the same on both; [the database](../../../packages/store/docs/database.md#one-schema-two-databases) says what each is for.

`OQAS_CONSOLE` names the folder of [the built console](#the-console), which the API then serves on its own address.

One of `OQAS_DATABASE_URL` and `OQAS_REPOSITORY` must be set: the API refuses to start with neither, in a message that names both.

`OQAS_REPOSITORY` names the test repository the sessions run in, on the machine of the API. Without it the API starts, serves the project and the sessions its database holds, and refuses to open a session with `503` and the code [`unavailable`](sessions.md#problems), in a detail that says what to set.

The variables [the configuration of the test repository](../../../packages/domain/docs/configuration.md) names — the key of the model, the test accounts, a connection string — are read from the same environment by each run, as the command line reads them: set them for the API as you would for `oqas`. The programs a run starts — npm, the tests — are given the variables they need and no other: the URL of the database does not reach them.

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
- when the database answers but migrations are pending, the API does not start: the process exits with code `1` and writes to the error output how many migrations are pending, and that [the migration command](../../../packages/store/docs/database.md#migrations) applies them;
- when the database cannot be reached, the API starts all the same, logs a warning, and reports itself not ready until the database answers. Until then, its routes of the project and of the sessions answer `503` with the code [`unavailable`](sessions.md#problems); once the database answers, they serve it, without the API being started again.

Once its database answered, the API puts it in order before it runs anything: it saves the project of its test repository, interrupts the sessions a process that died left `running` — a process that was killed in the middle of one — which it logs, and takes over the sessions such a process left waiting, which it starts in the order they were asked for. When the database did not answer at startup, this is done when a session is next opened.

A process died when it stopped, or when it has not beaten on its sessions for 15 seconds: every process that runs sessions [beats on them in the database](../../../packages/engine/docs/engine.md#several-processes-on-one-store), every second. The sessions of a process that beats are left to it: an API that starts while a terminal runs `oqas --brief` on the same database interrupts nothing, serves that session, and takes it over in no case. An API that is killed and started again within those 15 seconds finds its former sessions not silent yet: it sees to them at the beat that follows, not at startup.

On a server, pending migrations are checked before the API listens, and by the readiness route; the other routes do not check them. A database that cannot be reached at startup and comes back later with migrations pending makes the readiness route answer `migrations_pending`, while the other routes keep serving on that schema: route requests to an instance only once it reports itself ready, and apply the migrations to make it ready.

## Health

`GET /api/health` answers as long as the process serves requests, without authentication:

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

`GET /api/health/ready` tells whether the instance can serve, without authentication. It answers `200` when the database answers and has applied every migration, and `503` otherwise; the process keeps answering in both cases.

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

## The console

The API serves its routes under `/api`, and nothing else there: a path under `/api` that is no route is answered with a problem, never with a page. Given the folder of a built console — `apps/web/dist` once `pnpm --filter @open-qa-stack/web build` ran — in `OQAS_CONSOLE`, it serves the console everywhere else, on the same address, so that the console reaches its instance on its own origin with no proxy between them:

- a path that names a file of the build is answered with that file, under the media type of its extension, with an `ETag` a browser asks again with. The files under `assets/`, which bear a hash of their content in their name, are kept for a year, `immutable`; any other, `index.html` first, is `no-cache`: a new build is seen at the next visit;
- a path that names no file and does not read as one — a route of the console — is answered with `index.html`; one that reads as a file, with an extension, is a route that does not exist;
- nothing out of the folder, and no file whose name starts with a dot, is ever served.

The folder is served by [`@fastify/static`](https://github.com/fastify/fastify-static), which lists its files when the API starts: a console built again is served once the API is started again. Without `OQAS_CONSOLE` the API serves its routes alone, and a reverse proxy that serves the console from elsewhere sends what is under `/api` to the API as it is, without rewriting the path. [`oqas --ui`](../../cli/docs/oqas-command.md#the-console) starts this same application in the process of the command, on this machine.

The API asks nobody who they are: whoever reaches its address reads the sessions, opens one and stops one. Keep it on a network you trust, or behind what authenticates for it.

## Starting the API from a program

The package has one entry, `startApi`, which its own program and the `oqas` command both call:

```ts
import { startApi } from "@open-qa-stack/api";

const api = await startApi({ host: "127.0.0.1", port: 0, database, repository, console, runs: { env } });
console.log(api.url);
await api.close();
```

It takes everything the API is started with as settings, and reads nothing else — the environment of the process included: the program of the package gives it what it read from its variables, a command what it read from its arguments. `port` `0` listens on any free port, which `url` tells. `signals` names the signals that close the API and end the process; without it, whoever started the API closes it. `logger` says where it logs. `runs` is what the runs of its sessions work with, the environment the configuration of the test repository reads its secrets from first.

## Sessions

The routes of the project and of the sessions and the stream of their events are described in [the sessions](sessions.md). The API hosts [the operations on sessions](../../../packages/engine/docs/engine.md#the-operations-on-sessions) of the engine: it keeps the sessions in the database, and runs those opened through it itself, one at a time, by calling the engine in its own process. There is no other process to start. What another process of the instance asks of a session the API runs — a message, an interruption, sent by `oqas say` and `oqas stop` — waits in the database, where the API reads it at its next beat, within a second.

The API holds no connection besides those to its database, the pool of a server or the one of a file: the streams of the sessions it runs are woken in memory, as it writes their events, and the stream of a session another process runs reads the database again twice a second.

The stream of events is long-lived: a proxy before the API must not buffer `text/event-stream` answers. The stream carries a comment every 15 seconds, so an idle timeout of the proxy above that is enough.

What the API logs of the sessions, under `Sessions`: a session that starts, one that is over, a session whose run failed, a write to the database that waits then goes through again, the sessions it found left running, and a database that does not answer its beat, then answers again.

## Stopping

On `SIGTERM` or `SIGINT`, the API ends the streams of events still open, starts no other session, and asks the session that runs to stop: its agents refuse to go on, its run ends by itself, and the session is written `interrupted`. The API waits for that up to 10 seconds, then closes its connections to the database, its modules and its server, and exits on that signal. The sessions that waited stay `queued`, and run when the API is back: it withdraws its beats when it stops, so that the API that starts next takes them over at once.

When the session did not end in time — an installation or the tests were under way — the API logs it and exits all the same: the session stays `running` in the database until a process that hosts sessions — the API when it starts again, or an `oqas --brief` — interrupts it, or someone asks for its interruption. So does the session of an API that was killed without a signal it can handle, once its silence lasted 15 seconds. A session that was interrupted is not resumed: ask for it again. What its run wrote in the test repository stays there — the branch of the design and its commits, the cards, the traces.

## Development

NestJS relies on legacy TypeScript decorators and on the metadata the compiler emits for them, which Node cannot strip from a `.ts` file. Unlike the other packages, this one is therefore compiled to `dist/` before it runs, and its tests run on the compiled files; coverage is mapped back to `src/` through the source maps. The packages of the workspace it imports, `@open-qa-stack/engine` and `@open-qa-stack/store` among them, hold no decorator: Node runs them from their sources.

The tests that go through a database are written once and run on both, a SQLite file and a real PostgreSQL server; see [the database](../../../packages/store/docs/database.md#tests). Those that run a session do so in a test repository made for them, with a model server that answers as scripted and doubles of npm and Playwright: no test calls a model.

Under that mapping, a line before the first or after the last statement that emits code counts as uncovered: in a module that holds code, put the value imports first, and keep a type declared alone at the top or at the bottom of a module in its own file.
