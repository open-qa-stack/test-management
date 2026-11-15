import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import type { ExpectedElement, PlannedScenario } from "@open-qa-stack/domain";
import { CharterCheck, resolveCharter } from "@open-qa-stack/harness";
import { moduleSyntax } from "@open-qa-stack/tools";
import { DesignCursor } from "../src/designer/design-cursor.ts";
import { scenarioSheet, skeleton } from "../src/designer/scenario-sheet.ts";

/** Types of `@playwright/test` that a skeleton uses. */
const PLAYWRIGHT_TYPES = `
export interface Locator { click(): Promise<void>; fill(value: string): Promise<void>; }
export interface BrowserContext { newPage(): Promise<Page>; }
export interface Page {
  goto(url: string): Promise<void>;
  screenshot(): Promise<Uint8Array>;
  getByText(text: string): Locator;
  getByRole(role: string, options?: { name?: string; exact?: boolean }): Locator;
}
export interface TestInfo { attach(name: string, options: { body: Uint8Array; contentType: string }): Promise<void>; }
type Body = (fixtures: { page: Page; context: BrowserContext }, testInfo: TestInfo) => Promise<void>;
export declare const test: ((title: string, body: Body) => void) & ((title: string, details: { tag: string[] }, body: Body) => void) & { step<T>(title: string, body: () => Promise<T>): Promise<T> };
export declare const expect: (actual: unknown) => { toBeVisible(): Promise<void>; toBeHidden(): Promise<void>; toHaveValue(value: string): Promise<void>; toHaveCount(count: number): Promise<void>; not: { toHaveCount(count: number): Promise<void> } };
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
  level: "functional",
  case: "nominal",
  application: "shop",
  domain: "orders",
  sources: [{ source: "orders-db", item: "public.orders" }],
  data: [{ value: "Veldane", from: "orders-db" }],
  steps: [
    { action: "Open the orders", code: [], expects: [] },
    {
      action: "Search the orders\nof Veldane.",
      code: [],
      expects: [
        { result: "The table lists the order of Mira Veldane only", shows: ["ORD-1042", "Mira Veldane"], absent: ["ORD-1057"], elements: [] },
        { result: "The count says one", shows: ["1 order"], absent: [], elements: [] },
      ],
    },
  ],
};

/** The scenario as a plan keeps it once its steps were done on the screens: with the code of each step, and the elements given. */
const explored = (first: readonly ExpectedElement[], second: readonly ExpectedElement[]): PlannedScenario => ({
  ...SEARCH,
  steps: [
    { ...SEARCH.steps[0]!, code: ['await page.goto("/orders");'] },
    {
      ...SEARCH.steps[1]!,
      code: [
        'await page.getByRole("searchbox", { name: "Search orders", exact: true }).fill("Veldane");',
        'await page.getByRole("button", { name: "Search", exact: true }).click();',
      ],
      expects: [
        { ...SEARCH.steps[1]!.expects[0]!, elements: first },
        { ...SEARCH.steps[1]!.expects[1]!, elements: second },
      ],
    },
  ],
});
const SHOWN = explored(
  [
    { text: "ORD-1042", locator: 'page.getByRole("cell", { name: "ORD-1042", exact: true })', field: false },
    { text: "Mira Veldane", locator: 'page.getByRole("row", { name: "ORD-1042 Mira Veldane" })', field: false },
    { text: "ORD-1057", locator: 'page.getByRole("cell", { name: "ORD-1057", exact: true })', field: false },
  ],
  [{ text: "1 order", locator: 'page.getByRole("textbox", { name: "Count", exact: true })', field: true }],
);
/** The scenario when several elements share the locator of two of its texts, one shown, one gone. */
const SHARED = explored(
  [
    { text: "Mira Veldane", locator: 'page.getByRole("cell", { name: "Mira Veldane", exact: true })', field: false, count: 2 },
    { text: "ORD-1057", locator: 'page.getByRole("cell", { name: "ORD-1057", exact: true })', field: false, count: 3 },
  ],
  [],
);

describe("the skeleton of a test", () => {
  it("holds one test.step per step, titled by its number, with what to do when the plan gives no code, an assertion of each text of its expects, and a screenshot when asked", () => {
    assert.equal(
      skeleton(SEARCH, true),
      `import { expect, test } from "@playwright/test";

