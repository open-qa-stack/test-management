# Agent runtime

The harness talks to a model through the `AgentRuntime` interface of `@open-qa-stack/domain`. A runtime opens sessions; a session receives messages and yields events. The harness never depends on how the model is reached.

```ts
const runtime: AgentRuntime = new CopilotAgentRuntime({ endpoint: gateway, model: "qwen/qwen3-coder-30b", homeDirectory });
const session = await runtime.openSession({ instructions, tools });
for await (const event of session.send("Map the application.")) {
  // reasoning, text, tool-call, tool-result, tool-error, then end or error
}
await session.close();
await runtime.close();
```

## Events

| Event | Meaning |
|---|---|
| `reasoning` | What the model thought before it answered or called a tool, when the model gives it. |
| `text` | Text the model produced. |
| `tool-call` | The model called a tool, with these arguments. |
| `tool-result` | The tool ran and returned this result. A result with an image is reported as the model reads it: the image by its type and size only, or the reason it was not shown. |
| `tool-error` | The call produced no result: `unknown-tool` (the session offers no such tool), `invalid-arguments` (the arguments did not match the tool's schema, so the tool did not run) or `failed` (the tool threw). The model is told and may try again. |
| `end` | The agent has answered the message. A session with limits gives the counters it used: iterations, actions and elapsed time, and the tokens sent and received (`inputTokens`, `outputTokens`) once the model reported some, those of the tokens sent that its server read from its cache (`cachedTokens`, from `usage.prompt_tokens_details.cached_tokens`) once it reported some, and those of the images (`imageTokens`) once one was sent. |
| `stopped` | The harness stopped the task at a limit: the reason names the limit (`iterations`, `duration` or `actions`) and gives its counters: iterations, actions, elapsed time and, once the model reported some, `inputTokens` and `outputTokens`, and `imageTokens` once an image was sent. |
| `error` | The turn cannot go on: `ModelUnreachableError` (the model server did not answer; the error names the address tried), `ReplayMissError` (a replayed session sent a request its recording lacks), `ModelResponseError` (the server answered with an error, or with something that is not JSON) or `SessionClosedError` (the session was closed during the turn). The session can take another message after a model error. A session with limits gives its counters here too, as `stopped` does. |

## Limits

A session may carry `limits`: model calls (iterations), duration and browser actions. Its gateway channel counts each model call and serves none once the task is stopped; the Copilot pre-tool hook counts each call of a tool declared with `browserAction: true` and refuses calls once the task is stopped. Duration is checked before each model call and each tool call. The channel also adds up the tokens each answer of the model reports in its `usage` (`prompt_tokens` and `completion_tokens`); a model that reports none leaves the counters without tokens. The channel counts the images itself, since models leave them out of `usage`: each image costs `imageTokens`, its width times its height over 1024, rounded up, in each call that carries it. A call that reaches a limit exactly runs; the next one does not. A stopped turn ends with `stopped`, and its verdict is `indeterminate`, whatever the model says.

## Tools

A tool has a `name`, a `description` for the model, a JSON Schema of its `parameters` and an `execute` function. Arguments are checked against the schema before `execute` runs; arguments that do not match never reach it.

A tool gives the model an image by returning an `ImageToolResult`: what the model reads, and a PNG image. A runtime created with `vision: true` declares that the model reads images and shows it the images of a session, three at most (`MAX_SESSION_IMAGES`), since an image stays in the conversation and goes again with each later call, and none larger than 2000 pixels a side (`MAX_IMAGE_SIDE`) or 3 MiB (`MAX_IMAGE_BYTES`), which the SDK would reduce before sending it. For any other image, or without `vision`, the model reads the result alone, with the reason under `imageNotShown`. The Copilot SDK sends the result in the tool message, then the image in a user message of its own, as a data URL; without the declaration, it would leave the image out.

## The Copilot implementation

`CopilotAgentRuntime` drives the GitHub Copilot SDK with a provider key on an OpenAI-compatible server (chat completions). Sessions offer their own tools only: the built-in tools of the Copilot runtime are off, and no GitHub account is used. The runtime process gets only the environment variables it needs to start (`PATH`, `HOME`, the locale and the temporary folders), never a key. Tool calls are reported in the order the model listed them; when the model asks for several tools at once, they run concurrently and their results arrive in the order they finish. The SDK ships the Copilot runtime for each platform as an optional dependency of `@github/copilot-sdk`; installing the package installs it.

## The model gateway

The runtime never calls the model server directly. It calls a `ModelGateway`, a local HTTP server that:

- in `live` mode, forwards each request to the model server;
- in `record` mode, forwards each request and keeps every successful exchange as a [recording](recording-format.md);
- in `replay` mode, answers from a recording and never contacts a model.

Because the gateway makes the call, it knows why one fails, and the runtime turns that into a typed error. An API key is given to the gateway only: it is sent to the model server as a bearer token and never reaches the Copilot runtime, a recording, a log or an error. When the model server answers with an error status, the error gives the reason its answer states, on one line and cut to 300 characters, such as `The model answered with status 400: Unsupported parameter.`. A failure is answered with status 400, which the Copilot runtime reports at once; it would otherwise retry an unreachable server for about twenty seconds. Each session talks to its own channel of the gateway (`createChannel`), which keeps its own limits and its own latest failure: sessions never see each other's. The gateway waits up to five minutes for the model to answer one call, or the wait its upstream gives (`timeoutMs`). A call left without answer is sent once more: a hosted model sometimes leaves one hanging. When the second gets none either, the error says so: `The model gave no answer within 300 seconds, 2 times in a row.`

## Checking a model

`TOOL_CALLING_CHECK` is a session with two tools, one without arguments and one with structured arguments, and a message that asks for both and for their results in the answer. A model handles tool calls for this check when it calls both tools, with arguments that match their schemas, calls no other tool, and quotes both results. `pnpm record:tool-calling --model <id> --server "<name and version>" --out <file>` runs it against a model server and writes the recording.
