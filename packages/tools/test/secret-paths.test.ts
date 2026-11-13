import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { secretForms, secretPaths } from "../src/index.ts";

describe("the strings of a value that hold a secret", () => {
  it("points at each one, however deep, escaping the keys of the pointer", () => {
    const forms = secretForms("pa ss");
    const value = { domains: [{ label: "Fine", items: [{ summary: "pa ss here", "a/b~c": "pa%20ss" }] }], count: 3, none: null, flag: true };
    assert.deepEqual(secretPaths(value, forms), ["/domains/0/items/0/summary", "/domains/0/items/0/a~1b~0c"]);
    assert.deepEqual(secretPaths("clean", forms), []);
    assert.deepEqual(secretPaths("pa ss", forms), [""]);
  });
});
