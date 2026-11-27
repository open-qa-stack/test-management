import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { lessonsRule, type Lesson } from "@open-qa-stack/domain";
import type { ScriptedServer } from "@open-qa-stack/testing";
import { chain, ran } from "./run-support.ts";

/** The instructions of each session of a run, as the model was first asked in it. */
const instructionsOf = (server: ScriptedServer) =>
  server.requests
    .map((request) => request.body as { messages?: { role: string; content: string }[] } | undefined)
    .filter((body) => body?.messages?.length === 2)
    .map((body) => body!.messages![0]!.content);

const lesson = (id: string, target: Lesson["target"], more: Partial<Lesson> = {}): Lesson => ({
  id,
  kind: "instruction",
  text: `Rule ${id}.`,
  target,
  active: true,
  at: "2026-11-27T10:00:00.000Z",
  ...more,
});

describe("a run given the lessons of the people of the project", () => {
  it("gives each session the active lessons of its work, the cartography those of the discovery and the design those of the design", async () => {
    const lessons = [
      lesson("design", "design", { application: "shop" }),
      lesson("discovery", "discovery"),
      lesson("all", "all"),
      lesson("off", "all", { active: false }),
    ];
    const run = await ran(chain(), { environment: "local", lessons });
    assert.equal(run.code, 0, run.err);
    const instructions = instructionsOf(run.server);
    const discovery = `\n\n${lessonsRule([lessons[1]!, lessons[2]!])}`;
    const design = `\n\n${lessonsRule([lessons[0]!, lessons[2]!])}`;
    // The agent of the document and the orchestrator of the cartography, then the agents that plan and write.
    assert.deepEqual(
      instructions.map((text) => (text.includes(discovery) ? "discovery" : text.includes(design) ? "design" : "none")),
      ["discovery", "discovery", ...instructions.slice(2).map(() => "design")],
    );
    assert.ok(instructions.every((text) => !text.includes("Rule off.")));
  });

  it("adds nothing to the instructions without a lesson", async () => {
    const run = await ran(chain(), { environment: "local" });
    assert.equal(run.code, 0, run.err);
    assert.ok(instructionsOf(run.server).every((text) => !text.includes("The people of the project gave these instructions")));
  });
});
