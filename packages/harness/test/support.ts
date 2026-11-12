import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, AgentSession, SessionOptions } from "@open-qa-stack/domain";
import { CopilotAgentRuntime, ModelGateway, parseRecording, type Clock, type GatewayMode, type Recording } from "../src/index.ts";

/** Folder of the recordings the tests replay. */
export const RECORDINGS = new URL("./recordings/", import.meta.url);
/** Model identifier used with scripted model servers. */
export const MODEL = "test-model";

/**
 * @param name - File name of a recording in `RECORDINGS`.
 * @returns The recording, parsed.
 */
export function loadRecording(name: string): Recording {
  return parseRecording(readFileSync(new URL(name, RECORDINGS), "utf8"));
}

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const all: AgentEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

/**
 * Runs `use` with a Copilot runtime behind a gateway, then releases both.
 *
 * @param mode - How the gateway answers.
 * @param model - Model identifier the runtime asks for.
 * @param use - What to do with the runtime and its gateway.
 * @param clock - Clock of the runtime, the system clock when absent.
 * @returns What `use` returns.
 */
export async function withRuntime<T>(
  mode: GatewayMode,
  model: string,
  use: (runtime: CopilotAgentRuntime, gateway: ModelGateway) => Promise<T>,
  clock?: Clock,
): Promise<T> {
  const gateway = await ModelGateway.start(mode);
  const home = mkdtempSync(join(tmpdir(), "oqas-copilot-test-"));
  const runtime = new CopilotAgentRuntime({ endpoint: gateway, model, homeDirectory: home, ...(clock === undefined ? {} : { clock }) });
  try {
    return await use(runtime, gateway);
  } finally {
    await runtime.close();
    await gateway.close();
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * Opens a session, sends one message, closes the session.
 *
 * @returns The events of the turn.
 */
export async function exchange(runtime: CopilotAgentRuntime, options: SessionOptions, message: string): Promise<AgentEvent[]> {
  const session: AgentSession = await runtime.openSession(options);
  try {
    return await collect(session.send(message));
  } finally {
    await session.close();
  }
}

/** A scripted model server and what it received. */
export interface ScriptedServer {
  readonly baseUrl: string;
  readonly requests: { readonly body: unknown; readonly headers: IncomingHttpHeaders }[];
  close(): Promise<void>;
}

/**
 * Starts a model server that answers each request with the next scripted reply.
 *
 * @param replies - Status (200 by default) and body of each reply, in order; a `raw` body is sent as is.
 * @returns The running server.
 */
export async function scriptedServer(replies: readonly { status?: number; body: unknown; raw?: boolean }[]): Promise<ScriptedServer> {
  const requests: { body: unknown; headers: IncomingHttpHeaders }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      requests.push({ body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown, headers: req.headers });
      const reply = replies[requests.length - 1] ?? { status: 500, body: { error: { message: "script exhausted" } } };
      res.writeHead(reply.status ?? 200, { "content-type": "application/json" });
      res.end("raw" in reply && reply.raw === true ? String(reply.body) : JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * @param content - Text the model writes next to its tool calls.
 * @returns A chat completion that calls the given tools.
 */
export function toolCalls(model: string, calls: readonly { id: string; name: string; arguments: unknown }[], content = ""): unknown {
  return completion(model, {
    role: "assistant",
    content,
    tool_calls: calls.map((c) => ({ type: "function", id: c.id, function: { name: c.name, arguments: JSON.stringify(c.arguments) } })),
  }, "tool_calls");
}

/** @returns A chat completion that answers with `text`. */
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

/** @returns A loopback port nothing listens on. */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
