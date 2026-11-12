import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { serializeRecording, TOOL_CALLING_CHECK, type Recording } from "../src/index.ts";
import { answer, exchange, MODEL, RECORDINGS, scriptedServer, toolCalls, withRuntime } from "./support.ts";

/**
 * Handwritten recordings are produced by recording a scripted model server, so that their requests are
 * exactly those the runtime sends. Run `pnpm recordings:update` to rewrite them.
 */
const SCRIPTS = {
  "invalid-arguments.json": {
    purpose: "The model calls convert_price with arguments that do not match its schema, then gives up.",
    replies: [
      toolCalls(MODEL, [{ id: "call-1", name: "convert_price", arguments: { amount: "lots", currency: "GBP" } }]),
      answer(MODEL, "I could not convert the price."),
    ],
  },
  "unknown-tool.json": {
    purpose: "The model calls a tool the session does not offer next to one it does, then answers.",
    replies: [
      toolCalls(MODEL, [
        { id: "call-1", name: "delete_everything", arguments: {} },
        { id: "call-2", name: "get_inventory", arguments: {} },
      ]),
      answer(MODEL, "There are 7 items in stock."),
    ],
  },
} as const;

async function produce(purpose: string, replies: readonly unknown[]): Promise<Recording> {
  const server = await scriptedServer(replies.map((body) => ({ body })));
  try {
    return await withRuntime(
      { kind: "record", upstream: { baseUrl: server.baseUrl }, origin: { kind: "recorded", model: MODEL, server: "scripted", recordedOn: "2026-01-01" } },
      MODEL,
      async (runtime, gateway) => {
        await exchange(runtime, TOOL_CALLING_CHECK.session(), TOOL_CALLING_CHECK.message);
        return { ...gateway.recording, origin: { kind: "handwritten", purpose } };
      },
    );
  } finally {
    await server.close();
  }
}

describe("handwritten recordings", () => {
  for (const [file, script] of Object.entries(SCRIPTS)) {
    it(`${file} is what its script produces`, async () => {
      const content = serializeRecording(await produce(script.purpose, script.replies));
      const target = new URL(file, RECORDINGS);
      if (process.env["UPDATE_RECORDINGS"] === "1") writeFileSync(target, content);
      assert.equal(readFileSync(target, "utf8"), content);
    });
  }
});
