import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { attachmentsOf, knowledgeBaseSourceApplications, isProjectWide, isReadIn, sourceApplications, validateConfig, type Knowledge } from "../src/index.ts";
import { EXAMPLE_ENV, example, listAt } from "./helpers.ts";

/** A source of the whole project, and one attached to two applications, the second narrowed to an environment. */
const WIDE: Pick<Knowledge, "attachments"> = {};
const ATTACHED = {
  id: "orders",
  attachments: [{ application: "shop" }, { application: "back-office", environment: "staging" }, { application: "shop", api: "backend" }],
};

describe("the reach of a knowledge source", () => {
  it("is the whole project for a source attached to no application, which every environment reads", () => {
    assert.deepEqual(attachmentsOf(WIDE), []);
    assert.equal(isProjectWide(WIDE), true);
    assert.equal(isProjectWide({ attachments: [] }), true);
    assert.equal(isReadIn(WIDE, "local"), true);
    assert.deepEqual(sourceApplications(WIDE), []);
  });

  it("is its applications for a source attached to some, each named once, read in an environment one of its attachments leaves open or names", () => {
    assert.equal(isProjectWide(ATTACHED), false);
    assert.deepEqual(sourceApplications(ATTACHED), ["shop", "back-office"]);
    assert.equal(isReadIn(ATTACHED, "local"), true);
    assert.equal(isReadIn({ attachments: [{ application: "shop", environment: "staging" }] }, "staging"), true);
    assert.equal(isReadIn({ attachments: [{ application: "shop", environment: "staging" }] }, "local"), false);
  });

  it("is declared in the configuration by leaving the attachments out, or empty", () => {
    for (const attachments of [undefined, []]) {
      const config = example();
      const source = listAt(config, "knowledge")[0] as Record<string, unknown>;
      if (attachments === undefined) delete source["attachments"];
      else source["attachments"] = attachments;
      assert.equal(validateConfig(JSON.stringify(config), EXAMPLE_ENV).ok, true, JSON.stringify(attachments));
    }
  });

  it("names, for a source of the knowledge base, the application of a user interface or the applications of a declared source", () => {
    const knowledge = [{ id: "notes", ...WIDE }, ATTACHED];
    assert.deepEqual(knowledgeBaseSourceApplications({ id: "shop", type: "web" }, knowledge), ["shop"]);
    assert.deepEqual(knowledgeBaseSourceApplications({ id: "orders", type: "postgresql" }, knowledge), ["shop", "back-office"]);
    assert.deepEqual(knowledgeBaseSourceApplications({ id: "notes", type: "document" }, knowledge), []);
    assert.deepEqual(knowledgeBaseSourceApplications({ id: "gone", type: "openapi" }, knowledge), [], "a source the configuration no longer declares");
  });
});
