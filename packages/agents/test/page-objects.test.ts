import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { PlannedLine, PlannedScenario } from "@open-qa-stack/domain";
import { PageObjects } from "../src/designer/page-objects.ts";

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** An empty test repository. */
function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "page-objects-"));
  roots.push(root);
  return root;
}

const SHOP = { id: "shop", name: "Shop" };
const DESK = { id: "customer-desk", name: "Customer Desk" };
const GOTO = 'await page.goto("/orders");';
const SEARCH = 'await page.getByRole("textbox", { name: "Search", exact: true }).fill("Veldane");';
const OPEN = 'await page.getByRole("row", { name: "Veldane" }).getByRole("link", { name: "Open", exact: true }).click();';
const TICKET = 'await page.getByRole("button", { name: "New ticket", exact: true }).click();';

const on = (application: string, screen: string | undefined, code: string): PlannedLine => ({ application, ...(screen === undefined ? {} : { screen }), code });
/** A scenario of the shop whose steps do the actions given, each line of code as its action returned it. */
const scenario = (steps: readonly (readonly PlannedLine[])[], changes: Partial<PlannedScenario> = {}): PlannedScenario => ({
  id: "search-order",
  title: "Search an order",
  intent: "Verifies the search.",
  kind: "functional",
  level: "functional",
  case: "nominal",
  effect: "read",
  application: "shop",
  domain: "orders",
  feature: "listing",
  sources: [],
  data: [],
  steps: steps.map((lines) => ({ action: "Do it", code: lines.map((line) => line.code), lines, expects: [] })),
  ...changes,
});

describe("the page objects written from a plan", () => {
  it("give each action on an element of a screen a member of the page object of that screen, and leave the other lines as they are", async () => {
    const root = repository();
    const pages = new PageObjects({ repositoryRoot: root, appsDir: "apps", applications: [SHOP, DESK] });
    const crossing = scenario(
      [
        [on("shop", "/orders", GOTO), on("shop", "/orders", SEARCH), on("shop", "/orders", OPEN), on("shop", undefined, SEARCH)],
        [on("customer-desk", "/tickets/:id", TICKET)],
      ],
      { applications: ["customer-desk"] },
    );
    const [applied] = await pages.apply([crossing]);
    assert.deepEqual(
      applied!.steps.map((step) => step.code),
      [
        [GOTO, 'await shop.orders.searchTextbox.fill("Veldane");', 'await shop.orders.openLinkInRow("Veldane").click();', SEARCH],
        ["await customerDesk.ticketsItem.newTicketButton.click();"],
      ],
    );
    // The plan keeps where each line comes from: writing it again changes nothing.
    assert.deepEqual(await pages.apply([applied!]), [applied]);
    const files = await pages.files();
    assert.deepEqual(
      files.map((file) => file.path),
      ["apps/shop/pages/orders.page.ts", "apps/customer-desk/pages/tickets-item.page.ts", "apps/shop/pages/index.ts", "apps/customer-desk/pages/index.ts"],
    );
    assert.match(files[0]!.content, /^\/\*\* The screen \/orders of Shop: /m);
    assert.match(files[0]!.content, /\n {2}openLinkInRow\(row: string\): Locator \{\n/);
    assert.match(files[2]!.content, /\n {2}readonly orders: OrdersPage;\n/);
    assert.match(files[3]!.content, /\n {4}this\.ticketsItem = new TicketsItemPage\(page\);\n/);
  });

  it("leave as it is a scenario that acts on an application the fixtures do not give, and a step that does not say where its lines come from", async () => {
    const pages = new PageObjects({ repositoryRoot: repository(), appsDir: "apps", applications: [SHOP] });
    const crossing = scenario([[on("shop", "/orders", SEARCH)], [on("customer-desk", "/tickets", TICKET)]]);
    const frozen = scenario([[on("shop", "/orders", SEARCH)]]);
    const old = {
      ...frozen,
      steps: [
        { action: "Do it", code: [GOTO, SEARCH], expects: [] },
        { ...frozen.steps[0]!, code: [] },
      ],
    };
    assert.deepEqual(await pages.apply([crossing, old]), [crossing, old]);
    // The file that gathers the page objects of each application given is written all the same: the fixtures import it.
    assert.deepEqual(
      (await pages.files()).map((file) => [file.path, /new /.test(file.content)]),
      [["apps/shop/pages/index.ts", false]],
    );
  });

  it("add to the page objects the repository has, under the names their classes bear, and gather those it does not touch", async () => {
    const root = repository();
    mkdirSync(join(root, "tests", "shop", "pages"), { recursive: true });
    const own = 'import type { Locator, Page } from "@playwright/test";\n\nexport class OrderList {\n  constructor(readonly page: Page) {}\n}\n';
    writeFileSync(join(root, "tests", "shop", "pages", "orders.page.ts"), own);
    writeFileSync(join(root, "tests", "shop", "pages", "basket.page.ts"), own.replace("OrderList", "BasketPage"));
    writeFileSync(join(root, "tests", "shop", "pages", "notes.page.ts"), "// Nothing declared here.\n");
    writeFileSync(join(root, "tests", "shop", "pages", "helpers.ts"), "export class Helper {}\n");
    const pages = new PageObjects({ repositoryRoot: root, appsDir: "tests", applications: [SHOP] });
    const [applied] = await pages.apply([scenario([[on("shop", "/orders", SEARCH), on("shop", "/orders", SEARCH)]])]);
    assert.deepEqual(applied!.steps[0]!.code, ['await shop.orderList.searchTextbox.fill("Veldane");', 'await shop.orderList.searchTextbox.fill("Veldane");']);
    const files = await pages.files();
    assert.ok(files[0]!.content.startsWith(own.slice(0, -2)), files[0]!.content);
    assert.match(files[1]!.content, /import \{ BasketPage \} from "\.\/basket\.page\.ts";\nimport \{ OrderList \} from "\.\/orders\.page\.ts";\n\n/);
    assert.doesNotMatch(files[1]!.content, /Helper|notes/);
  });
});
