import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { AgentRuntime, SessionOptions } from "@open-qa-stack/domain";
import { TeamRuntime } from "../src/runtime/team-runtime.ts";

/** A runtime that records what each session is opened with, and whether it was closed. */
function recording(): { runtime: AgentRuntime; opened: SessionOptions[]; closed: () => boolean } {
  const opened: SessionOptions[] = [];
  let closed = false;
  const runtime: AgentRuntime = {
    openSession: (options) => {
      opened.push(options);
      return Promise.resolve({ send: async function* () {}, close: () => Promise.resolve() });
    },
    close: () => {
      closed = true;
      return Promise.resolve();
    },
  };
  return { runtime, opened, closed: () => closed };
}

describe("the runtime that follows what the team asks", () => {
  it("ends the prompt of the agent asked, leaves the others and a session of no agent as they are, and closes what it wraps", async () => {
    const { runtime, opened, closed } = recording();
    const given: string[] = [];
    const team = new TeamRuntime(runtime, { writer: { instructions: "Say policy." } }, (agent) => given.push(agent));
    await team.openSession({ agent: "writer", instructions: "You write.", tools: [] });
    await team.openSession({ agent: "planner", instructions: "You plan.", tools: [] });
    await team.openSession({ instructions: "You check.", tools: [] });
    assert.deepEqual(
      opened.map(({ instructions }) => instructions),
      ["You write.\n\nInstructions of the team:\n\nSay policy.", "You plan.", "You check."],
    );
    assert.deepEqual(given, ["writer"]);
    await team.close();
    assert.equal(closed(), true);
  });
});
