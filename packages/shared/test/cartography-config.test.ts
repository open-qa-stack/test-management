import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorsOf, validateVariant } from "./helpers.ts";

describe("solo command, criterion 18 — the number of cartography tasks at once is read from the configuration", () => {
  it("is one when absent, and the value given otherwise", () => {
    const absent = validateVariant(() => undefined);
    assert.ok(absent.ok);
    assert.deepEqual(absent.config.cartography, { concurrency: 1 });
    const given = validateVariant((config) => (config["cartography"] = { concurrency: 3 }));
    assert.ok(given.ok);
    assert.deepEqual(given.config.cartography, { concurrency: 3 });
  });

  it("refuses a value that is not a whole number of 1 or more, with its JSON path", () => {
    for (const concurrency of [0, -1, 1.5, "2"]) {
      const errors = errorsOf(validateVariant((config) => (config["cartography"] = { concurrency })));
      assert.ok(
        errors.some((error) => error.path === "/cartography/concurrency"),
        JSON.stringify([concurrency, errors]),
      );
    }
    assert.ok(errorsOf(validateVariant((config) => (config["cartography"] = { workers: 2 }))).some((error) => error.path.startsWith("/cartography")));
  });
});
