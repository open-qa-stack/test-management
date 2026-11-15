import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { baseUrlVariable } from "../src/index.ts";

describe("the variable that gives the base address of an application", () => {
  it("is named after the application, in upper case, what is no letter nor digit written as an underscore", () => {
    assert.deepEqual([baseUrlVariable("policy-management"), baseUrlVariable("shop")], ["OQAS_BASE_URL_POLICY_MANAGEMENT", "OQAS_BASE_URL_SHOP"]);
  });
});