test("Search an order by \\"customer\\" name", { tag: ["@level-functional","@domain-orders","@app-shop","@kind-functional","@case-nominal"] }, async ({ page }, testInfo) => {
  await test.step("1. Open the orders", async () => {
    // Do: Open the orders. Copy the code lines the browser tools returned.
    await testInfo.attach("1", { body: await page.screenshot(), contentType: "image/png" });
  });
  await test.step("2. Search the orders of Veldane", async () => {
    // Do: Search the orders of Veldane. Copy the code lines the browser tools returned.
    // Expect 2.1: The table lists the order of Mira Veldane only.
    await expect(page.getByText("ORD-1042")).not.toHaveCount(0);
    await expect(page.getByText("Mira Veldane")).not.toHaveCount(0);
    await expect(page.getByText("ORD-1057")).toBeHidden();
    // Expect 2.2: The count says one.
    await expect(page.getByText("1 order")).not.toHaveCount(0);
    await testInfo.attach("2", { body: await page.screenshot(), contentType: "image/png" });
  });
});
`,
    );
    assert.doesNotMatch(skeleton(SEARCH, false), /testInfo/);
  });

  it("holds the lines of code the plan gives for each step, in place of what to do, and asserts each text on the element the plan gives for it", () => {
    assert.equal(
      skeleton(SHOWN, false),
      `import { expect, test } from "@playwright/test";

