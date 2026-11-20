import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { testDigests } from "../src/source-code/test-digests.ts";

/** A file of two tests of the orders, the second in a group. */
const FILE = `import { expect, test } from "@playwright/test";

test("Search an order", { tag: ["@level-functional"] }, async ({ page }) => {
  await page.goto("/orders");
});

test.describe("Orders", () => {
  test("Filter by date", async ({ page }) => {
    await expect(page.getByRole("row")).toHaveCount(3);
  });
});
`;

/** The digest of a test of a file, by its titles. */
async function digestOf(text: string, title: string): Promise<string | undefined> {
  return (await testDigests(text)).get(title);
}

describe("the digest of each test of a file", () => {
  it("names each test by the titles of the groups that hold it then its own", async () => {
    const digests = await testDigests(FILE);
    assert.deepEqual([...digests.keys()], ["Search an order", "Orders › Filter by date"]);
    assert.ok([...digests.values()].every((digest) => /^[0-9a-f]{64}$/.test(digest)));
  });

  it("stays the same through comments, spaces, line breaks, quotes, semicolons, trailing commas and the other tests of the file", async () => {
    const reworked = `import { expect, test } from '@playwright/test'
// The search of the orders.
test('Search an order', { tag: ['@level-functional',], }, async ({ page }) => {
  /* The list of the orders. */
  await page.goto('/orders') // there
})
test.describe('Orders', () => { test('Filter by date', async ({ page }) => { await expect(page.getByRole('row')).toHaveCount(4) }) })
`;
    assert.equal(await digestOf(reworked, "Search an order"), await digestOf(FILE, "Search an order"));
    assert.notEqual(await digestOf(reworked, "Orders › Filter by date"), await digestOf(FILE, "Orders › Filter by date"));
  });

  it("changes with the title, the details or the body of the test", async () => {
    const search = await digestOf(FILE, "Search an order");
    for (const variant of [
      FILE.replace('"@level-functional"', '"@level-smoke"'),
      FILE.replace('"/orders"', '"/orders?page=2"'),
      FILE.replace('await page.goto("/orders");', 'await page.goto("/orders");\n  await page.reload();'),
      FILE.replace("async ({ page })", "async ({ page, request })"),
    ])
      assert.notEqual(await digestOf(variant, "Search an order"), search);
    assert.equal(await digestOf(FILE.replace('test("Search an order"', 'test("Search the orders"'), "Search an order"), undefined);
  });

  it("reads the tests the runner reads: modified, in templates, in anonymous and modified groups, the first of a name only", async () => {
    const file = `
test.only(\`Search an order\`, async () => {});
test.skip("Skipped", async () => {});
test.describe.serial("Orders", () => {
  test.describe(() => {
    test.fixme("Filter", async () => {});
  });
});
test("Search an order", async () => { await other(); });
`;
    assert.deepEqual([...(await testDigests(file)).keys()], ["Search an order", "Skipped", "Orders ›  › Filter"]);
    assert.equal(await digestOf(file, "Search an order"), await digestOf("test.only(`Search an order`, async () => {});", "Search an order"));
  });

  it("leaves out what declares no test it can name: hooks, steps, configurations, titles built from values, other calls", async () => {
    const file = `
test.beforeEach(async () => {});
test.describe.configure({ mode: "serial" });
test.describe(title, () => { test("Inside", async () => {}); });
test.use({ locale: "fr-FR" });
test.step.skip("Step", async () => {});
test(\`Search \${name}\`, async () => {});
test(name, async () => {});
expect(test).toBeDefined();
other.test("Other", async () => {});
items[0]("Indexed", async () => {});
test\`Tagged\`;
`;
    assert.deepEqual([...(await testDigests(file)).keys()], []);
  });

  it("reads none in a text with a syntax error", async () => {
    assert.deepEqual(await testDigests('test("Search an order", async () => {'), new Map());
  });
});
