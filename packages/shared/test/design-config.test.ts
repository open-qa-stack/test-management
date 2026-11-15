import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorsOf, validateVariant } from "./helpers.ts";

describe("the review of a plan for duplicates is read from the configuration", () => {
  it("is asked when absent, and as given otherwise", () => {
    const absent = validateVariant(() => undefined);
    assert.ok(absent.ok);
    assert.deepEqual(absent.config.design, { reviewPlan: true, reviewTests: true, reviewCode: true, levels: ["smoke", "functional", "business"] });
    const given = validateVariant((config) => (config["design"] = { reviewPlan: false }));
    assert.ok(given.ok);
    assert.deepEqual(given.config.design, { reviewPlan: false, reviewTests: true, reviewCode: true, levels: ["smoke", "functional", "business"] });
  });

  it("refuses a value that is no boolean, and a key it does not know, with their JSON paths", () => {
    assert.ok(errorsOf(validateVariant((config) => (config["design"] = { reviewPlan: "yes" }))).some((error) => error.path === "/design/reviewPlan"));
    assert.ok(errorsOf(validateVariant((config) => (config["design"] = { reviewEverything: true }))).some((error) => error.path.startsWith("/design")));
  });
});

describe("the levels of the pyramid of tests asked are read from the configuration", () => {
  it("are those given, and refuses a level it does not know, none at all, and one given twice", () => {
    const given = validateVariant((config) => (config["design"] = { levels: ["functional", "end-to-end"] }));
    assert.ok(given.ok);
    assert.deepEqual(given.config.design.levels, ["functional", "end-to-end"]);
    for (const levels of [["unit"], [], ["smoke", "smoke"]])
      assert.ok(
        errorsOf(validateVariant((config) => (config["design"] = { levels }))).some((error) => error.path.startsWith("/design/levels")),
        JSON.stringify(levels),
      );
  });
});
