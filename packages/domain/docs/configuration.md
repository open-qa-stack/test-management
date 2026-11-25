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

`resolvedConfig(document)` gives a configuration the validation accepted with every default applied, as `validateConfig` does.

## The configuration of an instance

An instance keeps its configuration in its database, its one source, as revisions: each holds the whole document as this file holds it, its date, its origin — `file`, `console` or `command` — and the SHA-256 digest of the file that holds it, which tells whether this file differs from it. This file is a copy: it gives an instance its first revision, and is taken or written when a person asks for it. The types and the port of the store that keeps the revisions are in `src/configuration-life/`; the operations on them are in [the engine](../../engine/docs/engine.md#the-operations-on-the-configuration).

The documents of the sources declared `stored` are kept in the same database, apart from the revisions: a revision declares a source, and its documents are uploaded to it. Their types, the rules of an upload, the refusals and the port of the store that keeps them are in `src/knowledge-documents/`.

- `revisionDocument(content)` reads a file that would become a revision, validated as above but for the environment: a revision names the variables its runs read, and the run tells whether they are set.
- `configurationText(document)` writes a configuration as it is written to this file: its keys in the order the schema declares them, indented by two spaces, with a final newline. The same document is always the same text, so that the diff of the file shows what changed.
- `fileStateOf(revision, digest)` tells how the file stands to the revision in force: `in_step`, `changed` when it differs, or `missing`.
- `StaleRevisionError`, `InvalidConfigurationError` and `NoConfigurationError` are the refusals of the configuration, which each presentation words.

## Keys

Types used below: a *slug* matches `^[a-z0-9]+(-[a-z0-9]+)*$`; a *variable* is the name of an environment variable; a *URL* is absolute, uses `http` or `https` and carries no user name or password; a *path* is relative to the test repository root, may not leave it and contains no control character.

### Root

| Key | Type | Required | Example |
|---|---|---|---|
| `$schema` | string: a relative path, or a URL | no | `"./node_modules/@open-qa-stack/domain/schema/oqas.schema.json"` |
| `formatVersion` | `1` | yes | `1` |
| `language` | `en` or `fr` | no, `en` by default | `"fr"` |
| `applications` | array of [applications](#application), at least one | yes | see below |
| `knowledge` | array of [knowledge sources](#knowledge), possibly empty | yes | `[]` |
| `repository` | [repository layout](#repository) | no | `{ "journeysDir": "journeys" }` |
| `charter` | [test charter changes](#charter) | no | see below |
| `cartography` | [how the sources are mapped](#cartography) | no | `{ "concurrency": 2 }` |
| `design` | [how the tests are designed](#design) | no | `{ "reviewPlan": false }` |
| `model` | [model connection](#model) | yes | see below |
| `autonomy` | [autonomy level](#autonomy) | no, `bounded` with ten minutes per task by default | `{ "level": "autonomous" }` |

`formatVersion` is the version of the file format, independent of the product version.

`language` is the language the product speaks to the person in, as a BCP 47 tag: the console, the conversation of the command line, and what the agents say — their messages, the reasons they give, the remarks of the reviewers. The instructions the agents are given, and the notes and refusals of the harness, stay in English. The language of the tests is set apart, by [`testLanguage`](#design).

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
| `exploration` | `read-only` or `read-write` | no, `read-only` by default | `"read-write"` |
| `allow` | `design` and `run`, each `true` or `false` | no, both allowed by default | `{ "design": false }` |
| `apis` | array of [named APIs](#named-api) | no | see below |

`exploration` says what the agent that explores the user interface may do in this environment. With `read-only`, it browses, searches, filters and opens forms to read their fields, and the harness refuses any click that would create, change or remove data. With `read-write`, for an environment whose data may be changed, it may also submit the forms that create or change data, to see what the application answers; a click that would remove data stays refused.

`allow` says what the agents may do in this environment: `design`, write tests there; `run`, run tests there. Each is allowed when left out. Open QA Stack is not meant to work against production: an environment that should not have tests written or run against it says so, and a session that writes tests, or a launch or a campaign that runs them, is refused before it starts, with a message that names the applications that forbid it and what to do. Nothing is refused by the address itself: the person decides.

### Named API

| Key | Type | Required | Example |
|---|---|---|---|
| `name` | non-empty string, unique within the environment | yes | `"policy-management-backend"` |
| `baseUrl` | URL | yes | `"http://localhost:8090"` |

### Knowledge

Every knowledge source has an `id`, a `type`, the keys its type requires, and its `attachments` when it describes given applications.

| Key | Type | Required | Example |
|---|---|---|---|
| `id` | slug, unique | yes | `"policy-management-api"` |
| `type` | `openapi`, `postgresql`, `document`, `source-code` or `logs` | yes | `"openapi"` |
| `attachments` | array of [attachments](#attachment) | no: left out, or empty, for a source of the whole project | `[{ "application": "policy-management" }]` |
| `url` | URL, for `openapi`; exactly one of `url` and `path` | see type | `"http://localhost:8090/v3/api-docs"` |
| `path` | path, for `openapi`, `document`, `source-code` and `logs` | see type | `"contracts/policy-management.json"`, `"specs/quotes.md"`, `"../policy-management"` |
| `stored` | `true`, for `document`; exactly one of `path` and `stored` | see type | `true` |
| `connectionStringEnv` | variable, for `postgresql` | see type | `"POLICY_MANAGEMENT_DB_URL"` |
| `commands` | `none`, `git` or `shell`, for `source-code` | no, `git` by default | `"none"` |
| `container` | container name, for `logs`; exactly one of `path` and `container` | see type | `"policy-management-backend"` |
| `engine` | `podman` or `docker`, for `logs` with a `container` | with `container` | `"podman"` |

The path of a contract or a document stays inside the test repository. A `document` path is one file, read as Markdown, or a folder, whose Markdown files are all read: `"specs"`.

A `document` source declared `"stored": true` holds documents uploaded to the instance rather than files of the test repository: the database of the instance keeps them, and only it. Each is a Markdown file of 1,000,000 bytes at most, text in UTF-8, named once in its source; an upload holds 20 at most, and is kept whole or not at all. When a run starts, it writes the documents of each such source to `<stateDir>/documents/<id>/`, which it empties first, and its agents read them there as they read a folder of the repository; `resolvedConfig` gives the source that folder as its `path`. The folder is a copy for the run, not a second place to write them: what is written there is replaced by the next run. The documents stay with the identifier of their source: a source removed from the configuration, then declared again under the same identifier, finds them again. The path of a `source-code` folder, or of a log file, may lead outside it, since the code of an application often lives in another repository: `"../policy-management"`. The agents' reading and git tools never leave that folder.

A `logs` source gives the agents the lines a service writes: those of a file, `{ "path": "../policy-management/logs/service.log" }`, or those of a container, `{ "container": "policy-management-backend", "engine": "podman" }`, read with `podman logs` or `docker logs`. Attach it to the environment the service runs in. The agents read it after an action, to see what the service did; the cartography does not map it. It is meant for the solo mode, where the service runs on the same machine as the agents: a worker that does not run the application cannot reach its file or its container.

`commands` sets the risk an agent may take in a source code folder. With `none`, the agents only list, search and read files. With `git`, the default, they may also read the history with `git log`, `git blame` and `git show`, run without a shell and limited to the folder. With `shell`, they may run any command in the folder, with the rights of the user who runs the agents: such a command can write, and read outside the folder. Choose it only where you accept that risk.

The other kinds of knowledge the product plans (SOAP contracts, tickets, test data sets) are not supported by this format version.

### Attachment

A source with attachments describes the applications they name: the sessions read it in the environments they leave open or name. A source without any is of the whole project, and read in every environment. A session that tests none of the applications of a source still reads it, but each answer of its tools warns that it describes other applications (see [the tools of the knowledge](../../tools/docs/knowledge-tools.md#failures)).

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
| `stateDir` | `.oqas` | Where the solo mode keeps its state, and where an instance that is given no other database keeps its own, in the file `oqas.db`. |
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

### Design

| Key | Type | Default | Example |
|---|---|---|---|
| `reviewPlan` | boolean | `true` | `false` |
| `reviewTests` | boolean | `true` | `false` |
| `reviewCode` | boolean | `true` | `false` |
| `levels` | array of levels, at least one, each once | `["smoke", "functional", "business"]` | `["functional"]` |
| `passes` | `by-level` or `single` | `by-level` | `single` |
| `architecture` | `page-objects`, `fixtures` or `standalone` | `page-objects` | `standalone` |
| `fixturesFile` | path relative to the test repository | `fixtures.ts` in the folder `shared` of the applications | `support/test.ts` |
| `visualTests` | boolean | `true` | `false` |
| `visualTolerance` | number from 0 to 1 | `0.01` | `0.05` |
| `testLanguage` | `en` or `fr` | `en` | `"fr"` |

The agent that plans submits its scenarios in several calls, and the harness sets aside each one another already covers. It first compares them by their code: the same steps, the same values, no text expected that the other does not expect. With `reviewPlan`, an agent of its own then reviews the scenarios the code let through, in sessions of the model of their own; `false` keeps the comparison by the code alone, and spares those sessions.

`reviewTests` has an agent of its own read each test that passed against the scenario of its plan, in a session of the model of its own. What it finds is told once to the agent that wrote the test, and kept with the test: it refuses none.

`reviewCode` has another agent of its own read the code of each test that passed for its quality, against the test charter. What the agent that wrote the test can repair is told to it once; what its plan fixed, such as a date asserted, is kept for a person. It refuses no test.

`levels` names the levels of the pyramid of tests a plan is asked for, from its base to its top:

| Level | What a test of it verifies |
|---|---|
| `smoke` | The application answers: it opens its first address and finds one text. |
| `functional` | One behaviour of one screen, a test each: a search by first name and a search that matches nothing are two tests. |
| `business` | A whole journey ends as it must, through several screens and with real data. |
| `cross-application` | An action in one application has its effect in another. |
| `end-to-end` | A journey goes through three applications or more. |

`passes` says how those levels are designed. With `by-level`, each level is a pass of its own, from the base of the pyramid to its top: an agent plans that level alone, another writes its tests, and the next level starts once that one is over, told the tests it gave. With `single`, every level is planned in one pass.

`architecture` says how the tests of the repository are built:

| Architecture | What a test looks like |
|---|---|
| `page-objects` | It acts on the page objects of the screens, one class per screen under `<application>/pages/`, written from the plans and added to, never written again. It is given each application by the fixtures the tests share. |
| `fixtures` | Each line acts on the page. It imports the fixtures the tests share, which give each application. |
| `standalone` | It imports Playwright itself, and nothing is written beside it: for a repository with an architecture of its own. |

`fixturesFile` names the file of those fixtures. A file already there is kept as it is, and written when the repository has none.

`testLanguage` is the language of what the tests say, as a BCP 47 tag: their titles, their steps and the intents written in their code. The code itself, its names included, stays in English.

`visualTests` adds a last pass, of visual tests: an agent plans the states of the screens worth comparing — a screen as it opens, a dialog open, a page a click leads to — and each test compares the whole page with a reference made at its first run and committed with it. `visualTolerance` is the share of the pixels that may differ. A reference is that of one browser on one machine.


### Model

The model is reached in one of two ways, which `mode` tells: with a provider key on an OpenAI-compatible server, or with the GitHub account of the machine for a model of GitHub Copilot.

A provider key:

| Key | Type | Required | Example |
|---|---|---|---|
| `mode` | `provider-key` | yes | `"provider-key"` |
| `provider` | `openai`: an OpenAI-compatible API | yes | `"openai"` |
| `baseUrl` | URL | yes | `"http://localhost:1234/v1"` |
| `model` | non-empty string, as the server names the model | yes | `"local-model"` |
| `apiKeyEnv` | variable, when the server requires a key | no | `"OQAS_MODEL_API_KEY"` |
| `capabilities` | list of `vision`: what the model can do besides reading and writing text | no | `["vision"]` |
| `reasoningEffort` | non-empty string, as the server names it: how much the model reasons before it answers | no | `"none"` |
| `requestTimeoutSeconds` | whole number of seconds, one at least: the longest wait for the answer to one request | no | `120` |

Either way, `roles` gives a role a model of its own, offered by the same connection, with the same key; a role it leaves out uses `model`:

| Key | Type | Required | Example |
|---|---|---|---|
| `roles.cartographer`, `roles.designer`, `roles.reviewer` | the agent that maps the knowledge, the one that plans and writes the tests, the ones that review the plan and the tests | no | `{ "model": "small-model" }` |
| `roles.<role>.model` | non-empty string | yes | `"small-model"` |
| `roles.<role>.capabilities`, `roles.<role>.reasoningEffort` | as for `model`; what is set on `model` is not taken over, since it is said of another model | no | `["vision"]` |

The journal of a run tells the model of each role that has one, and the cards, the index and the state of a design keep the model that produced them. The prerequisites check that the server answers, not that it offers each model.

The console offers by name the providers whose OpenAI-compatible API is known, and fills in their address and the variable their key is usually kept in: the five that `MODEL_PROVIDERS` lists, OpenAI first. Any other server, a model run on the machine among them, is reached by its address.

The GitHub account of the machine:

| Key | Type | Required | Example |
|---|---|---|---|
| `mode` | `github` | yes | `"github"` |
| `model` | non-empty string, as Copilot names the model | yes | `"gpt-5"` |
| `capabilities` | list of `vision` | no | `["vision"]` |
| `reasoningEffort` | non-empty string, among the efforts Copilot offers for the model | no | `"high"` |

The account is the one the GitHub CLI (`gh auth login`) or the Copilot CLI signed in with, on the machine that runs the product: a workstation, or the machine that hosts an instance. It needs a GitHub Copilot subscription. The file names no key, and the product reads no token: the SDK of Copilot finds the account itself. On a machine several people use, they all go through that account. An address, a key, a wait or a provider is refused for this mode, at its JSON path.

`vision` says that the model reads images. The screenshot tool of each application then gives the model the image it takes, besides its path, within the bounds the [browser tools](../../tools/docs/browser-tools.md#screenshots-the-model-reads) describe. Declare it only for a model that reads images: without it, the model is given the path alone, as for any model. Any other value is refused with the rule `unknown-variant`, at its JSON path, such as `/model/capabilities/0`.

`requestTimeoutSeconds` bounds the wait for the answer to one request of a provider key: 120 seconds by default. A request left without answer is sent once more, and the task fails when the second one gets none either, with `The model gave no answer within 120 seconds, 2 times in a row.`.

`reasoningEffort` is sent with every request to the model, in place of the effort the agent runtime would ask for. Leave it out for a server that ignores it. Set it when a server refuses the default: some models accept tools on the chat completions API only with `none`, and say so in the reason of their refusal.

### Autonomy

How far the agents may go on their own. Without `autonomy`, the level is `bounded`, each task to ten minutes (`{ "level": "bounded", "task": { "maxMinutes": 10 } }`), with the two-hour guardrail.

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
| `guardrailMinutes` | positive integer: the minutes, from the start of a run, after which every task of its agents stops | no; `120` at each level | `240` |

`task` is only for `bounded`, which requires it with one criterion at least; a criterion left out does not bound the task. A bounded level looks like this:

```json
{
  "level": "bounded",
  "task": { "maxMinutes": 30 },
  "guardrailMinutes": 240
}
```

The guardrail bounds the tasks of the agents, not the installation of the dependencies nor the execution of the tests: a task still running when it is reached stops at its next call to the model or to a tool, and is journaled as stopped by its duration limit. A run whose task a limit or the guardrail stopped keeps what it produced in the test repository: the cards made, the plan accepted and the tests kept, on the branch of the design. A level of an earlier version of the format is refused with the rule `retired-level`, whose message names the level to write instead.

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
