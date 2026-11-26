import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import { AGENT_PROMPTS } from "@open-qa-stack/agents";
import { AGENT_KEYS } from "@open-qa-stack/domain";
import { AgentPrompts } from "../src/index.ts";

describe("the prompts of the agents", () => {
  it("are those the code writes, each with its variables and the SHA-256 of its text", () => {
    const listed = new AgentPrompts().list();
    assert.deepEqual(
      listed.map(({ agent }) => agent),
      [...AGENT_KEYS],
    );
    const writer = listed.find(({ agent }) => agent === "writer")!;
    assert.deepEqual(writer, {
      agent: "writer",
      template: AGENT_PROMPTS.writer.template,
      variables: AGENT_PROMPTS.writer.variables,
      digest: createHash("sha256").update(AGENT_PROMPTS.writer.template).digest("hex"),
    });
  });
});
