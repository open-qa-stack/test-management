import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { TestChangeRefusedError, UnknownTestError } from "@open-qa-stack/domain";
import { changedTest } from "../src/source-code/test-change.ts";
import { declaredTests } from "../src/source-code/test-digests.ts";

const PATH = "apps/shop/tests/orders/search.spec.ts";
const ID = "3f0c2b9e-8d4a-4f1e-9b7a-2c5d6e7f8a90";
const OTHER = "0b1c2d3e-4f50-4617-8899-aabbccddeeff";
/** Gives the same new identifier every time. */
const newId = () => OTHER;

/** A file of tests as a design writes them, with a comment and a layout of its own that a change keeps. */
const FILE = `import { expect, test } from "@playwright/test";

// Searches by number.
test("Search an order", { tag: ["@level-functional", "@oqas-id-${ID}"] }, async ({ page }) => {
  await test.step("1. Open the orders", async () => {
    await page.goto("/orders");
  });
  await test.step('2. Search "ORD-1"', async () => {
    await expect(page.getByRole("row")).toHaveCount(1);
  });
});

test.describe("Orders", () => {
  test('Filter by date', async ({ page }) => {
    await test.step(\`Pick a date\`, async () => {});
  });
});
`;

/** Changes a test of a file and tells what the file then declares of it. */
async function changed(text: string, title: string, edit: Parameters<typeof changedTest>[3]) {
  const result = await changedTest(PATH, text, title, edit, newId);
  const test = (await declaredTests(result.content)).tests.find((candidate) => candidate.title === result.title);
  return { ...result, steps: test?.steps, tags: test?.tags };
}

describe("a change to a test of a file", () => {
  it("renames the test in its own quotes, keeps the rest of the file to the character, and the identifier it bears", async () => {
    const result = await changed(FILE, "Search an order", { title: '  Find an order by its "number"  ' });
    assert.equal(result.content, FILE.replace('test("Search an order"', 'test("Find an order by its \\"number\\""'));
    assert.deepEqual([result.title, result.id], ['Find an order by its "number"', ID]);
  });

  it("renames a test of a group by its own title, which the titles of its groups precede", async () => {
    const result = await changed(FILE, "Orders › Filter by date", { title: "Filter by day" });
    assert.equal(result.title, "Orders › Filter by day");
    assert.ok(result.content.includes(`test('Filter by day', { tag: '@oqas-id-${OTHER}' }, async`));
  });

  it("changes the text of a step and keeps the number the harness wrote before it", async () => {
    const result = await changed(FILE, "Search an order", { step: 2, text: "Search 'ORD-2'" });
    assert.deepEqual(result.steps, ["1. Open the orders", "2. Search 'ORD-2'"]);
    assert.ok(result.content.includes("test.step('2. Search \\'ORD-2\\'', async"));
    const template = await changed(FILE, "Orders › Filter by date", { step: 1, text: "Pick `today` for ${day}" });
    assert.deepEqual(template.steps, ["Pick `today` for ${day}"]);
  });

  it("gives an identifier to a test that bears none, in whatever way its details are written", async () => {
    const cases: [string, string][] = [
      ['test("A", async () => {});', `test("A", { tag: "@oqas-id-${OTHER}" }, async () => {});`],
      ['test("A", {}, async () => {});', `test("A", { tag: "@oqas-id-${OTHER}" }, async () => {});`],
      ['test("A", { annotation: [] }, async () => {});', `test("A", { tag: "@oqas-id-${OTHER}", annotation: [] }, async () => {});`],
      ['test("A", { tag: "@smoke" }, async () => {});', `test("A", { tag: ["@smoke", "@oqas-id-${OTHER}"] }, async () => {});`],
      ['test("A", { tag: [] }, async () => {});', `test("A", { tag: ["@oqas-id-${OTHER}"] }, async () => {});`],
      ['test("A", { tag: ["@smoke",] }, async () => {});', `test("A", { tag: ["@smoke", "@oqas-id-${OTHER}",] }, async () => {});`],
      ["test(`A`, async () => {});", `test(\`B\`, { tag: "@oqas-id-${OTHER}" }, async () => {});`],
    ];
    for (const [before, after] of cases) {
      const edit = before.startsWith("test(`") ? { title: "B" } : { title: "A" };
      const result = await changed(before, "A", edit);
      assert.deepEqual([result.content, result.id], [after, OTHER], before);
    }
  });

  it("is refused for a test the file does not declare, a file with a syntax error, or tags it cannot add to", async () => {
    await assert.rejects(changedTest(PATH, FILE, "Close an order", { title: "B" }, newId), UnknownTestError);
    await assert.rejects(changedTest(PATH, "test(", "A", { title: "B" }, newId), /syntax error/);
    const tags = "const TAGS = [];\ntest('A', { tag: TAGS }, async () => {});";
    for (const written of [tags, "const tag = [];\ntest('A', { tag }, async () => {});", "test('A', { ...shared }, async () => {});"])
      await assert.rejects(changedTest(PATH, written, "A", { title: "B" }, newId), /not written as a text or a list/, written);
  });

  it("is refused for a text that cannot be written, a title another test has, or a step the test does not have", async () => {
    const refusals: [Parameters<typeof changedTest>[3], RegExp][] = [
      [{ title: "   " }, /empty/],
      [{ title: "A\nB" }, /line break/],
      [{ title: "x".repeat(301) }, /longer than 300/],
      [{ step: 3, text: "Close" }, /no step 3/],
    ];
    for (const [edit, reason] of refusals)
      await assert.rejects(
        changedTest(PATH, FILE, "Search an order", edit, newId),
        (error: Error) => error instanceof TestChangeRefusedError && reason.test(error.message),
      );
    const two = 'test("A", async () => {});\ntest("B", async () => {});';
    await assert.rejects(changedTest(PATH, two, "A", { title: "B" }, newId), /Another test of .* is titled "B"/);
    // A title kept as it is is no title of another test.
    assert.equal((await changed(two, "A", { title: "A" })).title, "A");
  });
});
