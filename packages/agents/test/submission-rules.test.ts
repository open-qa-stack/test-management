import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fingerprintOf } from "@open-qa-stack/tools";
import { domainIndexRules } from "../src/cartographer/domain-index-rules.ts";
import { cardRules } from "../src/source-cartographer/card-rules.ts";

describe("the name of an element that starts with the name of its source", () => {
  it("is kept as it is when it is an element, and read without the source otherwise", () => {
    const inventory = { items: ["app/models", "views"], facts: new Map(), fingerprint: fingerprintOf("") };
    const card = cardRules("app", () => inventory, []).check({
      domains: [
        {
          id: "all",
          label: "All",
          description: "All.",
          items: [
            { name: "app/models", summary: "Models." },
            { name: "app/views", summary: "Views." },
          ],
        },
      ],
      unassigned: [],
    });
    assert.deepEqual([card.value.domains[0]!.items.map((item) => item.name), card.errors], [["app/models", "views"], []]);
    const index = domainIndexRules(new Map([["app", ["app/models", "views"]]]), new Map([["app", "source-code"]]), () => true, [], new Map()).check({
      domains: [{ id: "all", label: "All", description: "All.", references: [{ source: "app", items: ["app/models", "app:views"] }] }],
      unassigned: [],
    });
    assert.deepEqual([index.value.domains[0]!.references, index.errors], [[{ source: "app", items: ["app/models", "views"] }], []]);
  });

  it("is refused in an index when it holds a secret", () => {
    const index = domainIndexRules(new Map([["app", ["views"]]]), new Map([["app", "source-code"]]), () => true, ["hunter2"], new Map()).check({
      domains: [{ id: "all", label: "All", description: "Signs in with hunter2.", references: [{ source: "app", items: ["views"] }] }],
      unassigned: [],
    });
    assert.deepEqual(
      index.errors.map((error) => error.message),
      ["/domains/0/description holds a secret of the configuration; write it without the secret."],
    );
  });

  it("is refused in a card when it holds a secret", () => {
    const inventory = { items: ["views"], facts: new Map(), fingerprint: fingerprintOf("") };
    const card = cardRules("app", () => inventory, ["key-abcdef"]).check({
      domains: [{ id: "all", label: "All", description: "All.", items: [{ name: "views", summary: "Called with key-abcdef." }] }],
      unassigned: [],
    });
    assert.deepEqual(
      card.errors.map((error) => error.path),
      ["/domains/0/items/0/summary"],
    );
  });
});
