import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, it } from "vitest";
import type { PlannedScenario } from "@open-qa-stack/domain";
import { coveringTests, earlierScenarios, existingTests, existingTestTools } from "../src/designer/existing-tests.ts";
import { planFileText, type PlanRecord } from "../src/designer/plan-file.ts";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A test repository that holds the files given. */
function repository(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "existing-tests-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const SEARCH = `import { expect, test } from "../../../../shared/fixtures.ts";

test("Search a \\"customer\\"", { tag: ["@level-functional","@domain-customers","@feature-customer-search","@app-shop"] }, async ({ page }) => {
  await test.step("1. Open the customers", async () => {});
  await test.step("2. Search Veldane", async () => {});
});
`;
const LONG = `test.describe("legacy", () => {});\n// ${"x".repeat(7000)}\n`;

describe("the tests a repository already has", () => {
  it("are read from their files, whoever wrote them: the title, the tags and the steps of each", async () => {
    const root = repository({
      "apps/shop/tests/customers/customer-search/search.spec.ts": SEARCH,
      "apps/shop/legacy.test.ts": LONG,
      "apps/shop/pages/home.page.ts": "export class HomePage {}\n",
      "apps/node_modules/kept/out.spec.ts": SEARCH,
    });
    const tests = await existingTests(root, "apps");
    assert.deepEqual(
      tests.map(({ content: _content, ...test }) => test),
      [
        { path: "apps/shop/legacy.test.ts", title: "legacy", tags: [], steps: [] },
        {
          path: "apps/shop/tests/customers/customer-search/search.spec.ts",
          title: 'Search a "customer"',
          tags: ["@level-functional", "@domain-customers", "@feature-customer-search", "@app-shop"],
          steps: ["1. Open the customers", "2. Search Veldane"],
        },
      ],
    );
    // A file without a test is named by its path, and a title this cannot read is given as it is written.
    const odd = repository({ "tests/empty.spec.ts": "// Nothing yet.\n", "tests/odd.spec.ts": 'test("a\\qb", () => {});\n' });
    assert.deepEqual(
      (await existingTests(odd, "tests")).map((test) => test.title),
      ["tests/empty.spec.ts", '"a\\qb"'],
    );
    assert.deepEqual(await existingTests(root, "missing"), []);
  });

  it("are listed to the agent that plans, all of them or those a word is about, and read one at a time", async () => {
    const root = repository({ "apps/shop/tests/customers/customer-search/search.spec.ts": SEARCH, "apps/shop/legacy.test.ts": LONG });
    const [list, read] = existingTestTools(await existingTests(root, "apps"));
    const paths = async (args: object) => ((await list!.execute(args)) as { tests: { path: string }[] }).tests.map((test) => test.path);
    assert.deepEqual(await paths({}), ["apps/shop/legacy.test.ts", "apps/shop/tests/customers/customer-search/search.spec.ts"]);
    assert.deepEqual(await paths({ about: "Customer-Search" }), ["apps/shop/tests/customers/customer-search/search.spec.ts"]);
    assert.deepEqual(await paths({ about: "billing" }), []);
    assert.deepEqual(await read!.execute({ path: "apps/shop/tests/customers/customer-search/search.spec.ts" }), {
      path: "apps/shop/tests/customers/customer-search/search.spec.ts",
      content: SEARCH,
      truncated: false,
    });
    const long = (await read!.execute({ path: "apps/shop/legacy.test.ts" })) as { content: string; truncated: boolean };
    assert.deepEqual([long.content.length, long.truncated], [6000, true]);
    assert.deepEqual(await read!.execute({ path: "apps/none.spec.ts" }), {
      error: "No test at apps/none.spec.ts. Call tests_list for the paths of the tests.",
    });
  });
});

describe("the tests of earlier designs a new scenario is compared with", () => {
  const scenario = (id: string, steps: PlannedScenario["steps"]): PlannedScenario => ({
    id,
    title: id,
    intent: "Verifies it.",
    kind: "functional",
    level: "functional",
    case: "nominal",
    effect: "read",
    application: "shop",
    domain: "customers",
    feature: "customer-search",
    sources: [],
    data: [{ value: "Veldane", from: "shop" }],
    steps,
  });
  const GOTO = 'await page.goto("/customers");';
  const FILL = 'await page.getByRole("textbox", { name: "Search", exact: true }).fill("Veldane");';
  const found = { result: "The customer shows", shows: ["Mira Veldane"], absent: ["Ada Brennick"], elements: [] };
  const searched = scenario("search", [
    { action: "Open the customers", code: [GOTO], lines: [{ application: "shop", screen: "/customers", code: GOTO }], expects: [] },
    {
      action: "Search Veldane",
      code: ['await shop.customers.searchTextbox.fill("Veldane");'],
      lines: [{ application: "shop", screen: "/customers", code: FILL, typed: "Veldane" }],
      expects: [found],
    },
  ]);
  const record: PlanRecord = {
    formatVersion: 2,
    design: "design-1",
    environment: "local",
    scenarios: [
      searched,
      scenario("old", [{ action: "Open", code: [GOTO], expects: [] }]),
      scenario("failed", searched.steps),
      scenario("gone", searched.steps),
      scenario("api", [{ action: "Get the customers", code: [], lines: [], expects: [found] }]),
    ],
  };
  const test = (name: string, verdict = "passed") => ({ path: `apps/shop/${name}.spec.ts`, scenario: name, verdict });
  const state = {
    plan: ".oqas/designs/design-1.plan.md",
    tests: [test("search"), test("old"), test("failed", "failed"), test("gone"), test("api"), test("unplanned")],
  };

  it("are those that passed and are still there, each by the lines its plan kept and what it expects", async () => {
    const root = repository({
      ".oqas/designs/design-1.json": JSON.stringify(state),
      ".oqas/designs/design-1.plan.md": planFileText(record),
      ".oqas/designs/design-2.json": JSON.stringify({ plan: ".oqas/designs/design-2.plan.md", tests: [test("search")] }),
      ".oqas/designs/design-3.json": "{}",
      ".oqas/designs/notes.txt": "kept",
    });
    const present = ["search", "old", "failed", "api", "unplanned"].map((name) => `apps/shop/${name}.spec.ts`);
    assert.deepEqual(await coveringTests(root, ".oqas", present), [
      {
        path: "apps/shop/search.spec.ts",
        described:
          'search (nominal, shop). Verifies it.\nEnters: "Veldane"\n1. Open the customers\n2. Search Veldane -> The customer shows; shows "Mira Veldane"; no longer shows "Ada Brennick"',
        writes: [],
        visual: false,
        opens: [{ application: "shop", screen: "/customers", code: GOTO }],
        verified: {
          application: "shop",
          data: ["Veldane"],
          steps: [
            { does: [GOTO, ""], shows: [], absent: [] },
            { does: [FILL, "Veldane"], shows: ["Mira Veldane"], absent: ["Ada Brennick"] },
          ],
        },
      },
      {
        path: "apps/shop/api.spec.ts",
        described:
          'api (nominal, shop). Verifies it.\nEnters: "Veldane"\n1. Get the customers -> The customer shows; shows "Mira Veldane"; no longer shows "Ada Brennick"',
        writes: [],
        visual: false,
        opens: [],
        verified: { application: "shop", data: ["Veldane"], steps: [{ does: ["Get the customers"], shows: ["Mira Veldane"], absent: ["Ada Brennick"] }] },
      },
    ]);
    assert.deepEqual(await coveringTests(repository({}), ".oqas", present), []);
  });

  it("are, for the rounds of one design, the scenarios they planned, whatever their test became, but one whose plan kept no lines", () => {
    const earlier = earlierScenarios(record.scenarios);
    assert.deepEqual(
      earlier.map((planned) => planned.id),
      ["search", "failed", "gone", "api"],
    );
    assert.deepEqual(earlier[0]!.verified.steps[1], { does: [FILL, "Veldane"], shows: ["Mira Veldane"], absent: ["Ada Brennick"] });
    assert.match(earlier[0]!.described, /Search Veldane/);
  });
});
