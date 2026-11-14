import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

/** A scripted model server and what it received. */
export interface ScriptedServer {
  /** Base URL of its OpenAI-compatible API, ending in `/v1`. */
  readonly baseUrl: string;
  /** The requests received so far. */
  readonly requests: { readonly body: unknown; readonly headers: IncomingHttpHeaders }[];
  /** Stops the server. */
  close(): Promise<void>;
}

/**
 * Starts a model server that answers each request with the next scripted reply.
 *
 * @param replies - Status (200 by default) and body of each reply, in order; a `raw` body is sent as is, and a
 * reply with `delayMs` is sent only after that many milliseconds, as a server slow to answer does.
 * @returns The running server.
 */
export async function scriptedServer(replies: readonly { status?: number; body: unknown; raw?: boolean; delayMs?: number }[]): Promise<ScriptedServer> {
  const requests: { body: unknown; headers: IncomingHttpHeaders }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      // A request without a body, such as the list of the models, has none.
      requests.push({ body: text === "" ? undefined : (JSON.parse(text) as unknown), headers: req.headers });
      const reply = replies[requests.length - 1] ?? { status: 500, body: { error: { message: "script exhausted" } } };
      const send = () => {
        res.writeHead(reply.status ?? 200, { "content-type": "application/json" });
        res.end("raw" in reply && reply.raw === true ? String(reply.body) : JSON.stringify(reply.body));
      };
      const delay = "delayMs" in reply ? reply.delayMs : undefined;
      if (delay === undefined) send();
      else setTimeout(send, delay).unref();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        // A request still waiting for a delayed reply is dropped with its connection.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * @param model - Model identifier the completion names.
 * @param calls - The tool calls, in order.
 * @param content - Text the model writes next to its tool calls.
 * @returns A chat completion that calls the given tools.
 */
export function toolCalls(model: string, calls: readonly { id: string; name: string; arguments: unknown }[], content = ""): unknown {
  return completion(
    model,
    {
      role: "assistant",
      content,
      tool_calls: calls.map((c) => ({ type: "function", id: c.id, function: { name: c.name, arguments: JSON.stringify(c.arguments) } })),
    },
    "tool_calls",
  );
}

/**
 * @param model - Model identifier the completion names.
 * @param text - What the model answers.
 * @returns A chat completion that answers with `text`.
 */
export function answer(model: string, text: string): unknown {
  return completion(model, { role: "assistant", content: text }, "stop");
}

function completion(model: string, message: unknown, finish: string): unknown {
  return {
    id: "chatcmpl-scripted",
    object: "chat.completion",
    created: 0,
    model,
    choices: [{ index: 0, message, finish_reason: finish }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}
