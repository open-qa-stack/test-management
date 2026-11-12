# Agent runtime

The harness talks to a model through the `AgentRuntime` interface of `@open-qa-stack/domain`. A runtime opens sessions; a session receives messages and yields events. The harness never depends on how the model is reached.

```ts
const runtime: AgentRuntime = new CopilotAgentRuntime({ endpoint: gateway, model: "qwen/qwen3-coder-30b", homeDirectory });
const session = await runtime.openSession({ instructions, tools });
for await (const event of session.send("Map the application.")) {
  // text, tool-call, tool-result, tool-error, then end or error
}
await session.close();
await runtime.close();
```

## Events

| Event | Meaning |
|---|---|
| `text` | Text the model produced. |
| `tool-call` | The model called a tool, with these arguments. |
| `tool-result` | The tool ran and returned this result. |
| `tool-error` | The call produced no result: `unknown-tool` (the session offers no such tool), `invalid-arguments` (the arguments did not match the tool's schema, so the tool did not run) or `failed` (the tool threw). The model is told and may try again. |
| `end` | The agent has answered the message. |
| `error` | The turn cannot go on: `ModelUnreachableError` (the model server did not answer; the error names the address tried), `ReplayMissError` (a replayed session sent a request its recording lacks), `ModelResponseError` (the server answered with an error, or with something that is not JSON) or `SessionClosedError` (the session was closed during the turn). The session can take another message after a model error. |

## Tools

A tool has a `name`, a `description` for the model, a JSON Schema of its `parameters` and an `execute` function. Arguments are checked against the schema before `execute` runs; arguments that do not match never reach it.

## The Copilot implementation

`CopilotAgentRuntime` drives the GitHub Copilot SDK with a provider key on an OpenAI-compatible server (chat completions). Sessions offer their own tools only: the built-in tools of the Copilot runtime are off, and no GitHub account is used. The runtime process gets only the environment variables it needs to start (`PATH`, `HOME`, the locale and the temporary folders), never a key. Tool calls are reported in the order the model listed them; when the model asks for several tools at once, they run concurrently and their results arrive in the order they finish. The SDK ships the Copilot runtime for each platform as an optional dependency of `@github/copilot-sdk`; installing the package installs it.

## The model gateway

The runtime never calls the model server directly. It calls a `ModelGateway`, a local HTTP server that:

- in `live` mode, forwards each request to the model server;
- in `record` mode, forwards each request and keeps every successful exchange as a [recording](recording-format.md);
- in `replay` mode, answers from a recording and never contacts a model.

Because the gateway makes the call, it knows why one fails, and the runtime turns that into a typed error. An API key is given to the gateway only: it is sent to the model server as a bearer token and never reaches the Copilot runtime, a recording, a log or an error. A failure is answered with status 400, which the Copilot runtime reports at once; it would otherwise retry an unreachable server for about twenty seconds. A gateway serves one session at a time: it remembers why the latest request failed, whoever sent it.

## Checking a model

`TOOL_CALLING_CHECK` is a session with two tools, one without arguments and one with structured arguments, and a message that asks for both and for their results in the answer. A model handles tool calls for this check when it calls both tools, with arguments that match their schemas, calls no other tool, and quotes both results. `pnpm record:tool-calling --model <id> --server "<name and version>" --out <file>` runs it against a model server and writes the recording.
