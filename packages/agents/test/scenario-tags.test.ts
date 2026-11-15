import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scenarioTags, withTags } from "../src/designer/scenario-tags.ts";
import { testBody } from "../src/designer/test-body.ts";

const SCENARIO = { level: "business", domain: "customers", application: "policy-management", kind: "functional", case: "negative" } as const;
const TAGS = '{ tag: ["@level-business","@domain-customers","@app-policy-management","@kind-functional","@case-negative"] }';

describe("the tags of a test", () => {
  it("are the level, the domain, the application, the kind and the case of its scenario", () => {
    assert.deepEqual(scenarioTags(SCENARIO), ["@level-business", "@domain-customers", "@app-policy-management", "@kind-functional", "@case-negative"]);
  });

  it("name each application a test of several acts on", () => {
    assert.deepEqual(scenarioTags({ ...SCENARIO, level: "cross-application", applications: ["customer-management"] }).slice(2, 4), [
      "@app-policy-management",
      "@app-customer-management",
    ]);
  });

  it("are written after the title of the test, in place of those it had, and leave its steps as they are", () => {
    const body = 'async ({ page }) => {\n  await test.step("1. Open", async () => {});\n});\n';
    const expected = `test("Open the \\"orders\\"", ${TAGS}, ${body}`;
    assert.equal(withTags(`test("Open the \\"orders\\"", ${body}`, SCENARIO), expected);
    assert.equal(withTags(`test("Open the \\"orders\\"", { tag: ["@mine", "@level-smoke"] }, ${body}`, SCENARIO), expected);
    assert.equal(withTags(`test('Open the "orders"', {\n  tag: ["@mine"],\n},\n${body}`, SCENARIO), `test('Open the "orders"', ${TAGS}, ${body}`);
    assert.equal(withTags("const nothing = 1;\n", SCENARIO), "const nothing = 1;\n");
  });

  it("say nothing of what a test does: two tests that differ by them alone have one body", () => {
    const test = (tags: string) => `test("a", ${tags}async ({ page }) => { await page.goto("/"); });`;
    assert.equal(testBody(test(`${TAGS}, `)), testBody(test("")));
  });
});
