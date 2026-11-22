import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ToolDefinition } from "@open-qa-stack/domain";
import { withReach, type ReachWarning } from "../src/source-reach.ts";

/** A tool of a source, which answers what it was asked. */
const TOOL: ToolDefinition = {
  name: "orders_read",
  description: "Reads.",
  parameters: { type: "object" },
  execute: (args) => Promise.resolve({ asked: args }),
};

describe("what the tools of a source say of what it describes", () => {
  it("is nothing for a source of the whole project", () => {
    const [tool] = withReach([TOOL], { id: "glossary" }, ["shop"]);
    assert.equal(tool, TOOL);
  });

  it("names the applications of a source in the description of each tool, which answers as it is, for a session that tests one of them or is not kept to some", async () => {
    const source = { id: "orders", attachments: [{ application: "shop" }, { application: "back-office" }] };
    for (const applications of [["back-office"], undefined]) {
      const [tool] = withReach([TOOL], source, applications);
      assert.equal(tool!.description, "Reads. The source orders describes the applications shop, back-office.");
      assert.deepEqual(await tool!.execute({ path: "x" }), { asked: { path: "x" } });
    }
  });

  it("warns, with each answer and in the description, a session that tests none of the applications of the source", async () => {
    const [tool] = withReach([TOOL], { id: "orders", attachments: [{ application: "shop" }] }, ["back-office", "pricing"]);
    const warning =
      "Warning: The source orders describes the application shop. The session tests back-office, pricing: what it tells may not hold there. Check that what you look for is the same before you rely on it.";
    assert.equal(tool!.description, `Reads. ${warning}`);
    assert.deepEqual(await tool!.execute({ path: "x" }), { warning, result: { asked: { path: "x" } } } satisfies ReachWarning);
  });
});
