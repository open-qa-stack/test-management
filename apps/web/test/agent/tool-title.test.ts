import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { toolTitle } from "../../src/agent/tool-title.ts";

describe("the title of a tool call", () => {
  it("reads as what the agent did, for each tool of the browser, of the knowledge and of the design", () => {
    const cases: readonly (readonly [string, unknown, string])[] = [
      ["customer_self_service_goto", { url: "/quotes" }, "A ouvert /quotes dans customer-self-service"],
      ["shop_click", { target: { role: "button", name: "Log in" } }, "A cliqué sur « Log in » dans shop"],
      ["shop_click", { target: { text: "Insurance Type" } }, "A cliqué sur « Insurance Type » dans shop"],
      ["shop_click", {}, "A cliqué sur « un élément » dans shop"],
      ["shop_fill", { target: { name: "Search" }, value: "Ado" }, "A saisi « Ado » dans « Search »"],
      ["shop_fill", {}, "A saisi une valeur dans « un élément »"],
      ["shop_fill", { value: null }, "A saisi une valeur dans « un élément »"],
      ["shop_select_option", { option: "Home Insurance" }, "A choisi « Home Insurance »"],
      ["shop_check", { target: { name: "Accept" } }, "A coché « Accept »"],
      ["shop_snapshot", {}, "A regardé la page de shop"],
      ["shop_screenshot", undefined, "A capturé l’écran de shop"],
      ["orders_db_list_tables", {}, "A listé les tables de orders"],
      ["orders_db_describe_table", { schema: "public", table: "orders" }, "A décrit la table orders"],
      ["orders_db_sample_rows", { table: "orders", limit: 10 }, "A lu des lignes de la table orders"],
      ["shop_api_list_operations", {}, "A listé les opérations de l’API de shop"],
      ["shop_api_read_operation", { method: "GET", path: "/user" }, "A lu l’opération GET /user"],
      ["shop_frontend_code_list_files", { glob: "**/*" }, "A listé les fichiers de shop-frontend-code"],
      ["shop_frontend_code_read_file", { path: "src/a.js" }, "A lu src/a.js"],
      ["shop_specs_read_section", { file: "shop.md", number: 17 }, "A lu shop.md § 17"],
      ["knowledge_domain", { domain: "quotes" }, "A lu le domaine quotes"],
      ["knowledge_read", { item: null }, "A lu "],
      ["knowledge_read", {}, "A lu "],
      ["knowledge_list", { words: "quote request" }, "A cherché dans les connaissances : quote request"],
      ["knowledge_read", { item: "src/pages" }, "A lu src/pages"],
      ["tests_list", { about: "quotes" }, "A cherché les tests existants"],
      ["tests_read", { path: "a.spec.ts" }, "A lu le test a.spec.ts"],
      ["propose_plan", { scenarios: [{}, {}] }, "A proposé un plan de 2 scénario(s)"],
      ["propose_plan", null, "A proposé un plan de 0 scénario(s)"],
      ["run_test", { content: "test();" }, "A joué le test"],
      ["propose_test", {}, "A remis le test"],
      ["report_duplicates", { duplicates: [{}] }, "A signalé 1 doublon(s)"],
      ["report_findings", { findings: [] }, "A rendu 0 constat(s) de cohérence"],
      ["report_quality", { findings: [{}, {}] }, "A rendu 2 remarque(s) sur le code"],
      ["remember", { text: "A note." }, "A noté quelque chose pour la suite"],
    ];
    for (const [tool, args, title] of cases) assert.equal(toolTitle(tool, args), title, tool);
  });

  it("names what is typed from a test account, and never shows it", () => {
    assert.equal(
      toolTitle("shop_fill", { target: { name: "Email" }, value: { account: "demo", field: "username" } }),
      "A saisi le champ username du compte demo dans « Email »",
    );
  });

  it("is the name of the tool and its arguments for a tool the console does not know", () => {
    assert.equal(toolTitle("something_else", { a: 1 }), 'something_else {"a":1}');
    assert.equal(toolTitle("something_else", undefined), "something_else {}");
  });
});
