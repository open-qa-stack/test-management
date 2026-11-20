# The database

An instance keeps its state in one database: the project, the sessions, their events, the messages sent to them, the revisions of its configuration, and the documents uploaded to its knowledge sources. The processes that say [the operations on sessions](../../engine/docs/engine.md#the-operations-on-sessions) reach it — the API, and the `oqas` command in a terminal — each of which runs the sessions it opened, and [meets the others there](#several-processes-on-one-database). They do so through `@open-qa-stack/store`, which holds the schema of the database, its migrations, its connections, [the commands of the life of a session](#the-life-of-a-session), and [the one assembly of them](#the-database-of-an-instance-assembled) every process uses.

## One schema, two databases

Which database it is is a setting. The store has one schema, one series of migrations and one set of statements, written with [Kysely](https://kysely.dev), and the connection URL alone tells which database runs them:

| URL | Database | When |
|---|---|---|
| none | SQLite, in the file `oqas.db` of the state folder of the test repository, `.oqas` unless `oqas.json` names another | The default: nothing to install, nothing to configure. |
| `sqlite:<path>` | SQLite, in the file named | The same, with the file kept elsewhere. `sqlite::memory:` keeps it in memory, for a test. |
| `postgres://…`, `postgresql://…` | A PostgreSQL server | An instance whose database is kept on a server: shared, backed up and watched as the others of its host are. |

The URL is what every process of the instance reads from `OQAS_DATABASE_URL`, a secret read from the environment only: the API (see [running the API](../../api/docs/running.md#configuration)) and the `oqas` command alike. `instanceDatabaseUrl` resolves it for both: the URL given or, without one, the file in the state folder of the test repository.

Supported means tested: every test of the store and of the API that goes through a database is written once and runs on both, at every commit. The versions are those the tests run on: the SQLite of the better-sqlite3 the workspace pins, and PostgreSQL 18, in the image named in `compose.yaml` at the root of the repository, `postgres:18.7-alpine3.24`.

`openKysely`, in `packages/store/src/database/open-kysely.ts`, is the one place that turns a URL into a database. The rest of the store does not know which one it runs on, except [the migrations](#migrations), which name each type once for both, and `stored-values.ts`, where [what the two keep differently](#how-each-type-is-kept) meets.

### SQLite

The store runs SQLite with the SQLite dialect of Kysely on [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), which holds SQLite itself: an instance has no database to install.

- **One connection a process.** The one connection of a process is lent to one unit of work at a time, a statement alone or a whole transaction: what is read meanwhile waits, and never falls in the middle of what another writes.
- **Several processes on one file.** The processes of one instance on one machine — a server, commands in terminals — open the same file. One writes at a time: a write that finds another process writing waits for it, up to 5 seconds, instead of failing, and a write of the store takes milliseconds. Every transaction of the store starts by writing, so that none reads first and finds, when it writes, that another process wrote meanwhile. The file is not for processes on several machines: a file shared over a network does not hold these locks; an instance spread over machines keeps its database on a PostgreSQL server.
- **The file is made when needed**, with its folder, and kept with a write-ahead log: whoever reads it — another process, a backup, a shell — never stops a process from writing. SQLite keeps two files beside it while it is open, `oqas.db-wal` and `oqas.db-shm`: copy the three together, or copy the file once the instance stopped. `oqas --init` has git ignore them in a test repository.
- **better-sqlite3 is a native module.** Its package holds the binary of each platform it supports — Linux, with glibc or musl, macOS and Windows, on x64 and arm64 — so `pnpm install` downloads nothing more and needs no compiler: `pnpm-workspace.yaml` lists the module under `ignoredBuiltDependencies`, so that its build from source is not run. On another platform, move it to `onlyBuiltDependencies` and install again, with what [node-gyp](https://github.com/nodejs/node-gyp#installation) asks for: Python and a C++ compiler.

### PostgreSQL

A development database runs in a container, with [Docker](https://docs.docker.com/get-started/get-docker/) or [Podman](https://podman.io/docs/installation) and its compose provider as the only prerequisite. From the root of the repository:

```sh
docker compose up --detach   # or: podman compose up --detach
```

It listens on `127.0.0.1:5432`, or on the port set in `OQAS_DATABASE_PORT`, for the user `oqas` without a password, and keeps its data in the `oqas_database` volume. Its URL is `postgres://oqas@127.0.0.1:5432/oqas`. It accepts connections from this machine only and is meant for development only. `docker compose down --volumes` removes it with its data.

### Another database later

A database to support later is a dialect for Kysely, named in `openKysely` under the scheme of its URL, which `DatabaseUrl` learns to read. The migrations and the statements stay as they are as long as it has what they use — transactions, `returning`, `on conflict`. What it keeps differently goes in `stored-values.ts`, and the tests written for every database gain a third run: an entry in `packages/store/test/support/database-engine.ts`, and a project in `vitest.config.ts`. It is supported once they pass.

## Migrations

The schema is the type `StoreSchema`, in `packages/store/src/database/schema.ts`, which every statement of the store is checked against. It changes through the versioned migrations of `packages/store/src/database/migrations`, written with the schema builder of Kysely so that each runs unchanged on both databases, and applied in the order of their names, each one once. The database records those it applied in the table `kysely_migration`.

Who applies them depends on whom the database belongs to:

- **A SQLite file** belongs to the processes of one instance on one machine: whichever opens it first — the API when it starts, before it listens, or the `oqas` command — applies the pending migrations itself.
- **A PostgreSQL server** may be shared, so changing its schema is an explicit step, before the API or a command starts and after each upgrade; until then both refuse to go on, and say so:

```sh
pnpm --filter @open-qa-stack/api build
OQAS_DATABASE_URL=postgres://oqas@127.0.0.1:5432/oqas pnpm --filter @open-qa-stack/api migrate
```

The command belongs to the API, which reads the URL from its configuration; what it runs, `runMigrations`, belongs to the store. It applies every pending migration, then says how many it applied; run again, it changes nothing and says the schema is up to date. On PostgreSQL the series is one transaction: a migration that fails undoes those applied before it in the same run, and two runs at once on the same server apply each migration once. On SQLite each migration is applied and recorded in turn: one that fails stays pending, with those after it, and its error is raised. The command exits with code `1`, without the URL nor its password, when the database cannot be reached.

To change the schema, change the type and add a migration that brings a database to it, under the next number, in `packages/store/src/database/migrations/index.ts`. A migration that has been released is never edited: a correction is a new migration. The tests fail on both databases when a migrated database and the type differ: a table or a column that one has and not the other, what a column keeps, or whether it may be empty.

The migrations so far:

| Migration | What it brings |
|---|---|
| `0001_sessions` | The tables of the project, of the sessions, of their events and of the messages sent to them. |
| `0002_session_hosts` | The host of a session, the date of its last beat, and the interruption another process asked for: what [several processes on one database](#several-processes-on-one-database) meet through. The three columns are empty on the sessions that were there before, which read as left by a host that died. |
| `0003_configuration_revisions` | The table of [the revisions of the configuration](#the-revisions-of-the-configuration). An instance that had none synchronises its `oqas.json` into a first revision when a process next starts on it. |
| `0004_knowledge_documents` | The table of [the documents of the knowledge sources](#the-documents-of-the-knowledge-sources), empty until a document is uploaded. |
| `0005_executions` | The tables of [the executions of tests](#the-executions-of-tests) and of their results, empty until a session runs its tests. |
| `0006_execution_failures` | Where each test that failed in an execution failed, and why. The results kept before stay without them. |

## The database of an instance, assembled

`InstanceDatabase` is the database of an instance as a process gets it, assembled once for all of them: given the URL `instanceDatabaseUrl` resolved and the logger of the process, it holds the connection (`database`), the migrations (`migrations`), their status (`status`), the store of the sessions (`sessions`), that of the configuration (`configuration`), that of the documents (`documents`) and that of the executions (`executions`), and opens nothing until a statement needs it. The API provides its parts to its modules; the `oqas` command hands its store to the operations.

`prepare()` is the one rule that brings the schema in order before a process reads anything: on a SQLite file it applies the pending migrations; on a server it applies none, and raises `PendingMigrationsError` — `The database schema is not up to date: 2 migrations are pending. Apply them with the migration command, then start again.` — when some are pending. A server that cannot be reached is not refused there: its status reports it, and what reads the database next raises `DatabaseUnavailableError`, so that a server that starts before its database still starts.

Neither the API nor the command depends on the other: both depend on the store for the database, and on the engine for the operations they hand that store to.

## How each type is kept

A migration names a type once. PostgreSQL has each of them. SQLite keeps the name and gives the column no type of its own: it stores what it is given. It also takes an empty key unless told otherwise, so a migration says `notNull` of a primary key too.

| What a column keeps | Named in a migration | PostgreSQL | SQLite |
|---|---|---|---|
| A text | `text` | `text` | The text. |
| A whole number | `integer` | `integer` | The integer. |
| A date | `timestamptz(3)` | `timestamp (3) with time zone` | The text of the date in ISO 8601, in UTC, to the millisecond, such as `2026-11-16T08:12:45.120Z`: these texts sort as the dates do. |
| A JSON value | `json` | `json`, which keeps the text as it was written | The JSON text. |
| A boolean | `boolean` | `boolean` | The integer `0` or `1`. |

The store writes a date and a JSON value as the same text to both, and reads back what each gives — a `Date` and a parsed value from the client of PostgreSQL, the text from SQLite. Both directions go through `packages/store/src/database/stored-values.ts`, and nowhere else: `instant`, which also refuses a text that is no date, `storedJson` and `jsonOf`. The one boolean of the schema is filled by the database and never read.

## Tables

The database keeps the project of the instance, its sessions, the events of each session, the messages a person sent to it, the revisions of its configuration, and the documents uploaded to its knowledge sources. [The sessions](../../api/docs/sessions.md#where-sessions-are-kept-and-what-runs-them) tell who writes what.

`project` holds one row at most: a check on its key refuses a second one.

| Column | Type | Why |
|---|---|---|
| `only` | `boolean`, primary key, always true | What holds the table to one row. |
| `name` | `text`, nullable | A project may have no name yet. |
| `applications` | JSON | The applications, each with its `id` and its `name`: served whole, never filtered on. |

`sessions` holds one row a session.

| Column | Type | Why |
|---|---|---|
| `id` | `text`, primary key | The identifier the store gave the session when it was [asked for](#the-life-of-a-session). Nothing is read in it. |
| `request`, `environment` | `text`, nullable | What the person asked, and where; the environment is left out of a session that names none. |
| `opened_at`, `last_event_at` | date | Dates are served to the millisecond; the sessions are listed by the first, the latest first. |
| `state` | `text` | `queued`, `running`, `completed` or `interrupted`. States are added over time, and a client reads one it does not know: an enumerated type would need a migration for each. |
| `result` | JSON, nullable | Present once the session is completed: served whole, never filtered on. |
| `host` | `text`, nullable | The process that hosts the session, as it names itself: the one that asked for it, then whichever started it or took it over. Empty on a session an earlier version asked for. |
| `host_seen_at` | date, nullable | The last beat of that process on the session, while it goes on. Empty once the host withdrew its beats, when it stopped: an empty beat and an old one both tell a host that is gone. |
| `interruption_requested_at` | date, nullable | When a process that does not run the session asked that it be interrupted; its host reads it at its next beat. |

The sessions that wait are started by the process that hosts them, in an order it keeps in memory; a host that stays makes that order again from this table for the sessions it takes over: no index serves a queue.

`session_events` holds one row an event.

| Column | Type | Why |
|---|---|---|
| `session_id` | `text`, references `sessions`, removed with its session | The session of the event. |
| `id` | `integer` | The rank of the event in its session, from 1: the identifier a stream resumes after. |
| `at` | date | When it happened. |
| `type` | `text` | Types are added over time; the changes of state of a session are read by it. |
| `payload` | JSON | What the event carries besides its rank, its date and its type. |

The primary key of an event is its session and its rank. A rank is given once, in the transaction that writes the event, which holds the row of its session: a client that resumes a stream after a rank gets the same events whatever happened since.

`session_messages` holds one row a message a person sent to a session that went on.

| Column | Type | Why |
|---|---|---|
| `session_id` | `text`, references `sessions`, removed with its session | The session of the message. |
| `number` | `integer` | The number of the message in its session, from 1: what its receipt and its events repeat. |
| `at` | date | When the person sent it. |
| `text` | `text` | What the person says to the agents. |
| `delivered_to` | `text`, nullable | The agent that received it; empty while the message waits for one. |
| `delivered_at` | date, nullable | When it received it. |

The primary key of a message is its session and its number. A number is given once, in the transaction that takes the message, which holds the row of its session: two messages sent at the same moment take two numbers that follow each other.

`configuration_revisions` holds one row a revision of the configuration.

| Column | Type | Why |
|---|---|---|
| `number` | `integer`, primary key | The number of the revision, from 1, given once: the revision in force is the one with the highest. |
| `recorded_at` | date | When it was recorded. |
| `origin` | `text` | `file`, `console` or `command`: where the revision comes from, as [the operations on the configuration](../../engine/docs/engine.md#the-operations-on-the-configuration) tell. |
| `file_digest` | `text` | The SHA-256 digest of the `oqas.json` the revision was read from or wrote, which tells whether the file changed since. |
| `document` | JSON | The whole configuration, as `oqas.json` holds it: served whole, never filtered on. Like the file, it names the environment variables that hold the secrets, and holds none. |

`knowledge_documents` holds one row a document uploaded to a knowledge source declared `stored`.

| Column | Type | Why |
|---|---|---|
| `source` | `text`, primary key with `name` | The identifier of the knowledge source, as the configuration declares it. |
| `name` | `text` | The file name of the document, unique in its source. |
| `uploaded_at` | date | When it was uploaded last. |
| `bytes` | `integer` | The size of its text in UTF-8, which a listing tells without reading the text. |
| `text` | `text` | The document, whole. |

### The executions of tests

`executions` holds one row an execution of tests, and `execution_results` one row each test of it. `ExecutionStore` keeps an execution in one transaction, with all of its results or none. It reads them a page at a time, the latest first — by date then identifier, a page going on after the last execution of the one before it — narrowed to those where a test failed or none did, and to those kept from a date on, with how many the query keeps and the rank of the first of the page among them; one by its identifier, or what came of the tests of one file in each execution, by the path of its results.

| Column of `executions` | Type | Why |
|---|---|---|
| `id` | `text`, primary key | The identifier of the execution. |
| `origin` | `text` | `design` for the tests a session of design ran. |
| `session_id` | `text`, or nothing | The session that ran it; emptied when the session goes, and the execution stays. |
| `ran_at` | date | When it was kept. |
| `commit_sha` | `text`, or nothing | The commit the test repository was at. |
| `report` | `text` | The report of the runner, relative to the test repository. |

| Column of `execution_results` | Type | Why |
|---|---|---|
| `execution_id` | `text`, primary key with `position` | The execution; its results go with it. |
| `position` | `integer` | The rank of the test in the report, from 0, which gives back their order. |
| `path` | `text` | The path of the file of the test, relative to the root of the test repository: with `title`, what names the test from one execution to the next. |
| `title` | `text` | Its titles, those of the `describe` that hold it then its own, as `<describe>… › <title>`. |
| `project` | `text` | The project of the runner it ran in. |
| `verdict` | `text` | `passed`, `failed`, `flaky` or `skipped`. |
| `duration_ms` | `integer` | How long its attempts took together. |
| `file_digest` | `text`, or nothing | The SHA-256 of its file when the execution was kept: with the commit, the version the test ran at. |
| `failed_step`, `failed_step_title` | `integer` and `text`, or nothing | The first `test.step` that failed, numbered from 1, and its title. |
| `error_message` | `text`, or nothing | The first line of the message of its error, without colours. |
| `expected`, `received` | `text`, or nothing | What the failed assertion expected and what it received, when its message says both. |

Where a test failed is read from the last attempt of the report; the five columns are empty for a test that did not fail, whose report says nothing of it, or kept before `0006_execution_failures`.

The columns that keep a date, a JSON value or a boolean are kept [as each database keeps them](#how-each-type-is-kept). Nothing filters on what a JSON column holds, which is served as it was written, its fields in the order they were given: on PostgreSQL the columns are `json` and not `jsonb`, which would sort the fields.

## The life of a session

`SessionStore` is the one place that writes the sessions. It implements `SessionStorePort`, the port `@open-qa-stack/domain` declares for what keeps the sessions, which [the operations on sessions](../../engine/docs/engine.md#the-operations-on-sessions) are written against. Besides what it reads — the project, the sessions, a session, its events after a rank, its pending messages — it has one command for each step of the life of a session. Each command is one transaction: it happens whole or not at all.

| Command | Sent for | What it does |
|---|---|---|
| `ask(opening, host)` | A person who opens a session, through the process that will host it | Inserts a session, `queued`, under a new identifier, with what the person asked as its first event, a `user_message`, and its host with a first beat. Answers the session. |
| `start(id, host)` | The host, when the turn of the session comes | The session becomes `running`, and a `state_changed` tells it; whoever starts it is its host from then on. Answers the session. |
| `append(id, events)` | The run of the session | Appends the events the run tells, at the ranks that follow the last event of the session, and dates the session by the last of them. |
| `say(id, text)` | A person who speaks to a session | Takes a message of the person: a row of `session_messages` under the number that follows the last, and a `user_message` with that number. Answers the number. |
| `resume(id, text, host)` | A person who says more to a session that ended, through the process that will host it | The session becomes `queued` again for a new turn: a `user_message` without a number tells what the person asks of it, then a `state_changed` the change; the session no longer holds the result of the turn before, which the completion of that turn told, and forgets an interruption asked while it ran. The process that resumes it is its host, with a first beat. Answers the session. |
| `deliver(id, number, agent)` | The run of the session | Marks a pending message as received by an agent, which a `message_delivered` tells. `pendingMessages(id)` reads those still to deliver, in the order of their numbers. |
| `complete(id, result)` | The run of the session | Ends the session with its result: it becomes `completed`, and a `state_changed` tells it with that result. |
| `interrupt(id)` | The host of a session, which stops it | Ends the session without a result: it becomes `interrupted`, and a `state_changed` tells it. |
| `requestInterruption(id, silentForMs)` | A process that does not run the session | Interrupts at once a session that waits, and one whose host is silent. For one that runs under a host that beats, keeps the date of the request on the session: `interruptionRequests(host)` gives a host the sessions it is asked to interrupt. |
| `beat(host)` | A host, at each of its beats | Dates the last beat of the host on each session it hosts that goes on. |
| `release(host)` | A host that stops | Empties the beat of the host on the sessions it still hosts: they read as left at once. |
| `takeOver(host, silentForMs)` | A host that stays | Gives it the `queued` sessions whose host is silent, with a first beat. Answers their identifiers, in the order they were asked for. |
| `abandonSilent(silentForMs)` | A host, when it starts and at each of its beats | Interrupts every `running` session whose host is silent, each with its `state_changed`. Answers their identifiers. A session whose host beats is left to it, and one that waits is left to wait. |

Which states a command is for, and the state it leaves the session in, are stated once, without a database, in `SESSION_LIFE` of `@open-qa-stack/domain`:

| Command | For a session that is | Leaves it |
|---|---|---|
| `start` | `queued` | `running` |
| `append`, `deliver` | `running` | as it was |
| `complete` | `running` | `completed` |
| `say` | `queued` or `running` | as it was |
| `resume` | `completed` or `interrupted` | `queued` |
| `interrupt` | `queued` or `running` | `interrupted` |
| `beat`, the rule of `beat` and `release` | `queued` or `running` | as it was |
| `takeOver` | `queued` | as it was |
| `abandon`, the rule of `abandonSilent` | `running` | `interrupted` |

`ask` opens a session `queued`, and nothing but `resume` leaves `completed` or `interrupted`. The store reads its decisions from that table — the state a session is asked in, the state `start` sets, the states `beat`, `takeOver` and `abandonSilent` select and the one the last sets, the refusal of a command — and holds them with its statements. `requestInterruption` is an interruption asked from elsewhere, judged as `interrupt` is: the store carries it out itself, or leaves it to the host.

A command that names a session is refused, and writes nothing, with one of the errors of `@open-qa-stack/domain`:

| Error | When |
|---|---|
| `UnknownSessionError` | The identifier names no session. |
| `SessionEndedError` | The session is `completed` or `interrupted`, and the command is not `resume`. |
| `SessionStateError` | The session goes on in a state the command is not for: it still waits and is told an event, a delivery or its result, it runs and is started again, or it is resumed while it goes on. |
| `MessageNotPendingError` | `deliver` names a message the session does not hold, or that an agent already received: a message is delivered once. |

A run whose session was ended under it learns so from the next thing it writes, and stops.

What these guarantee, when two commands reach a session at the same moment — a message of a person while the run appends events, for one:

- **A rank and a number are given once, without a gap.** Every command on a session starts by writing to the row of the session — the state it already has, which it reads back: the database holds the row for the transaction from then on, and two commands on the same session run one after the other. The second reads the last rank, and the last number, once the first has committed. The statement is the same on both databases; on SQLite, where one process writes at a time, it is what takes the turn to write from the first statement on.
- **A command is judged on the state it finds when it writes.** The state it reads back is the one no other command can change before it ends.
- **A session is started once, and resumed once from an end.** Of two that start the same session, or that resume it from the same end, one is refused.
- **A session and the event that tells its state change together.** A session that reads as ended always holds the `state_changed` that ends its streams.

The identifier `ask` gives is `session-`, the date to the millisecond, and eight random hexadecimal characters, such as `session-2026-11-16T08-12-45-120Z-9f3a1c2b`: identifiers sort in the order the sessions were asked for, and two sessions asked for in the same millisecond differ. A client reads nothing in it. What the store dates — a session it opens, the events it tells itself, a message, a delivery — it dates by the clock of the process that runs the command; the events a run appends bear the dates the run gave them.

The store notifies no one, and nothing listens to the database: the process that writes an event wakes the streams open on the session [in its own memory](../../engine/docs/engine.md#how-an-event-travels), and a process that follows a session another one runs reads the database again, twice a second.

## The revisions of the configuration

`ConfigurationStore` is the one place that writes the revisions. It implements `ConfigurationStorePort` of `@open-qa-stack/domain`: it reads the revision in force, `inForce()`, and the list of the revisions without their documents, the latest first, `revisions()`; it has one command, `record(entry, basedOn, alongside)`, which records a revision on top of the one it was made from.

- **A revision is made from the revision in force.** One made from another — replaced since, or that does not exist — is refused with `StaleRevisionError`, which names the revision in force, and nothing is kept.
- **Of two revisions made from the same one at the same moment, one is kept.** The transaction writes first: it inserts the row of the number that follows, which the other already holds or waits for. The statement is the same on both databases.
- **What is done alongside a revision happens with it.** `alongside` runs inside the transaction, once the revision is known to be in order: the operations write `oqas.json` there. When it throws, nothing is kept.

## The documents of the knowledge sources

`DocumentStore` is the one place that writes the documents. It implements `DocumentStorePort` of `@open-qa-stack/domain`: it lists the documents of a source without their texts, `list(source)`, reads them with their texts, `documents(source)`, or one of them, `read(source, name)`; it keeps an upload, `put(source, entries)`, and removes a document, `remove(source, name)`.

- **An upload is kept whole or not at all**, in one transaction: a document of a name the source holds replaces it, and is dated anew.
- **The documents of a source are listed by their names**, code unit by code unit, the same on both databases whatever their collation.
- **The store applies no rule of an upload**: which sources take documents, which names, formats and sizes, is for [the operations on documents](../../engine/docs/engine.md#the-operations-on-documents) to tell, before anything is kept.

## Several processes on one database

The processes of an instance share nothing but the database: the registry of the executions that run is in the memory of each. The database is therefore where they meet, by three columns of `sessions` and the commands above. [The engine](../../engine/docs/engine.md#several-processes-on-one-store) says what each process does with them; what the store guarantees is this.

- **A session has one host**, written when it is asked for and when it is started. Nothing but `takeOver` gives a session that waits to another process, and only when its host is silent.
- **A host is silent** when its beat on the session is empty or older than the time the command that asks is given — 15 seconds, by the pace of the engine — by the clock of the process that asks. A beat exactly that old is still a beat. The processes of an instance are expected on clocks that agree to well within that time.
- **`abandonSilent` and `takeOver` never touch the session of a host that beats**, whoever sends them and however often: a process that starts beside another interrupts nothing of it.
- **An interruption asked from elsewhere is never lost and never abrupt**: it interrupts at once what nobody runs, and waits on the session for the host of what somebody runs.
- **A process that only reads or posts writes no beat**: `sessions`, `session`, `eventsAfter`, `say` and `requestInterruption` are all it sends.

A session left `running` by a host that died stays so until a process sends `abandonSilent` or `requestInterruption`: nothing in the database ends it by itself.

## Tests

The tests of data access run against real databases; no double replaces SQL. Those that hold for every database are written once, in `packages/store/test/each-database`, and run once on each: `OQAS_TEST_DATABASE` names to them the database of the run, and each test file creates databases of its own — a SQLite file in a folder of its own, or a database of the PostgreSQL test server — and removes them, so that files running at the same time never see each other's data.

| Run | Command | What it needs |
|---|---|---|
| The store on SQLite, with the tests that need no database and that of two processes on one file | `pnpm exec vitest run --project store` | Nothing: it takes a second, and is the loop to develop in. |
| The store on PostgreSQL, with the tests of what only a server does — a pool, a server out of reach, two processes that migrate at once | `pnpm exec vitest run --project store-postgres` | A container engine. |
| The API, on both | `pnpm --filter @open-qa-stack/api test` | A container engine. |
| Everything | `pnpm test`, and `pnpm check` | A container engine. |

A run on PostgreSQL starts a disposable server for itself, in a container of the image above, and removes it afterwards. It uses the container engine named in `OQAS_CONTAINER_ENGINE`, or else the first of `podman` and `docker` found on the path. Every container the tests start carries the label `oqas-test=1`, and the containers of a run are removed when it ends, also when it is interrupted with `SIGINT` or `SIGTERM`.

To run these tests against a server already running, such as the development database, give its URL as a user allowed to create databases:

```sh
OQAS_TEST_DATABASE_URL=postgres://oqas@127.0.0.1:5432/oqas pnpm exec vitest run --project store-postgres
OQAS_TEST_DATABASE_URL=postgres://oqas@127.0.0.1:5432/oqas pnpm --filter @open-qa-stack/api test
```

What the tests of the two packages share lives in `packages/store/test/support`, which the store gives as `@open-qa-stack/store/testing`: the two databases as the tests see them, the disposable server and what starts it once for a run, and a database with the schema of the instance and its store.
