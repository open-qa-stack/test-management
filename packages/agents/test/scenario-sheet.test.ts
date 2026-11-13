import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import type { PlannedScenario } from "@open-qa-stack/domain";
import { CharterCheck, resolveCharter } from "@open-qa-stack/harness";
import { moduleSyntax } from "@open-qa-stack/tools";
import { DesignCursor } from "../src/designer/design-cursor.ts";
import { scenarioSheet, skeleton } from "../src/designer/scenario-sheet.ts";

/** Types of `@playwright/test` that a skeleton uses. */
const PLAYWRIGHT_TYPES = `
export interface Locator { click(): Promise<void>; }
export interface Page { screenshot(): Promise<Uint8Array>; getByText(text: string): Locator; }
export interface TestInfo { attach(name: string, options: { body: Uint8Array; contentType: string }): Promise<void>; }
type Body = (fixtures: { page: Page }, testInfo: TestInfo) => Promise<void>;
export declare const test: ((title: string, body: Body) => void) & { step<T>(title: string, body: () => Promise<T>): Promise<T> };
export declare const expect: (actual: unknown) => { toBeVisible(): Promise<void>; toBeHidden(): Promise<void> };
`;

const repository = mkdtempSync(join(tmpdir(), "skeleton-"));
after(() => rmSync(repository, { recursive: true, force: true }));
for (const [path, content] of Object.entries({
  "node_modules/@playwright/test/package.json": JSON.stringify({ name: "@playwright/test", version: "0.0.0", types: "index.d.ts" }),
  "node_modules/@playwright/test/index.d.ts": PLAYWRIGHT_TYPES,
})) {
  mkdirSync(dirname(join(repository, path)), { recursive: true });
  writeFileSync(join(repository, path), content);
}

const SEARCH: PlannedScenario = {
  id: "search-order-by-customer",
  title: 'Search an order by "customer" name',
  intent: "Verifies that a search by last name finds the order of the customer.",
  kind: "functional",
  case: "nominal",
  application: "shop",
  domain: "orders",
  sources: [{ source: "orders-db", item: "public.orders" }],
  data: [{ value: "Veldane", from: "orders-db" }],
  steps: [
    { action: "Open the orders", expects: [] },
    {
      action: "Search the orders\nof Veldane.",
      expects: [
        { result: "The table lists the order of Mira Veldane only", shows: ["ORD-1042", "Mira Veldane"], absent: ["ORD-1057"] },
        { result: "The count says one", shows: ["1 order"], absent: [] },
      ],
    },
  ],
};

describe("the skeleton of a test", () => {
  it("holds one test.step per step, titled by its number, with what to do, an assertion of each text of its expects, and a screenshot when asked", () => {
    assert.equal(
      skeleton(SEARCH, true),
      `import { expect, test } from "@playwright/test";

test("Search an order by \\"customer\\" name", async ({ page }, testInfo) => {
  await test.step("1. Open the orders", async () => {
    // Do: Open the orders. Copy the code lines the browser tools returned.
    await testInfo.attach("1", { body: await page.screenshot(), contentType: "image/png" });
  });
  await test.step("2. Search the orders of Veldane", async () => {
    // Do: Search the orders of Veldane. Copy the code lines the browser tools returned.
    // Expect 2.1: The table lists the order of Mira Veldane only.
    await expect(page.getByText("ORD-1042")).toBeVisible();
    await expect(page.getByText("Mira Veldane")).toBeVisible();
    await expect(page.getByText("ORD-1057")).toBeHidden();
    // Expect 2.2: The count says one.
    await expect(page.getByText("1 order")).toBeVisible();
    await testInfo.attach("2", { body: await page.screenshot(), contentType: "image/png" });
  });
});
`,
    );
    assert.doesNotMatch(skeleton(SEARCH, false), /testInfo/);
  });

  it("parses, and keeps the default charter as it is", async () => {
    const charter = resolveCharter({ disable: [], add: [] });
    assert.ok(charter.ok);
    const content = skeleton(SEARCH, true);
    assert.ok((await moduleSyntax(content)).ok);
    assert.deepEqual(await new CharterCheck({ repository, rules: charter.rules }).check({ path: "apps/shop/search-order-by-customer.spec.ts", content }), []);
  });
});

describe("the sheet of a scenario", () => {
  it("names the scenario, its data and its file before the skeleton, and ends with the next call", () => {
    const cursor = new DesignCursor({ scenarios: [SEARCH, { ...SEARCH, id: "other", data: [] }] }, (scenario) => `apps/shop/${scenario.id}.spec.ts`);
    const sheet = scenarioSheet(cursor, false).split("\n");
    assert.deepEqual(sheet.slice(0, 4), [
      'Scenario 1 of 2: search-order-by-customer — Search an order by "customer" name (functional, nominal), application shop.',
      'Data: "Veldane" (orders-db).',
      "File: apps/shop/search-order-by-customer.spec.ts",
      "",
    ]);
    assert.equal(
      sheet.at(-1),
      "Next: do the steps of search-order-by-customer with the browser tools, fill its skeleton with the code they return, then call run_test.",
    );
  });
});

describe("the cursor of a design", () => {
  it("opens the scenarios in the order of the plan, counts the runs of the one open only, and names the next call", () => {
    const placed: string[] = [];
    const cursor = new DesignCursor({ scenarios: [SEARCH, { ...SEARCH, id: "other" }] }, (scenario) => {
      placed.push(scenario.id);
      return `apps/shop/${scenario.id}.spec.ts`;
    });
    assert.deepEqual(
      [cursor.scenario?.id, cursor.rank, cursor.path, placed],
      ["search-order-by-customer", 1, "apps/shop/search-order-by-customer.spec.ts", ["search-order-by-customer"]],
    );
    const ran = (verdict?: "passed" | "failed") => ({
      content: "x",
      ...(verdict === undefined ? {} : { verdict }),
      startedAt: "2026-11-13T10:00:00.000Z",
      looks: 0,
    });
    cursor.record("other", ran("passed"));
    assert.deepEqual(cursor.runs, []);
    cursor.record("search-order-by-customer", ran("failed"));
    assert.equal(
      cursor.next(),
      "Next: look at the page at the failed step, fix the locator or the wait, then call run_test with the whole corrected file (failed runs: 1 of 3).",
    );
    cursor.record("search-order-by-customer", ran("passed"));
    assert.deepEqual([cursor.next(), cursor.failedRuns], ["Next: call propose_test.", 1]);
    cursor.record("search-order-by-customer", ran());
    cursor.record("search-order-by-customer", ran("failed"));
    assert.deepEqual([cursor.next(), cursor.failedRuns], ["Next: call propose_test with diagnosis.", 3]);
    cursor.close();
    assert.deepEqual([cursor.scenario?.id, cursor.rank, cursor.runs, placed], ["other", 2, [], ["search-order-by-customer", "other"]]);
    cursor.close();
    assert.deepEqual([cursor.scenario, cursor.path, cursor.next()], [undefined, undefined, "Next: answer with one sentence. Call no more tools."]);
  });
});
