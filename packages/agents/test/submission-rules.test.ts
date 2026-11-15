import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { fingerprintOf } from "@open-qa-stack/tools";
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
