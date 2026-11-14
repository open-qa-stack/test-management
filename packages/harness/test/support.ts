import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
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
 * @param vision - Whether the model reads images.
 * @returns What `use` returns.
 */
export async function withRuntime<T>(
  mode: GatewayMode,
  model: string,
  use: (runtime: CopilotAgentRuntime, gateway: ModelGateway) => Promise<T>,
  clock?: Clock,
  vision = false,
): Promise<T> {
  const gateway = await ModelGateway.start(mode);
  const home = mkdtempSync(join(tmpdir(), "oqas-copilot-test-"));
  const runtime = new CopilotAgentRuntime({ endpoint: gateway, model, homeDirectory: home, vision, ...(clock === undefined ? {} : { clock }) });
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

/**
 * A PNG image of one colour, made without a browser so that its bytes are the same on every machine.
 *
 * @param width - Its width, in pixels.
 * @param height - Its height, in pixels.
 * @returns The bytes of the image.
 */
export function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x40)]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", pixels),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
