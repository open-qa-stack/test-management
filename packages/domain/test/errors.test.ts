import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { structureError } from "../src/config/errors.ts";

describe("structure errors", () => {
  it("names an Ajv keyword the schema does not use yet after the keyword itself", () => {
    const e = structureError({ keyword: "maxLength", instancePath: "/a", schemaPath: "#/a/maxLength", params: { limit: 3 } });
    assert.deepEqual(e, { kind: "structure", path: "/a", rule: "maxLength", message: "Invalid value." });
  });
});
