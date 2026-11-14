import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readsImages } from "../src/index.ts";
import { at, errorsOf, validateVariant } from "./helpers.ts";

describe("the capabilities of the model", () => {
  it("accept vision, which says the model reads images", () => {
    const result = validateVariant((c) => (at(c, "model")["capabilities"] = ["vision"]));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.ok && readsImages(result.config.model), true);
  });

  it("are none when absent or empty: the model reads text only", () => {
    for (const capabilities of [undefined, []]) {
      const result = validateVariant((c) => (at(c, "model")["capabilities"] = capabilities));
      assert.equal(result.ok && readsImages(result.config.model), false, JSON.stringify(capabilities));
    }
  });

  it("refuse an unknown capability, and a value that is not a list, at their path", () => {
    assert.deepEqual(
      errorsOf(validateVariant((c) => (at(c, "model")["capabilities"] = ["vision", "hearing"]))).map((e) => [e.path, e.rule]),
      [["/model/capabilities/1", "unknown-variant"]],
    );
    assert.deepEqual(
      errorsOf(validateVariant((c) => (at(c, "model")["capabilities"] = "vision"))).map((e) => [e.path, e.rule]),
      [["/model/capabilities", "wrong-type"]],
    );
  });
});

describe("the reasoning effort of the model", () => {
  it("is kept as the configuration gives it, and left out otherwise", () => {
    const set = validateVariant((c) => (at(c, "model")["reasoningEffort"] = "none"));
    assert.equal(set.ok && set.config.model.reasoningEffort, "none");
    const unset = validateVariant(() => undefined);
    assert.equal(unset.ok && unset.config.model.reasoningEffort, undefined);
  });

  it("is a text that is not empty", () => {
    for (const effort of ["", 3])
      assert.deepEqual(
        errorsOf(validateVariant((c) => (at(c, "model")["reasoningEffort"] = effort))).map((e) => e.path),
        ["/model/reasoningEffort"],
        JSON.stringify(effort),
      );
  });
});
