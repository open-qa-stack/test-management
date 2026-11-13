import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fingerprintOf } from "@open-qa-stack/tools";
import { domainIndexRules } from "../src/cartographer/domain-index-rules.ts";
import { cardRules } from "../src/source-cartographer/card-rules.ts";

describe("the name of an element that starts with the name of its source", () => {
  it("is kept as it is when it is an element, and read without the source otherwise", () => {
    const inventory = { items: ["app/models", "views"], facts: new Map(), fingerprint: fingerprintOf("") };
    const card = cardRules("app", () => inventory, []).check({ domains: [{ id: "all", label: "All", description: "All.", items: [{ name: "app/models", summary: "Models." }, { name: "app/views", summary: "Views." }] }], unassigned: [] });
    assert.deepEqual([card.value.domains[0]!.items.map((item) => item.name), card.errors], [["app/models", "views"], []]);
    const index = domainIndexRules(new Map([["app", ["app/models", "views"]]]), new Set(["app"]), () => true, []).check({ domains: [{ id: "all", label: "All", description: "All.", references: [{ source: "app", items: ["app/models", "app:views"] }] }], unassigned: [] });
    assert.deepEqual([index.value.domains[0]!.references, index.errors], [[{ source: "app", items: ["app/models", "views"] }], []]);
  });

  it("is refused in an index when it holds a secret", () => {
    const index = domainIndexRules(new Map([["app", ["views"]]]), new Set(["app"]), () => true, ["hunter2"]).check({ domains: [{ id: "all", label: "All", description: "Signs in with hunter2.", references: [{ source: "app", items: ["views"] }] }], unassigned: [] });
    assert.deepEqual(index.errors.map((error) => error.message), ["/domains/0/description holds a secret of the configuration; write it without the secret."]);
  });

  it("does not hide a secret the names of the source show, and hides the others", () => {
    const inventory = { items: ["com/lakesidemutual/domain"], facts: new Map(), fingerprint: fingerprintOf("") };
    const card = (summary: string, name = "com/lakesidemutual/domain") => ({ domains: [{ id: "all", label: "All", description: "All.", items: [{ name, summary }] }], unassigned: [] });
    const rules = cardRules("app", () => inventory, ["lakeside", "hunter2"]);
    assert.deepEqual(rules.check(card("The lakeside domain.")).errors, []);
    assert.deepEqual(rules.secrets(), ["hunter2"]);
    assert.deepEqual(rules.check(card("Uses hunter2.")).errors.map((e) => e.path), ["/domains/0/items/0/summary"]);
    const index = domainIndexRules(new Map([["app", ["com/lakesidemutual/domain"]]]), new Set(["app"]), () => true, ["lakeside", "hunter2"]);
    assert.deepEqual(index.secrets(), ["hunter2"]);
    const references = (items: string[]) => ({ domains: [{ id: "all", label: "All", description: "All.", references: [{ source: "app", items }] }], unassigned: [] });
    assert.deepEqual(index.check(references(["com/lakesidemutual/domain"])).errors, []);
    assert.ok(index.check(references(["com/lakesidemutual/domain", "hunter2-x"])).errors.some((e) => e.path === "/domains/0/references/0/items/1" && e.message.includes("holds a secret")));
  });
});
