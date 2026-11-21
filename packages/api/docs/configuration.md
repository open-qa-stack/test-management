# Configuration

The configuration of an instance — its applications and their environments, what is known of them, the model, the autonomy of the agents, how the tests are designed and where they go — is what `oqas.json` holds. The instance keeps it in its database as revisions, each the whole document with its date and its origin, and keeps them in step with the `oqas.json` of the test repository the API was given. The API reads the configuration in force and its history, checks a change without recording it, and saves one. Each route is one of [the operations on the configuration](../../engine/docs/engine.md#the-operations-on-the-configuration) of the engine, said in HTTP. The web console edits the configuration through these routes.

The shapes of every body are the types of `@open-qa-stack/domain/sessions`; the document is the configuration [as `oqas.json` holds it](../../domain/docs/configuration.md). A client ignores a field or a value it does not know.

| Route | Answer |
|---|---|
| `GET /api/configuration` | The revision in force, and how `oqas.json` stands to it. |
| `GET /api/configuration/revisions` | The revisions, the latest first, without their documents. |
| `POST /api/configuration/validation` | The errors of a configuration, without anything recorded. |
| `POST /api/configuration/revisions` | Saves a change, which rewrites `oqas.json`. |
| `POST /api/configuration/synchronisation` | Takes `oqas.json` as it is now as the revision in force. |
| `POST /api/configuration/model-connection` | Tests a connection to the model as it is drafted, without anything recorded. |

The two reads and the test of a connection are answered with `cache-control: no-store`. Every answer that is not a success is a [problem](sessions.md#problems).

## Secrets

Neither the file nor the database holds a secret: a password, a key or a connection string is named by the environment variable that holds it, `usernameEnv`, `passwordEnv`, `apiKeyEnv`, `connectionStringEnv`, and only the name is kept and served. Whether a variable is set is told by a run, on the machine that runs it: a configuration that names a variable the API does not set is valid, and saved.

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
| `revision.origin` | `file`, read from `oqas.json` when it changed; `console`, a change saved through this API; `command`, the revision in force written back to the file by `oqas config export`. |
| `revision.fileDigest` | The SHA-256 digest of the `oqas.json` it was read from or wrote. |
| `revision.document` | The configuration. |
| `file` | `in_step` when `oqas.json` is the file of the revision in force; `changed` when it was changed since, or never taken; `missing` when it cannot be read, or the API was given no test repository. |

Reading changes nothing: a file that changed is taken when the API starts, when a session starts, or when a client asks for it with `POST /api/configuration/synchronisation`.

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

The body is the section `model` of a configuration as the person drafts it: the name of the model may still be empty, since the test is what lets them choose it. The answer says what the test found, in `state`:

| `state` | When | With |
|---|---|---|
| `connected` | The model answers. | `account`, the GitHub account, for a model of GitHub Copilot; `models`, what the connection offers, each with its `id`, its `name`, whether it reads images (`vision`) when the connection tells it, and the efforts of reasoning it accepts. Without `models`, the server gives no list: the person types the name. |
| `signed-out` | No GitHub account is signed in on the machine that runs the API, through the GitHub CLI or the Copilot CLI. | — |
| `no-models` | The GitHub account is signed in, and Copilot offers it no model: it has no Copilot subscription, or its organisation allows it none. | `account` |
| `key-missing` | The variable that holds the key of a provider is not set in the environment of the runs; the server is not asked. | `variable` |
| `key-refused` | The server answered `401` or `403` to the list of its models. | `status` |
| `unreachable` | Nothing answered at the address of the server within 10 seconds. | `url` |

A model of GitHub Copilot is checked with the account the machine signed in with: the API reads no token, and the SDK of Copilot finds the account itself. A provider key is checked by listing the models of the server, `GET <baseUrl>/models`, with the key the variable holds. Nothing is recorded.

## Saving a change

```http
POST /api/configuration/revisions
content-type: application/json

{"basedOn":3,"document":{"formatVersion":1,…}}

HTTP/1.1 201 Created

{"revision":{"number":4,"origin":"console",…},"file":"in_step"}
```

| Field | Value |
|---|---|
| `basedOn` | The number of the revision the change was made from: the revision in force the client read; `0` on an instance that has none. |
| `document` | The configuration as it is to be. |
| `replaceFile` | `true` to rewrite an `oqas.json` that changed since the revision in force: the person chose to keep the change over the file. Left out, such a change is refused. |

The change becomes a revision of origin `console`, and `oqas.json` is rewritten with it, its keys in the order the schema declares them and indented by two spaces: the same document is always the same text, and the diff of the file in git shows what changed. The answer is the configuration as it is now. A change is saved whole or not at all: when the file cannot be written, nothing is recorded.

The concurrency is optimistic: a change made from a revision another replaced since — another person saved, or the file was taken — is refused with `409` `stale_revision`, and the client reads the configuration again.

## When the file and the console both changed

`oqas.json` is the configuration kept with the tests in git: a person may change it in an editor, or by a checkout, while the console holds a change. A change saved while the file changed since the revision in force is refused with `409` `configuration_conflict`, and nothing is merged. The detail says the two ways out, each one request:

- **Keep the file**: `POST /api/configuration/synchronisation` takes `oqas.json` as the revision in force, of origin `file`. The change of the console is dropped; the client reads the configuration again.
- **Keep the change**: the same change sent again with `"replaceFile": true`, which rewrites the file over what it held.

```http
POST /api/configuration/synchronisation

HTTP/1.1 200 OK

{"revision":{"number":4,"origin":"file",…},"file":"in_step"}
```

The synchronisation answers the configuration as it is now: a new revision when the file changed, the revision in force as it was when it did not, or when the file cannot be read. A file that is not a valid configuration is refused with `422` `invalid_configuration` and its errors, and the revision in force stays as it is: correct the file, or keep the configuration over it with a change sent with `"replaceFile": true`. A run that starts while the file is so refuses to go on, and tells the same.

## Problems

| Code | Status | When |
|---|---|---|
| `invalid_request` | `400` | The body is not one the route reads: a field the route does not know, `basedOn` that is no whole number from 0, `document` or the body of a validation that is no JSON object, `replaceFile` that is no boolean, the body of a test of the connection that is no section `model` the configuration accepts. |
| `stale_revision` | `409` | The change was made from a revision another replaced since, or from one that does not exist. |
| `configuration_conflict` | `409` | `oqas.json` changed since the revision in force, and the change would overwrite it. |
| `invalid_configuration` | `422` | The change, or the file to take, is not a valid configuration. The problem bears `errors`, each error where it is, as a validation lists them. |
| `no_configuration` | `404` | A synchronisation on an instance that has no revision, and no `oqas.json` to take one from. |
| `unavailable` | `503` | A change asked of an API that was started without a test repository, whose file it would rewrite; or the database cannot be reached. |

## What the routes call

| Route | Operation |
|---|---|
| `GET /api/configuration` | `view()` |
| `GET /api/configuration/revisions` | `revisions()` |
| `POST /api/configuration/validation` | `check(document)` |
| `POST /api/configuration/revisions` | `save(document, basedOn, replaceFile)`, then `view()` |
| `POST /api/configuration/synchronisation` | `synchronise()`, then `view()` |
