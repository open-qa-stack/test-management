# Configuration

The configuration of an instance — its applications and their environments, what is known of them, the model, the autonomy of the agents, how the tests are designed and where they go — is what `oqas.json` holds. The instance keeps it in its database, its one source, as revisions, each the whole document with its date and its origin; the `oqas.json` of the test repository the API was given is a copy, which gives the instance its first revision and is taken or written when a client asks for it. The API reads the configuration in force and its history, checks a change without recording it, saves one, and takes or writes the file. Each route is one of [the operations on the configuration](../../engine/docs/engine.md#the-operations-on-the-configuration) of the engine, said in HTTP. The web console edits the configuration through these routes.

The shapes of every body are the types of `@open-qa-stack/domain/sessions`; the document is the configuration [as `oqas.json` holds it](../../domain/docs/configuration.md). A client ignores a field or a value it does not know.

| Route | Answer |
|---|---|
| `GET /api/configuration` | The revision in force, and how `oqas.json` stands to it. |
| `GET /api/configuration/revisions` | The revisions, the latest first, without their documents. |
| `POST /api/configuration/validation` | The errors of a configuration, without anything recorded. |
| `POST /api/configuration/revisions` | Saves a change, as the revision in force; no file is written. |
| `POST /api/configuration/synchronisation` | Takes `oqas.json` as it is now as the revision in force. |
| `PUT /api/configuration/file` | Writes the revision in force to `oqas.json`. |
| `POST /api/configuration/model-connection` | Tests a connection to the model as it is drafted, without anything recorded. |
| `GET /api/repository` | Where the test repository stands: its folder, a git repository, with a commit, and a Playwright project. |
| `POST /api/repository/preparation` | Sets the test repository up from the configuration in force. |
| `GET /api/secrets` | The variables the configuration in force names, and where the value of each comes from; never a value. |
| `PUT /api/secrets/{name}` | Saves the value of one of them, on the machine of the instance, out of the test repository. |

The reads, the variables and the test of a connection are answered with `cache-control: no-store`. Every answer that is not a success is a [problem](sessions.md#problems).

## Secrets

Neither the file nor the database holds a secret: a password, a key or a connection string is named by the variable that holds it, `usernameEnv`, `passwordEnv`, `apiKeyEnv`, `connectionStringEnv`, and only the name is kept in the configuration. A configuration that names a variable without a value is valid, and saved; a run tells what is missing.

The value of a variable comes from the environment of the process, which wins, as in a CI; or else from the value a person typed in the console or in a terminal, which the instance keeps on its machine, in the state folder of the test repository (`.oqas/secrets/values.json`, which only its owner reads, in a folder whose own `.gitignore` leaves it out of git). The runs read the environment completed with those values as each run starts: a value saved by another process — a command in another terminal — is read by the next run. No route gives a value back.

```http
GET /api/secrets

HTTP/1.1 200 OK
cache-control: no-store

{"secrets":[{"name":"SHOP_DB_URL","kind":"connection_string","paths":["/knowledge/1/connectionStringEnv"],"source":"missing"}]}
```

Each variable is listed once, in the order of the file, with `kind` — `model_key`, `connection_string`, `account_username` or `account_password` —, `paths`, every key that names it, and `source`: `environment`, `saved` or `missing`. An instance without a configuration lists none.

```http
PUT /api/secrets/SHOP_DB_URL
content-type: application/json

{"value":"postgres://…"}

HTTP/1.1 204 No Content
```

A value saved replaces the one saved before. It is refused for a variable the configuration in force does not name (`404 unknown_secret`), when it is empty or the environment of the instance sets the variable (`409 secret_refused`), and by an API started without a test repository (`503 unavailable`).

## The configuration in force

```http
GET /api/configuration

HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
cache-control: no-store

{"revision":{"number":3,"recordedAt":"2026-11-18T09:12:45.120Z","origin":"console","fileDigest":"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08","document":{"formatVersion":1,"applications":[…],"knowledge":[],"model":{…}}},"file":"in_step"}
```

| Field | Value |
|---|---|
| `revision` | The revision in force, the last recorded; left out on an instance that has none yet. |
| `revision.number` | Its number, from 1. A change is made from it. |
| `revision.recordedAt` | When it was recorded, as an ISO 8601 date. |
| `revision.origin` | `file`, taken from `oqas.json`; `console`, a change saved through this API; `command`, a change saved by a command of the terminal, such as `oqas model set`. |
| `revision.fileDigest` | The SHA-256 digest of the `oqas.json` that holds it. |
| `revision.document` | The configuration. |
| `file` | `in_step` when `oqas.json` holds the revision in force; `changed` when it differs from it, or was never taken; `missing` when it cannot be read, or the API was given no test repository. |

Reading changes nothing. The file is read when the instance keeps no revision yet — the API starts on it, or a session starts — and when a client asks for it with `POST /api/configuration/synchronisation`; never otherwise.

```http
GET /api/configuration/revisions

HTTP/1.1 200 OK
cache-control: no-store

{"items":[{"number":3,"recordedAt":"2026-11-18T09:12:45.120Z","origin":"console","fileDigest":"9f86…"},{"number":2,"recordedAt":"2026-11-18T08:40:02.008Z","origin":"file","fileDigest":"e3b0…"}]}
```

## Checking a change

```http
POST /api/configuration/validation
content-type: application/json

{"formatVersion":1,"applications":[],"knowledge":[],"model":{…}}

HTTP/1.1 200 OK

{"errors":[{"kind":"structure","path":"/applications","rule":"too-few-items","message":"Too few items."}]}
```

The body is the configuration itself. The answer lists every error the schema of `oqas.json` and its rules find, the environment left out, each with its `kind`, its `path` — a JSON Pointer to the field at fault, `""` for the whole document — its `rule` and its `message`, as [the configuration file](../../domain/docs/configuration.md#validation) describes them: a client shows each beside its field. An empty list is a valid configuration. Nothing is recorded.

## Testing the connection to the model

```http
POST /api/configuration/model-connection
content-type: application/json

{"mode":"github","model":""}

HTTP/1.1 200 OK

{"state":"connected","account":"octo","models":[{"id":"gpt-5","name":"GPT-5","vision":true,"reasoningEfforts":["low","high"]}]}
```

The body is the section `model` of a configuration as the person drafts it: the name of the model may still be empty, since the test is what lets them choose it. Beside its keys, `key` carries the key the person typed and did not save yet, which is tried in place of the one the variable holds. The answer says what the test found, in `state`:

| `state` | When | With |
|---|---|---|
| `connected` | The model answers. | `account`, the GitHub account, for a model of GitHub Copilot; `models`, what the connection offers, each with its `id`, its `name`, whether it reads images (`vision`) when the connection tells it, and the efforts of reasoning it accepts. Without `models`, the server gives no list: the person types the name. |
| `signed-out` | No GitHub account is signed in on the machine that runs the API, through the GitHub CLI or the Copilot CLI. | — |
| `no-models` | The GitHub account is signed in, and Copilot offers it no model: it has no Copilot subscription, or its organisation allows it none. | `account` |
| `key-missing` | No key was typed, and the variable that holds the key of a provider has no value, neither in the environment of the runs nor saved; the server is not asked. | `variable` |
| `key-refused` | The server answered `401` or `403` to the list of its models. | `status` |
| `unreachable` | Nothing answered at the address of the server within 10 seconds. | `url` |

A model of GitHub Copilot is checked with the account the machine signed in with: the API reads no token, and the SDK of Copilot finds the account itself. A provider key is checked by listing the models of the server, `GET <baseUrl>/models`, with the key the variable holds. Nothing is recorded.

## Saving a change

```http
POST /api/configuration/revisions
content-type: application/json

{"basedOn":3,"document":{"formatVersion":1,…}}

HTTP/1.1 201 Created

{"revision":{"number":4,"origin":"console",…},"file":"changed"}
```

| Field | Value |
|---|---|
| `basedOn` | The number of the revision the change was made from: the revision in force the client read; `0` on an instance that has none. |
| `document` | The configuration as it is to be. |

The change becomes a revision of origin `console`, and no file is written: `oqas.json` then differs from it, until a client writes it. The answer is the configuration as it is now.

The concurrency is optimistic: a change made from a revision another replaced since — another person saved, or the file was taken — is refused with `409` `stale_revision`, and the client reads the configuration again.

## Taking and writing the file

`oqas.json` is the configuration kept with the tests in git, or given to the continuous integration: a person may change it in an editor, or by a checkout. The instance does not read it again on its own; a client asks for one of two things, each one request:

- **Take the file**: `POST /api/configuration/synchronisation` takes `oqas.json` as the revision in force, of origin `file`, when it differs from it.
- **Write the file**: `PUT /api/configuration/file` writes the revision in force over what `oqas.json` holds, its keys in the order the schema declares them and indented by two spaces: the same document is always the same text, and the diff of the file in git shows what changed. The revision in force does not change.

```http
POST /api/configuration/synchronisation

HTTP/1.1 200 OK

{"revision":{"number":4,"origin":"file",…},"file":"in_step"}
```

Each answers the configuration as it is now. The synchronisation records a new revision when the file differs, and leaves the revision in force as it was when it does not, or when the file cannot be read. A file that is not a valid configuration is refused with `422` `invalid_configuration` and its errors, and the revision in force stays as it is: correct the file, then take it again. Writing the file on an instance that has no revision is answered `404` `no_configuration`, and on an API given no test repository `503` `unavailable`.

## Setting the test repository up

```http
GET /api/repository
```

```json
{ "folder": "/work/shop-tests", "git": "none", "playwright": false }
```

`folder` is the absolute path of the test repository on the machine of the instance, where the project is written. `git` is `none` when the folder is no git repository, `empty` when it is one without a commit, `ready` when it has one; `playwright` tells whether it holds a `playwright.config.ts`. An API given no test repository answers `503` `unavailable`.

```http
POST /api/repository/preparation
```

```json
{ "created": ["package.json", "playwright.config.ts"], "kept": [], "committed": true }
```

It does what [`oqas --init`](../../cli/docs/solo-command.md#initialising-a-test-repository) does, from the revision in force: it writes the files of a Playwright project that are missing, keeps those the repository has, and, in a folder that was no git repository, makes one and commits what it created, with `oqas.json` when the repository holds one — `committed` says so. The console calls it once the first revision is saved. An instance without a configuration is answered `404` `no_configuration`, and one given no test repository `503` `unavailable`.

## Problems

| Code | Status | When |
|---|---|---|
| `invalid_request` | `400` | The body is not one the route reads: a field the route does not know, `basedOn` that is no whole number from 0, `document` or the body of a validation that is no JSON object, the body of a test of the connection that is no section `model` the configuration accepts, or whose `key` is no text; the body of a value that is no object whose `value` is a text. |
| `stale_revision` | `409` | The change was made from a revision another replaced since, or from one that does not exist. |
| `invalid_configuration` | `422` | The change, or the file to take, is not a valid configuration. The problem bears `errors`, each error where it is, as a validation lists them. |
| `no_configuration` | `404` | A synchronisation on an instance that has no revision, and no `oqas.json` to take one from; writing the file on an instance that has no revision. |
| `unknown_secret` | `404` | A value given for a variable the configuration in force does not name. |
| `secret_refused` | `409` | A value that is empty, or for a variable the environment of the instance sets. |
| `unavailable` | `503` | The file asked of an API that was started without a test repository; or the database cannot be reached. |

## What the routes call

| Route | Operation |
|---|---|
| `GET /api/configuration` | `view()` |
| `GET /api/configuration/revisions` | `revisions()` |
| `POST /api/configuration/validation` | `check(document)` |
| `POST /api/configuration/revisions` | `save(document, basedOn)`, then `view()` |
| `POST /api/configuration/synchronisation` | `synchronise()`, then `view()` |
| `PUT /api/configuration/file` | `restore()`, then `view()` |
| `POST /api/configuration/model-connection` | `check(model, key)` of `ModelConnection` |
| `GET /api/secrets` | `list()` of `Secrets` |
| `PUT /api/secrets/{name}` | `save(name, value)` of `Secrets` |
