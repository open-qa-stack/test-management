# Running the API

`@open-qa-stack/api` is the back end of an instance: a NestJS application on the Fastify adapter. It needs no database, identity provider, secret manager or cache to start.

```sh
pnpm --filter @open-qa-stack/api build
OQAS_PORT=8080 pnpm --filter @open-qa-stack/api start
```

## Configuration

The API reads its configuration once, at startup, from environment variables only. Nothing else is read later.

| Variable | Type | Required | Secret | Default | Example | What it sets |
|---|---|---|---|---|---|---|
| `OQAS_HOST` | a text that is not empty | no | no | `0.0.0.0` | `127.0.0.1` | The address the API listens on. |
| `OQAS_PORT` | an integer from 1 to 65535 | yes | no | | `8080` | The TCP port the API listens on. |

A missing required variable or an invalid value stops the startup before anything listens. The process exits with code `1` and writes to the error output one line per variable at fault, naming the variable and the rule it breaks, never its value:

```text
The configuration is invalid:
- OQAS_PORT must be an integer from 1 to 65535.
```

A variable marked secret never appears in a log, an error message or a response.

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

## Stopping

On `SIGTERM` or `SIGINT`, the API closes its modules and its server, then exits on that signal.

## Development

NestJS relies on legacy TypeScript decorators and on the metadata the compiler emits for them, which Node cannot strip from a `.ts` file. Unlike the other packages, this one is therefore compiled to `dist/` before it runs, and its tests run on the compiled files; coverage is mapped back to `src/` through the source maps.

Under that mapping, a line before the first or after the last statement that emits code counts as uncovered: in a module that holds code, put the value imports first, and keep a type declared alone at the top or at the bottom of a module in its own file.
