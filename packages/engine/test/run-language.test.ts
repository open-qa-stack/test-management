import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { languageRule } from "@open-qa-stack/agents";
import type { ScriptedServer } from "@open-qa-stack/testing";
import { chain, configText, ran } from "./run-support.ts";

/** The instructions of each session of a run, as the model was first asked in it. */
const instructionsOf = (server: ScriptedServer) =>
  server.requests
    .map((request) => request.body as { messages?: { role: string; content: string }[] } | undefined)
    .filter((body) => body?.messages?.length === 2)
    .map((body) => body!.messages![0]!.content);

describe("a run whose configuration names the language of the person", () => {
  it("tells every session of the run, the cartography and the design alike, to speak to the person in it", async () => {
    const run = await ran(chain(), { environment: "local", config: (url) => configText(url, { language: "fr" }) });
    assert.equal(run.code, 0, run.err);
    const instructions = instructionsOf(run.server);
    // The agent of the document, the orchestrator of the cartography, the agent that plans and the three that write, then the agent
    // that plans each of the three rounds that bring nothing new.
    assert.equal(instructions.length, 9);
    for (const text of instructions) assert.ok(text.includes(`\n\n${languageRule("fr")}`), text.slice(-300));
    assert.ok(instructions.every((text) => !text.includes(languageRule("en"))));
  });
});

describe("a run whose configuration names no language", () => {
  it("tells every session to speak to the person in English", async () => {
    const run = await ran(chain(), { environment: "local" });
    assert.equal(run.code, 0, run.err);
    const instructions = instructionsOf(run.server);
    assert.ok(instructions.length > 0);
    for (const text of instructions) assert.ok(text.includes(languageRule("en")));
  });
});