test("Search an order by \\"customer\\" name", { tag: ["@level-functional","@domain-orders","@app-shop","@kind-functional","@case-nominal"] }, async ({ page }) => {
  await test.step("1. Open the orders", async () => {
    await page.goto("/orders");
  });
  await test.step("2. Search the orders of Veldane", async () => {
    await page.getByRole("searchbox", { name: "Search orders", exact: true }).fill("Veldane");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    // Expect 2.1: The table lists the order of Mira Veldane only.
    await expect(page.getByRole("cell", { name: "ORD-1042", exact: true })).toBeVisible();
    await expect(page.getByRole("row", { name: "ORD-1042 Mira Veldane" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "ORD-1057", exact: true })).toBeHidden();
    // Expect 2.2: The count says one.
    await expect(page.getByRole("textbox", { name: "Count", exact: true })).toHaveValue("1 order");
  });
});
`,
    );
  });

  it("asserts a text several elements share the locator of by their number: one at least, or none left", () => {
    assert.deepEqual(
      skeleton(SHARED, false)
        .split("\n")
        .filter((line) => line.includes("getByRole") && line.includes("Count(")),
      [
        '    await expect(page.getByRole("cell", { name: "Mira Veldane", exact: true })).not.toHaveCount(0);',
        '    await expect(page.getByRole("cell", { name: "ORD-1057", exact: true })).toHaveCount(0);',
      ],
    );
  });

  it("parses, and keeps the default charter as it is, with or without the code and the elements of the plan", async () => {
    const charter = resolveCharter({ disable: [], add: [] });
    assert.ok(charter.ok);
    for (const scenario of [SEARCH, SHOWN, SHARED]) {
      const content = skeleton(scenario, true);
      assert.ok((await moduleSyntax(content)).ok);
      assert.deepEqual(await new CharterCheck({ repository, rules: charter.rules }).check({ path: "apps/shop/search-order-by-customer.spec.ts", content }), []);
    }
  });
});

describe("the skeleton of a test of several applications", () => {
  /** A search on the shop, then its effect checked on the desk of the customer service. */
  const CROSSING: PlannedScenario = {
    ...SEARCH,
    level: "cross-application",
    applications: ["customer-desk"],
    steps: [
      { ...SEARCH.steps[0]!, code: ['await page.goto("/orders");'] },
      {
        action: "Open the tickets of the desk",
        application: "customer-desk",
        code: ['await customerDeskPage.goto(new URL("/tickets", process.env.OQAS_BASE_URL_CUSTOMER_DESK).href);'],
        expects: [
          {
            result: "The ticket of the order shows",
            shows: ["Ticket 12", "Open"],
            absent: [],
            elements: [{ text: "Ticket 12", locator: 'page.getByRole("link", { name: "Ticket 12", exact: true })', field: false }],
          },
        ],
      },
    ],
  };

  it("opens a tab for each other application, and asserts what a step done there expects on its tab", async () => {
    const content = skeleton(CROSSING, true);
    const lines = content.split("\n").map((line) => line.trim());
    assert.ok(lines.includes("const customerDeskPage = await context.newPage();"), content);
    assert.ok(content.includes("async ({ page, context }, testInfo) => {"), content);
    for (const line of [
      'await expect(customerDeskPage.getByRole("link", { name: "Ticket 12", exact: true })).toBeVisible();',
      'await expect(customerDeskPage.getByText("Open")).not.toHaveCount(0);',
      'await testInfo.attach("2", { body: await customerDeskPage.screenshot(), contentType: "image/png" });',
      'await testInfo.attach("1", { body: await page.screenshot(), contentType: "image/png" });',
    ])
      assert.ok(lines.includes(line), `${line}\n${content}`);
    assert.ok((await moduleSyntax(content)).ok);
    const charter = resolveCharter({ disable: [], add: [] });
    assert.ok(charter.ok);
    assert.deepEqual(await new CharterCheck({ repository, rules: charter.rules }).check({ path: "apps/shop/search-order-by-customer.spec.ts", content }), []);
  });
});

describe("the sheet of a scenario", () => {
  it("names the scenario, its intent, its data, what it cites and its file before the skeleton, and ends with the next call", () => {
    const cursor = new DesignCursor({ scenarios: [SEARCH, { ...SEARCH, id: "other", data: [] }] }, (scenario) => `apps/shop/${scenario.id}.spec.ts`);
    const sheet = scenarioSheet(cursor, false).split("\n");
    assert.deepEqual(sheet.slice(0, 6), [
      'Scenario 1 of 2: search-order-by-customer — Search an order by "customer" name (functional level, functional, nominal), application shop.',
      "Intent: Verifies that a search by last name finds the order of the customer.",
      'Data: "Veldane" (orders-db).',
      "Cited: orders-db: public.orders.",
      "File: apps/shop/search-order-by-customer.spec.ts",
      "",
    ]);
    assert.equal(
      sheet.at(-1),
      "Next: check the skeleton of search-order-by-customer against its steps, complete what a comment asks, then call run_test with the whole file.",
    );
    // A test of several applications is told the others it acts on, and bears a tag for each.
    const crossing = new DesignCursor({ scenarios: [{ ...SEARCH, level: "cross-application", applications: ["desk"] }] }, () => "apps/shop/a.spec.ts");
    const told = scenarioSheet(crossing, false);
    assert.ok(told.includes("application shop; it also acts on desk, each in a tab of its own, as the skeleton opens them."), told);
    assert.ok(told.includes('"@app-shop","@app-desk"'), told);
    // A scenario without data says so, and a source cited whole is named alone.
    cursor.close();
    assert.deepEqual(
      scenarioSheet(new DesignCursor({ scenarios: [{ ...SEARCH, data: [], sources: [{ source: "shop" }] }] }, () => "x.spec.ts"), false)
        .split("\n")
        .slice(2, 4),
      ["Data: none.", "Cited: shop."],
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
    assert.deepEqual([cursor.scenario, cursor.path], [undefined, undefined]);
  });
});
