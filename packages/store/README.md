# @open-qa-stack/store

The database of an instance: what keeps its project, its sessions, their events, the messages sent to them, the revisions of its configuration and the documents uploaded to its knowledge sources. The processes of the instance, the API and the `oqas` command, reach it through this package, and meet in it — see [docs/database.md](docs/database.md).

The database is a setting, not a mode. There is one schema, one series of migrations and one set of statements, written with [Kysely](https://kysely.dev); the connection URL alone tells which database runs them: a SQLite file, which needs no database installed, or a PostgreSQL server. Both are supported, which means the same tests run on both at every commit.

| Folder | What it holds |
|---|---|
| `src/database/` | `DatabaseUrl`, the URL that names the database, and `Database`, which runs the statements on it; `openKysely`, the one place that knows the databases the store supports, with what opens a SQLite file in `sqlite/` and the pool of PostgreSQL in `postgres/`; the type of the schema, `schema.ts`, and how a date and a JSON value are kept on each database, `stored-values.ts`; the versioned migrations of `migrations/` with what applies them, `SchemaMigrations` and `runMigrations`; and `DatabaseStatus`, which tells whether the database answers with its schema up to date. |
| `src/sessions/` | `SessionStore`, the project, the sessions, their events and their messages, with one command for each step of the life of a session: the `SessionStorePort` of `@open-qa-stack/domain`, whose rules it holds when two commands reach a session at once, from one process or from several. |
| `src/configuration/` | `ConfigurationStore`, the revisions of the configuration of the instance, each recorded on top of the revision in force: the `ConfigurationStorePort` of `@open-qa-stack/domain`. |
| `src/documents/` | `DocumentStore`, the documents uploaded to the knowledge sources of the instance, each upload kept whole or not at all: the `DocumentStorePort` of `@open-qa-stack/domain`. |
| `src/instance/` | `InstanceDatabase`, the database of an instance assembled once for every process that reaches it, with the rule that brings its schema in order; `instanceDatabaseUrl`, which tells where that database is from the settings of the instance. |

The package holds no framework and no logger: whoever runs it hands over the logger of its process, a `StoreLogger`. `@open-qa-stack/store/testing` gives the packages that use it the databases of their tests: a SQLite file of their own, or a database of a disposable PostgreSQL server.
