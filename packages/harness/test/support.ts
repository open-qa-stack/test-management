import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
