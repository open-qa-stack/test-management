import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IndexSourceType } from "@open-qa-stack/shared";
import { ElementWords } from "../src/cartographer/element-words.ts";

/** The words of a run whose sources are given as `[id, type, elements]`. */
function wordsOf(...sources: readonly (readonly [string, IndexSourceType, readonly string[]])[]): ElementWords {
  return new ElementWords(new Map(sources.map(([id, , items]) => [id, items] as const)), new Map(sources.map(([id, type]) => [id, type] as const)));
}

describe("shared words", () => {
  it("keeps every word of a single element, and of screens and sections that all begin with the same word", () => {
    const words = wordsOf(["ui", "web", ["/policies/new"]], ["db", "postgresql", ["public.policies", "public.customers"]], ["doc", "document", ["Policy creation", "Policy renewal"]]);
    assert.deepEqual(words.shared({ source: "ui", item: "/policies/new" }, { source: "db", item: "public.policies" }), ["policy"]);
    assert.deepEqual(words.shared({ source: "doc", item: "Policy creation" }, { source: "db", item: "public.policies" }), ["policy"]);
    const shop = wordsOf(["spec", "document", ["Order returns"]], ["db", "postgresql", ["shop.orders", "shop.customers"]], ["web", "web", ["/orders/new", "/orders/list"]]);
    assert.deepEqual(shop.shared({ source: "spec", item: "Order returns" }, { source: "db", item: "shop.orders" }), ["order"]);
    assert.deepEqual(shop.shared({ source: "web", item: "/orders/new" }, { source: "db", item: "shop.orders" }), ["order"]);
    const single = wordsOf(["db", "postgresql", ["public.policy_holders"]], ["ui", "web", ["/policy"]]);
    assert.deepEqual(single.shared({ source: "db", item: "public.policy_holders" }, { source: "ui", item: "/policy" }), ["policy"]);
  });

  it("leaves out the schema every table of a base begins with, even one another base begins with too", () => {
    const words = wordsOf(["policies-db", "postgresql", ["public.policies", "public.customers"]], ["crm-db", "postgresql", ["public.customers", "public.addresses"]]);
    assert.deepEqual(words.shared({ source: "policies-db", item: "public.customers" }, { source: "crm-db", item: "public.customers" }), ["customer"]);
    assert.deepEqual(words.shared({ source: "policies-db", item: "public.policies" }, { source: "crm-db", item: "public.addresses" }), []);
  });

  it("keeps a leading word of every folder when an element of another source has it", () => {
    const words = wordsOf(["code", "source-code", ["src/orders/api", "src/orders/web"]], ["db", "postgresql", ["shop.orders", "shop.invoices"]], ["ui", "web", ["/src"]]);
    assert.deepEqual(words.shared({ source: "code", item: "src/orders/web" }, { source: "db", item: "shop.orders" }), ["order"]);
    assert.deepEqual(words.shared({ source: "code", item: "src/orders/web" }, { source: "ui", item: "/src" }), ["src"]);
    assert.deepEqual(words.shared({ source: "db", item: "shop.invoices" }, { source: "code", item: "src/orders/api" }), []);
  });
});
