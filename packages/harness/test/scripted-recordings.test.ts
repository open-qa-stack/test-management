import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { scriptedServer } from "@open-qa-stack/testing";
import { serializeRecording, type Recording } from "../src/index.ts";
import { ManualClock, SCENARIOS, type Scenario } from "./scenarios.ts";
import { exchange, MODEL, RECORDINGS, withRuntime } from "./support.ts";

/**
 * Produces the recording of a scenario by recording a scripted model server, so that its requests are
 * exactly those the runtime sends.
 */
async function produce(scenario: Scenario): Promise<Recording> {
  const server = await scriptedServer(scenario.replies.map((body) => ({ body })));
  const clock = new ManualClock();
  try {
    return await withRuntime(
      { kind: "record", upstream: { baseUrl: server.baseUrl }, origin: { kind: "recorded", model: MODEL, server: "scripted", recordedOn: "2026-01-01" } },
      MODEL,
      async (runtime, gateway) => {
        await exchange(runtime, scenario.session(clock, new Map()), scenario.message);
        return { ...gateway.recording, origin: { kind: "handwritten", purpose: scenario.purpose } };
      },
      clock,
      scenario.vision,
    );
  } finally {
    await server.close();
  }
}

describe("handwritten recordings (run `pnpm recordings:update` to rewrite them)", () => {
  for (const [file, scenario] of Object.entries(SCENARIOS)) {
    it(`${file} is what its scenario produces`, async () => {
      const content = serializeRecording(await produce(scenario));
      const target = new URL(file, RECORDINGS);
      if (process.env["UPDATE_RECORDINGS"] === "1") writeFileSync(target, content);
      assert.equal(readFileSync(target, "utf8"), content);
    });
  }
});
