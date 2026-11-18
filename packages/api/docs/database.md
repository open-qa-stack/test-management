# The database

An instance keeps its state in one database, which the API shares with nothing else: a SQLite file in the state folder of its test repository unless it is given the URL of another, such as a PostgreSQL server. The databases it supports, its tables, its migrations and its tests are described with the package that holds them: [the database](../../store/docs/database.md), in `@open-qa-stack/store`.

On a SQLite file, the API applies the migrations itself when it starts. On a server, applying them stays a command of the API, which reads the URL of the database from [its configuration](running.md#configuration):

```sh
pnpm --filter @open-qa-stack/api build
OQAS_DATABASE_URL=postgres://oqas@127.0.0.1:5432/oqas pnpm --filter @open-qa-stack/api migrate
```
