import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { schemaProblems } from "../src/tools/schema-problems.ts";

/** What the validator of a schema finds in a value, told as the guard of a tool tells it. */
function problems(schema: object, value: unknown): string[] {
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  assert.equal(validate(value), false);
  return schemaProblems(validate.errors!, schema);
}

const text = { type: "string", minLength: 1 };
const TARGET = {
  oneOf: [
    { type: "object", properties: { role: text, name: text }, required: ["role"], additionalProperties: false },
    { type: "object", properties: { label: text }, required: ["label"], additionalProperties: false },
    { type: "object", properties: { text }, required: ["text"], additionalProperties: false },
  ],
};

describe("what is wrong with the arguments of a call, as a model can act on it", () => {
  it("tells once a value that has none of several shapes, with what the shape it is nearest to lacks or does not allow", () => {
    const schema = { type: "object", properties: { target: TARGET }, required: ["target"] };
    assert.deepEqual(problems(schema, { target: { role: "button", name: "Search", strict: true } }), [
      "arguments/target has none of the shapes its tool takes: leave out strict",
    ]);
    assert.deepEqual(problems(schema, { target: { name: "Search" } }), ["arguments/target has none of the shapes its tool takes: give role"]);
    assert.deepEqual(problems({ oneOf: [{ type: "number" }, { minimum: 0 }] }, 5), ["arguments must match exactly one schema in oneOf"]);
    // A value no shape of which says what is missing or extra is told all the same.
    assert.deepEqual(problems({ type: "object", properties: { size: { anyOf: [{ type: "integer" }, { type: "boolean" }] } } }, { size: "large" }), [
      "arguments/size has none of the shapes its tool takes",
    ]);
  });

  it("tells a list by its bound, a property by its name, and anything else as the validator says it, each once", () => {
    const schema = {
      type: "object",
      properties: {
        shows: { type: "array", maxItems: 2 },
        elements: { type: "array", minItems: 1, items: { type: "object", required: ["role"] } },
        id: { type: "string", pattern: "^[a-z]+$" },
        body: { type: "string" },
      },
      required: ["body"],
      additionalProperties: false,
    };
    assert.deepEqual(problems(schema, { shows: [1, 2, 3], elements: [], id: "A1", note: "x" }), [
      "arguments needs the property body",
      "arguments holds note, which its tool does not take: leave it out",
      "arguments/shows holds more than 2 items: give 2 at most",
      "arguments/elements holds fewer than 1 items: give 1 at least",
      'arguments/id must match pattern "^[a-z]+$"',
    ]);
    assert.deepEqual(problems(schema, { body: "b", elements: [{}, {}] }), [
      "arguments/elements/0 needs the property role",
      "arguments/elements/1 needs the property role",
    ]);
  });

  it("tells a property written beside the one that takes it to move inside it, and a value that can only be one with that value", () => {
    const within = { type: "object", properties: { role: text }, required: ["role"], additionalProperties: false };
    const target = {
      oneOf: [
        { type: "object", properties: { role: text, exact: { const: true }, within }, required: ["role"], additionalProperties: false },
        { type: "object", properties: { text, within }, required: ["text"], additionalProperties: false },
      ],
    };
    const schema = { type: "object", properties: { target, confirm: { type: "boolean" } }, required: ["target"], additionalProperties: false };
    assert.deepEqual(problems(schema, { target: { role: "button" }, within: { role: "row" }, checked: true }), [
      "arguments holds within, which goes inside target: move it there",
      "arguments holds checked, which its tool does not take: leave it out",
    ]);
    // A tool without arguments has no property to move one into.
    assert.deepEqual(problems({ type: "object", additionalProperties: false }, { within: {} }), [
      "arguments holds within, which its tool does not take: leave it out",
    ]);
    // Deeper in the arguments as well.
    const nested = { type: "object", properties: { step: schema } };
    assert.deepEqual(problems(nested, { step: { target: { text: "Save" }, within: { role: "row" } } }), [
      "arguments/step holds within, which goes inside target: move it there",
    ]);
    assert.deepEqual(problems(schema, { target: { role: "button", exact: false } }), [
      "arguments/target has none of the shapes its tool takes: exact can only be true",
    ]);
    assert.deepEqual(problems({ type: "object", properties: { exact: { const: true } } }, { exact: false }), [
      "arguments/exact can only be true: give that, or leave it out",
    ]);
  });

  it("tells six problems at most, and counts the others", () => {
    const schema = { type: "object", properties: { elements: { type: "array", items: { type: "object", required: ["role"] } } } };
    const told = problems(schema, { elements: Array.from({ length: 9 }, () => ({})) });
    assert.deepEqual([told.length, told[5], told[6]], [7, "arguments/elements/5 needs the property role", "and 3 more of the same kind"]);
  });
});
