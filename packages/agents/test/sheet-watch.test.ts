import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlannedScenario, ToolDefinition } from "@open-qa-stack/domain";
import { Journal } from "../src/common/journal.ts";
import { BEYOND_SHEET, SheetWatch } from "../src/designer/sheet-watch.ts";

const OPENED = 'await page.goto("/orders");';

/** A scenario whose only step opens the orders. */
const SCENARIO: PlannedScenario = {
  id: "list-orders",
  title: "List the orders",
  intent: "Verifies that the orders are listed.",
  kind: "functional",
  level: "functional",
  effect: "read",
  case: "nominal",
  application: "shop",
  domain: "orders",
  feature: "listing",
  sources: [],
  data: [],
  steps: [{ action: "Open the orders", code: [OPENED], expects: [] }],
};

const tool = (name: string, result: unknown): ToolDefinition => ({ name, description: name, parameters: { type: "object" }, execute: async () => result });

describe("what a writer looks at beyond its sheet", () => {
  it("journals each look with the scenario, the tool and whether a run failed before, and returns what the tool returned", async () => {
    const journal = new Journal();
    let failed = 0;
    const watch = new SheetWatch(SCENARIO, () => failed, journal);
    const [goto, click, snapshot, search] = watch.watched([
      tool("shop_goto", { code: OPENED }),
      tool("shop_click", { code: 'await page.getByRole("button", { name: "Search", exact: true }).click();' }),
      tool("shop_snapshot", { page: "- heading" }),
      tool("orders_db_search", null),
    ]);
    // Doing again an action of the sheet is no look beyond it.
    assert.deepEqual(await goto!.execute({}), { code: OPENED });
    assert.deepEqual(journal.entries(), []);
    // An action the sheet does not give, a snapshot and a read of a source are.
    await click!.execute({});
    assert.deepEqual(await snapshot!.execute({}), { page: "- heading" });
    failed = 2;
    assert.equal(await search!.execute({}), null);
    watch.close();
    assert.deepEqual(
      journal.entries().map((entry) => [entry.level, entry.message]),
      [
        ["info", `[${BEYOND_SHEET}] Scenario list-orders, before any failed run: shop_click.`],
        ["info", `[${BEYOND_SHEET}] Scenario list-orders, before any failed run: shop_snapshot.`],
        ["info", `[${BEYOND_SHEET}] Scenario list-orders, after failed run 2: orders_db_search.`],
        ["info", "Scenario list-orders: 3 calls beyond its sheet."],
      ],
    );
  });

  it("counts none for a session that looked at nothing", () => {
    const journal = new Journal();
    new SheetWatch(SCENARIO, () => 0, journal).close();
    assert.deepEqual(
      journal.entries().map((entry) => entry.message),
      ["Scenario list-orders: 0 calls beyond its sheet."],
    );
  });
});
