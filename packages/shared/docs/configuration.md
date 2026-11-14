# Solo-mode configuration file

The `oqas` command, run without an instance, reads `oqas.json` at the root of the test repository. The file describes the applications to test, what is known about them, where tests go, which model to use and how far the agents may go on their own. An instance can import the same file.

The file is JSON, optionally preceded by a byte order mark. Its JSON Schema (draft 2020-12) is `schema/oqas.schema.json`; point the optional `$schema` key at it to get completion in an editor. A complete example for a three-application target lives in `examples/lakeside-mutual/oqas.json`.

## Secrets stay out of the file

The file never holds a password, a token, a key or a connection string. Wherever one is needed, the file names an environment variable instead, and the command reads the value at run time. A name must match `^[A-Z_][A-Z0-9_]*$`; anything else is refused, and the refused value is never repeated in an error. The rule checks the shape of the name only: a secret that happens to look like a variable name (for example `ABC123`) cannot be told apart, so keep values out of the file. A key written twice in the same object is refused, so that nothing can hide behind a later occurrence.

## Validation

`validateConfig(content, env)` takes the file content and the environment and returns either the resolved configuration or a list of errors. It reads no file and opens no network or database connection; testing that a knowledge source answers is a separate step.

Each error has a `kind`, a `path` (a JSON Pointer to the offending location, `""` for the whole document), a `rule` and a `message`. Messages never repeat a value read from the file or from the environment; they may name a key the schema defines, or an environment variable the file references.

| Kind | Rules |
|---|---|
| `syntax` | `json` |
| `structure` | `required`, `unknown-key`, `duplicate-key`, `wrong-type`, `empty-value`, `too-few-items`, `too-few-keys`, `below-minimum`, `unknown-variant`, `retired-level`, `format-version`, `slug`, `env-var-name`, `charter-rule-id`, `openapi-source`, `duplicate`, `ui-url-required`, `url-absolute`, `url-scheme`, `url-credentials`, `path-absolute`, `path-outside-root`, `path-invalid` |
| `reference` | `unknown-reference`, `api-without-environment` |
| `environment` | `env-var-missing` |

## Keys

Types used below: a *slug* matches `^[a-z0-9]+(-[a-z0-9]+)*$`; a *variable* is the name of an environment variable; a *URL* is absolute, uses `http` or `https` and carries no user name or password; a *path* is relative to the test repository root, may not leave it and contains no control character.

### Root

