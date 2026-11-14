import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorsOf, validateVariant } from "./helpers.ts";

describe("the review of a plan for duplicates is read from the configuration", () => {
  it("is asked when absent, and as given otherwise", () => {
    const absent = validateVariant(() => undefined);
    assert.ok(absent.ok);
    assert.deepEqual(absent.config.design, { reviewPlan: true });
    const given = validateVariant((config) => (config["design"] = { reviewPlan: false }));
    assert.ok(given.ok);
    assert.deepEqual(given.config.design, { reviewPlan: false });
  });

  it("refuses a value that is no boolean, and a key it does not know, with their JSON paths", () => {
    assert.ok(errorsOf(validateVariant((config) => (config["design"] = { reviewPlan: "yes" }))).some((error) => error.path === "/design/reviewPlan"));
    assert.ok(errorsOf(validateVariant((config) => (config["design"] = { reviewTests: true }))).some((error) => error.path.startsWith("/design")));
  });
});
