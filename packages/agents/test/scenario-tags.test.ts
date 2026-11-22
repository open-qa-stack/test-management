import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { borneId, effectWords, scenarioTags, withTags } from "../src/designer/scenario-tags.ts";
import { testBody } from "../src/designer/test-body.ts";

const SCENARIO = {
  level: "business",
  domain: "customers",
  feature: "listing",
  application: "policy-management",
  kind: "functional",
  case: "negative",
  effect: "write",
} as const;
const ID = "3f0c2b9e-8d4a-4f1e-9b7a-2c5d6e7f8a90";
const TAGS = `{ tag: ["@level-business","@domain-customers","@feature-listing","@app-policy-management","@kind-functional","@case-negative","@data-write","@oqas-id-${ID}"] }`;

describe("the tags of a test", () => {
  it("are the level, the domain, its functionality, the application, the kind, the case and the effect on data of its scenario", () => {
    assert.deepEqual(scenarioTags(SCENARIO), [
      "@level-business",
      "@domain-customers",
      "@feature-listing",
      "@app-policy-management",
      "@kind-functional",
      "@case-negative",
      "@data-write",
    ]);
  });

  it("say in words, for a sheet and the file of a plan, what the scenario does to the data", () => {
    assert.deepEqual([effectWords("read"), effectWords("write")], ["reads data", "writes data"]);
  });

  it("name each application a test of several acts on", () => {
    assert.deepEqual(scenarioTags({ ...SCENARIO, level: "cross-application", applications: ["customer-management"] }).slice(3, 5), [
      "@app-policy-management",
      "@app-customer-management",
    ]);
  });

  it("are written after the title of the test with its identifier, in place of those it had, and leave its steps as they are", () => {
    const body = 'async ({ page }) => {\n  await test.step("1. Open", async () => {});\n});\n';
    const expected = `test("Open the \\"orders\\"", ${TAGS}, ${body}`;
    assert.equal(withTags(`test("Open the \\"orders\\"", ${body}`, SCENARIO, ID), expected);
    assert.equal(withTags(`test("Open the \\"orders\\"", { tag: ["@mine", "@level-smoke"] }, ${body}`, SCENARIO, ID), expected);
    assert.equal(withTags(`test('Open the "orders"', {\n  tag: ["@mine"],\n},\n${body}`, SCENARIO, ID), `test('Open the "orders"', ${TAGS}, ${body}`);
    assert.equal(withTags("const nothing = 1;\n", SCENARIO, ID), "const nothing = 1;\n");
  });

  it("tell the identifier a test bears, which a repair of it keeps", () => {
    assert.equal(borneId(`test("Open", ${TAGS}, async () => {});`), ID);
    assert.equal(borneId('test("Open", { tag: ["@oqas-id-short"] }, async () => {});'), undefined);
  });

  it("say nothing of what a test does: two tests that differ by them alone have one body", () => {
    const test = (tags: string) => `test("a", ${tags}async ({ page }) => { await page.goto("/"); });`;
    assert.equal(testBody(test(`${TAGS}, `)), testBody(test("")));
  });
});