| Key | Type | Required | Example |
|---|---|---|---|
| `$schema` | string: a relative path, or a URL | no | `"./node_modules/@open-qa-stack/shared/schema/oqas.schema.json"` |
| `formatVersion` | `1` | yes | `1` |
| `applications` | array of [applications](#application), at least one | yes | see below |
| `knowledge` | array of [knowledge sources](#knowledge), possibly empty | yes | `[]` |
| `repository` | [repository layout](#repository) | no | `{ "journeysDir": "journeys" }` |
| `charter` | [test charter changes](#charter) | no | see below |
| `cartography` | [how the sources are mapped](#cartography) | no | `{ "concurrency": 2 }` |
| `model` | [model connection](#model) | yes | see below |
| `autonomy` | [autonomy level](#autonomy) | no, `autonomous` by default | `{ "level": "autonomous" }` |

`formatVersion` is the version of the file format, independent of the product version.

### Application

| Key | Type | Required | Example |
|---|---|---|---|
| `id` | slug, unique | yes | `"policy-management"` |
| `name` | non-empty string | yes | `"Policy Management"` |
| `type` | `web`, `api` or `web-and-api` | yes | `"web-and-api"` |
| `authentication.method` | `none` or `form` | yes | `"form"` |
| `authentication.accounts` | array of [accounts](#account) | no | see below |
| `environments` | array of [environments](#environment), at least one | yes | see below |

### Account

Test accounts used to sign in. The format keeps them with the application's authentication; the other test data sets are not supported by this format version.

| Key | Type | Required | Example |
|---|---|---|---|
| `name` | non-empty string | yes | `"demo"` |
| `usernameEnv` | variable | yes | `"CSS_DEMO_USERNAME"` |
| `passwordEnv` | variable | yes | `"CSS_DEMO_PASSWORD"` |

### Environment

| Key | Type | Required | Example |
|---|---|---|---|
| `name` | non-empty string, unique within the application | yes | `"local"` |
| `uiUrl` | URL | for `web` and `web-and-api` | `"http://localhost:3010"` |
| `apis` | array of [named APIs](#named-api) | no | see below |

### Named API

| Key | Type | Required | Example |
|---|---|---|---|
| `name` | non-empty string, unique within the environment | yes | `"policy-management-backend"` |
| `baseUrl` | URL | yes | `"http://localhost:8090"` |

### Knowledge

Every knowledge source has an `id`, a `type`, `attachments`, and the keys its type requires.

| Key | Type | Required | Example |
|---|---|---|---|
| `id` | slug, unique | yes | `"policy-management-api"` |
| `type` | `openapi`, `postgresql`, `document`, `source-code` or `logs` | yes | `"openapi"` |
| `attachments` | array of [attachments](#attachment), at least one | yes | `[{ "application": "policy-management" }]` |
| `url` | URL, for `openapi`; exactly one of `url` and `path` | see type | `"http://localhost:8090/v3/api-docs"` |
| `path` | path, for `openapi`, `document`, `source-code` and `logs` | see type | `"contracts/policy-management.json"`, `"specs/quotes.md"`, `"../policy-management"` |
| `connectionStringEnv` | variable, for `postgresql` | see type | `"POLICY_MANAGEMENT_DB_URL"` |
| `commands` | `none`, `git` or `shell`, for `source-code` | no, `git` by default | `"none"` |
| `container` | container name, for `logs`; exactly one of `path` and `container` | see type | `"policy-management-backend"` |
| `engine` | `podman` or `docker`, for `logs` with a `container` | with `container` | `"podman"` |

The path of a contract or a document stays inside the test repository. The path of a `source-code` folder, or of a log file, may lead outside it, since the code of an application often lives in another repository: `"../policy-management"`. The agents' reading and git tools never leave that folder.

A `logs` source gives the agents the lines a service writes: those of a file, `{ "path": "../policy-management/logs/service.log" }`, or those of a container, `{ "container": "policy-management-backend", "engine": "podman" }`, read with `podman logs` or `docker logs`. Attach it to the environment the service runs in. The agents read it after an action, to see what the service did; the cartography does not map it. It is meant for the solo mode, where the service runs on the same machine as the agents: a worker that does not run the application cannot reach its file or its container.

`commands` sets the risk an agent may take in a source code folder. With `none`, the agents only list, search and read files. With `git`, the default, they may also read the history with `git log`, `git blame` and `git show`, run without a shell and limited to the folder. With `shell`, they may run any command in the folder, with the rights of the user who runs the agents: such a command can write, and read outside the folder. Choose it only where you accept that risk.

The other kinds of knowledge the product plans (SOAP contracts, tickets, test data sets) are not supported by this format version.

### Attachment

| Key | Type | Required | Example |
|---|---|---|---|
| `application` | slug of a declared application | yes | `"policy-management"` |
| `environment` | name of an environment of that application | no | `"local"` |
| `api` | name of an API of that environment; requires `environment` | no | `"policy-management-backend"` |

### Repository

All keys are optional paths.

| Key | Default | Description |
|---|---|---|
| `appsDir` | `apps` | One folder per application, named after its `id`, holding its tests. |
| `blocksDir` | `blocs` | Folder, inside each application folder, holding its reusable blocks. |
| `journeysDir` | `parcours` | Folder holding multi-application journeys. |
| `stateDir` | `.oqas` | Where the solo mode keeps its state. |
| `indexDir` | `.oqas/index` | Where the mapper writes its index by domain. |

### Charter

The test designer and the reviewer apply the default test charter of `@open-qa-stack/harness`, described in its `docs/test-charter.md`. The `charter` key changes it; both of its keys are optional.

| Key | Type | Example |
|---|---|---|
| `disable` | array of `{ "rule", "reason" }`: the identifier of a default rule, and why it does not apply | `[{ "rule": "PW-WAIT-01", "reason": "The legacy grid has no loading state." }]` |
| `add` | array of `{ "id", "statement", "reason" }`: a rule of your own, applied after the default ones | see below |

A rule identifier is made of upper case words and digits separated by hyphens, such as `PW-WAIT-01` or `TEAM-NAMING-01`. A rule disabled twice, or an identifier added twice, is refused as a `duplicate`. When the charter is applied, a disabled identifier that names no default rule is refused with `unknown-charter-rule`, and an added identifier already taken by a default rule with `duplicate`; both errors point at the offending key, such as `/charter/disable/0/rule`.

```json
{
  "disable": [{ "rule": "PW-SHOT-01", "reason": "Screenshots are taken by the reporter." }],
  "add": [{ "id": "TEAM-TAG-01", "statement": "Tag every test with its domain, such as @policies.", "reason": "The nightly run selects tests by domain." }]
}
```

### Cartography

| Key | Type | Default | Example |
|---|---|---|---|
| `concurrency` | integer, 1 or more | `1` | `2` |

`concurrency` is the most sources mapped at once, each in a task of its own with its own session of the model. More than one needs a model server that answers several requests at once; a value that is not a whole number of 1 or more is refused with its JSON path, such as `/cartography/concurrency`.

### Model

| Key | Type | Required | Example |
|---|---|---|---|
| `mode` | `provider-key` | yes | `"provider-key"` |
| `provider` | `openai`: an OpenAI-compatible API | yes | `"openai"` |
| `baseUrl` | URL | yes | `"http://localhost:1234/v1"` |
| `model` | non-empty string, as the server names the model | yes | `"local-model"` |
| `apiKeyEnv` | variable, when the server requires a key | no | `"OQAS_MODEL_API_KEY"` |
| `capabilities` | list of `vision`: what the model can do besides reading and writing text | no | `["vision"]` |

Only a provider key is supported in solo mode for now.

`vision` says that the model reads images. Any other value is refused with the rule `unknown-variant`, at its JSON path, such as `/model/capabilities/0`.

### Autonomy

How far the agents may go on their own. Without `autonomy`, the level is `autonomous`.

| `level` | Limits |
|---|---|
| `autonomous` | No limit per task: each task goes on until the agent decides it is done, or the guardrail is reached. |
| `bounded` | Each task stops at the first criterion of `task` it reaches. |

| Key | Type | Required | Example |
|---|---|---|---|
| `level` | `autonomous` or `bounded` | yes | `"bounded"` |
| `task.maxMinutes` | positive integer: the minutes a task may run | no | `30` |
| `task.maxIterations` | positive integer: the calls a task may make to the model | no | `200` |
| `task.maxActions` | positive integer: the browser actions a task may take | no | `1000` |
| `guardrailMinutes` | positive integer: the minutes, from the start of a run, after which every task of its agents stops | no; `120` for `autonomous`, none for `bounded` | `240` |

`task` is only for `bounded`, which requires it with one criterion at least; a criterion left out does not bound the task. A bounded level looks like this:

```json
{
  "level": "bounded",
  "task": { "maxMinutes": 30 },
  "guardrailMinutes": 240
}
```

The guardrail bounds the tasks of the agents, not the installation of the dependencies nor the execution of the tests: a task still running when it is reached stops at its next call to the model or to a tool, and is journaled as stopped by its duration limit. A run whose task a limit or the guardrail stopped can be resumed from what it kept: see the `--resume` option of the solo command. A level of an earlier version of the format is refused with the rule `retired-level`, whose message names the level to write instead.

## Example

```json
{
  "formatVersion": 1,
  "applications": [
    {
      "id": "customer-self-service",
      "name": "Customer Self-Service",
      "type": "web-and-api",
      "authentication": {
        "method": "form",
        "accounts": [{ "name": "demo", "usernameEnv": "CSS_DEMO_USERNAME", "passwordEnv": "CSS_DEMO_PASSWORD" }]
      },
      "environments": [
        {
          "name": "local",
          "uiUrl": "http://localhost:3000",
          "apis": [{ "name": "customer-self-service-backend", "baseUrl": "http://localhost:8080" }]
        }
      ]
    }
  ],
  "knowledge": [
    {
      "id": "customer-self-service-api",
      "type": "openapi",
      "url": "http://localhost:8080/v3/api-docs",
      "attachments": [{ "application": "customer-self-service", "environment": "local", "api": "customer-self-service-backend" }]
    },
    {
      "id": "customer-self-service-db",
      "type": "postgresql",
      "connectionStringEnv": "CUSTOMER_SELF_SERVICE_DB_URL",
      "attachments": [{ "application": "customer-self-service", "environment": "local" }]
    }
  ],
  "model": {
    "mode": "provider-key",
    "provider": "openai",
    "baseUrl": "http://localhost:1234/v1",
    "model": "local-model",
    "apiKeyEnv": "OQAS_MODEL_API_KEY"
  },
  "autonomy": { "level": "autonomous" }
}
```

The model identifier in the examples is a placeholder until a local model is chosen.
