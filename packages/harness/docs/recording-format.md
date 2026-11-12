# Recording format

A recording holds the exchanges between the model runtime and a model server, so that a session can be replayed without a model. Tests of the harness only ever replay recordings. A recording is a JSON file; `parseRecording` reads one and refuses anything that does not match format version 1.

```json
{
  "formatVersion": 1,
  "origin": { "kind": "recorded", "model": "qwen/qwen3-coder-30b", "server": "LM Studio 0.4.28", "recordedOn": "2026-11-12" },
  "exchanges": [
    {
      "request": { "model": "qwen/qwen3-coder-30b", "messages": [{ "role": "user", "content": "…" }], "tools": ["get_inventory"] },
      "response": { "object": "chat.completion", "choices": ["…"] }
    }
  ]
}
```

## Fields

| Field | Description |
|---|---|
| `formatVersion` | `1`. A later format gets another number. |
| `origin` | Where the recording comes from; see below. |
| `exchanges` | The requests and responses, in the order they happened. |
| `exchanges[].request` | What identifies the request: `model`, `messages` and the names of the `tools` offered. |
| `exchanges[].response` | The body of the chat completion response, as the server sent it. |

A message keeps its `role`, its `content` (`null` when it has none), and, when present, `toolCallId` (the call a tool result answers) and `toolCalls` (each with `id`, `name` and `arguments` as the JSON string the model wrote).

## Origin

| `kind` | Fields | Meaning |
|---|---|---|
| `recorded` | `model`, `server`, `recordedOn` (`YYYY-MM-DD`) | Captured from a real model server in `record` mode. |
| `handwritten` | `purpose` | Written for a test scenario; no model produced it. |

The handwritten recordings of the tests are produced by recording a scripted model server, so that their requests are exactly those the runtime sends; `pnpm recordings:update` rewrites them.

## How a request is matched

On replay, a request is reduced the same way and matched to the first unused exchange whose `request` is identical. Everything else in the request body is left out, including the current date and time the Copilot runtime adds to user messages. A request with no match is a replay error that describes it by its rank and its last message; it is never sent to a model.

A recording follows the requests of a given version of the Copilot runtime. When an update changes them, recordings are produced again.

## What a recording never holds

No API key: keys are sent by the gateway as a header, and headers are not recorded. The tests check every recording they ship for keys, authorization headers and absolute paths of a machine; keeping names of real companies or people out of a recording is up to whoever records it.
