import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { stepWording, testIdOf, testIdTag, textRefusal, TestChangeRefusedError, UnknownTestError } from "../src/index.ts";

const ID = "3f0c2b9e-8d4a-4f1e-9b7a-2c5d6e7f8a90";

describe("the identifier of a test", () => {
  it("is written as a tag, and read from the first tag that holds a UUID", () => {
    assert.equal(testIdTag(ID), `@oqas-id-${ID}`);
    assert.equal(testIdOf(["@level-smoke", "@oqas-id-short", `@oqas-id-${ID}`, "@oqas-id-0b1c2d3e-4f50-4617-8899-aabbccddeeff"]), ID);
    assert.equal(testIdOf(["@level-smoke", `@oqas-id-${ID.toUpperCase()}`]), undefined);
  });
});

describe("a text a person writes for a test", () => {
  it("is a step apart from the number the harness writes before it", () => {
    assert.deepEqual(stepWording("2. Search the order"), { number: "2. ", text: "Search the order" });
    assert.deepEqual(stepWording("Search the order"), { number: "", text: "Search the order" });
  });

  it("is refused empty, of several lines, or longer than 300 characters", () => {
    assert.deepEqual(["", "a\nb", "x".repeat(301), "x".repeat(300)].map(textRefusal), [
      "The text is empty.",
      "The text holds a line break: a title or a step is one line.",
      "The text is longer than 300 characters.",
      undefined,
    ]);
  });

  it("names, when it is refused, the test or the file it is about", () => {
    assert.equal(new UnknownTestError("a.spec.ts").message, "The test repository holds no file of tests a.spec.ts.");
    assert.equal(new UnknownTestError("a.spec.ts", "Open").message, 'The file a.spec.ts holds no test "Open".');
    assert.equal(new TestChangeRefusedError("No.").name, "TestChangeRefusedError");
  });
});
