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

  it("is not searched for a secret, since the source gave it; what the agent wrote is", () => {
    const inventory = { items: ["admin-hunter2"], facts: new Map(), fingerprint: fingerprintOf("") };
    const item = (summary: string) => ({ domains: [{ id: "all", label: "All", description: "All.", items: [{ name: "admin-hunter2", summary }] }], unassigned: [] });
    assert.deepEqual(cardRules("app", () => inventory, ["hunter2"]).check(item("Admins.")).errors, []);
    assert.deepEqual(cardRules("app", () => inventory, ["hunter2"]).check(item("Uses hunter2.")).errors.map((e) => e.path), ["/domains/0/items/0/summary"]);
    const index = (source: string, items: string[]) => domainIndexRules(new Map([["app", ["admin-hunter2"]]]), new Set(["app"]), () => true, ["hunter2"]).check({ domains: [{ id: "all", label: "All", description: "All.", references: [{ source, items }] }], unassigned: [] });
    assert.deepEqual(index("app", ["admin-hunter2"]).errors, []);
    assert.deepEqual(index("hunter2", ["x"]).errors.map((e) => e.path)[0], "/domains/0/references/0/source");
    assert.ok(index("app", ["admin-hunter2", "hunter2-x"]).errors.some((e) => e.path === "/domains/0/references/0/items/1"));
  });
});
