import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { MAX_REPLACED_PROMPT, missingVariables, replacedPrompt } from "../src/index.ts";
import { errorsOf, validateVariant } from "./helpers.ts";

const BASED_ON = "a".repeat(64);

describe("a prompt the team writes in place of that of an agent", () => {
  it("is the one the configuration holds, and none for a blank text or an agent that keeps its own", () => {
    const prompt = { text: "You write {{run_tool}}.", basedOn: BASED_ON };
    assert.equal(replacedPrompt({ writer: { prompt } }, "writer"), prompt);
    for (const agents of [undefined, {}, { writer: {} }, { writer: { prompt: { text: " ", basedOn: BASED_ON } } }])
      assert.equal(replacedPrompt(agents, "writer"), undefined);
  });

  it("leaves out the variables it does not write, in the order of the prompt it replaces", () => {
    assert.deepEqual(missingVariables("Call {{run_tool}}, not {{ propose_tool }}.", ["propose_tool", "run_tool", "copied"]), ["propose_tool", "copied"]);
    assert.deepEqual(missingVariables("{{run_tool}}", ["run_tool"]), []);
  });

  it("is in the configuration within a length, with the digest of the prompt it replaced", () => {
    const told = (prompt: object) => validateVariant((c) => (c["agents"] = { writer: { prompt } }));
    const result = told({ text: "x".repeat(MAX_REPLACED_PROMPT), basedOn: BASED_ON });
    assert.ok(result.ok && result.config.agents.writer?.prompt?.basedOn === BASED_ON);
    assert.deepEqual(
      errorsOf(told({ text: "x".repeat(MAX_REPLACED_PROMPT + 1), basedOn: "sha256" })).map(({ path }) => path),
      ["/agents/writer/prompt/text", "/agents/writer/prompt/basedOn"],
    );
    assert.equal(errorsOf(told({ text: "x" })).length, 1);
  });
});
