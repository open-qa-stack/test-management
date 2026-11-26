import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { AGENT_PROMPTS, promptOf } from "@open-qa-stack/agents";
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
    const team = new TeamRuntime(runtime, { writer: { instructions: "Say policy." } }, (agent, part) => given.push(`${agent} ${part}`));
    await team.openSession({ agent: "writer", instructions: "You write.", tools: [] });
    await team.openSession({ agent: "planner", instructions: "You plan.", tools: [] });
    await team.openSession({ instructions: "You check.", tools: [] });
    assert.deepEqual(
      opened.map(({ instructions }) => instructions),
      ["You write.\n\nInstructions of the team:\n\nSay policy.", "You plan.", "You check."],
    );
    assert.deepEqual(given, ["writer instructions"]);
    await team.close();
    assert.equal(closed(), true);
  });

  it("puts the prompt the team wrote in place of that of the agent, with the values of its variables, and keeps what follows it", async () => {
    const { runtime, opened } = recording();
    const given: string[] = [];
    const values = { run_tool: "run_test", propose_tool: "propose_test", playwright_read_tool: "playwright_read", copied: "pages" };
    const prompt = { text: "Write with {{run_tool}}, then {{propose_tool}}; {{unknown}} stays.", basedOn: "a".repeat(64) };
    const team = new TeamRuntime(runtime, { writer: { prompt, instructions: "Say policy." } }, (agent, part, digest) =>
      given.push(`${agent} ${part} ${digest.length}`),
    );
    await team.openSession({ agent: "writer", instructions: `${promptOf(AGENT_PROMPTS.writer, values)}\n\nThe charter.`, values, tools: [] });
    assert.equal(
      opened[0]!.instructions,
      "Write with run_test, then propose_test; {{unknown}} stays.\n\nThe charter.\n\nInstructions of the team:\n\nSay policy.",
    );
    assert.deepEqual(given, ["writer prompt 12", "writer instructions 12"]);
  });

  it("refuses a session whose instructions do not start with the prompt of its agent, which the team replaced", async () => {
    const { runtime, opened } = recording();
    const team = new TeamRuntime(runtime, { planner: { prompt: { text: "Plan.", basedOn: "a".repeat(64) } } }, () => undefined);
    await assert.rejects(
      team.openSession({ agent: "planner", instructions: "You plan.", tools: [] }),
      /The session of the planner does not start with its prompt/,
    );
    assert.equal(opened.length, 0);
  });
});
