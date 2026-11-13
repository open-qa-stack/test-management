# The database

An instance keeps its state in one PostgreSQL database. The API reaches it through the connection URL in `OQAS_DATABASE_URL`, a secret read from the environment only (see [running the API](running.md#configuration)).

## Supported version

PostgreSQL 18. The tests run against the image named in `compose.yaml` at the root of the repository, `postgres:18.7-alpine3.24`.

## Development database

A development database runs in a container, with [Docker](https://docs.docker.com/get-started/get-docker/) or [Podman](https://podman.io/docs/installation) and its compose provider as the only prerequisite. From the root of the repository:

```sh
docker compose up --detach   # or: podman compose up --detach
```

It listens on `127.0.0.1:5432`, or on the port set in `OQAS_DATABASE_PORT`, for the user `oqas` without a password, and keeps its data in the `oqas_database` volume. Its URL is `postgres://oqas@127.0.0.1:5432/oqas`. It accepts connections from this machine only and is meant for development only. `docker compose down --volumes` removes it with its data.

## Migrations

The schema is declared with [Drizzle](https://orm.drizzle.team) in `packages/api/src/database/schema.ts`, and changes through the versioned migrations of `packages/api/migrations`, applied in the order of their journal, each one once.

Applying the migrations is an explicit step, before the API starts and after each upgrade:

```sh
pnpm --filter @open-qa-stack/api build
OQAS_DATABASE_URL=postgres://oqas@127.0.0.1:5432/oqas pnpm --filter @open-qa-stack/api migrate
```

The command applies every pending migration in one transaction, then says how many it applied; run again, it changes nothing and says the schema is up to date. Two runs at once on the same database apply each migration once. It exits with code `1`, without the URL nor its password, when the database cannot be reached.

To change the schema, edit the declared tables, then generate the migration that matches them and commit both:

```sh
pnpm --filter @open-qa-stack/api migrations:generate
```

A migration that has been released is never edited: a correction is a new migration. The tests fail when the declared schema and the versioned migrations differ.

## JSONB columns

Every JSONB column that is meant to be filtered on carries a GIN index, created by the migration that creates the column. A JSONB column that is never filtered on is listed, with the reason, in `packages/api/test/jsonb-without-gin.ts`. The tests read the catalog of a migrated database and fail on any JSONB column that has neither a GIN index nor an entry in that list, and on any entry that no longer matches a column.

## Tests

The tests of data access run against a real PostgreSQL server; no double replaces SQL. Each test file creates databases of its own and drops them, so that files running at the same time never see each other's data.

`pnpm --filter @open-qa-stack/api test` starts a disposable server for the run, in a container of the image above, and removes it afterwards. It uses the container engine named in `OQAS_CONTAINER_ENGINE`, or else the first of `podman` and `docker` found on the path. Some tests start and stop servers of their own, so a container engine is needed in every case. Every container the tests start carries the label `oqas-test=1`, and the containers of a run are removed when it ends, also when it is interrupted with `SIGINT` or `SIGTERM`.

To run the tests against a server already running, such as the development database, give its URL as a user allowed to create databases:

```sh
OQAS_TEST_DATABASE_URL=postgres://oqas@127.0.0.1:5432/oqas pnpm --filter @open-qa-stack/api test
```
