import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { isRecord, parseJson, textOf } from "../src/index.ts";

describe("a value read from JSON", () => {
  it("is nothing when the text is not JSON", () => {
    assert.deepEqual([parseJson('{"a":1}'), parseJson("{"), parseJson("")], [{ a: 1 }, undefined, undefined]);
  });

  it("is a record when it is an object that is neither null nor an array", () => {
    assert.deepEqual([{}, { a: 1 }, null, [], "text", 3, undefined].map(isRecord), [true, true, false, false, false, false, false]);
  });

  it("is given as a text: itself, nothing when it is missing, its JSON otherwise", () => {
    assert.deepEqual(["text", undefined, null, 3, { a: 1 }].map(textOf), ["text", "", "null", "3", '{"a":1}']);
  });
});
