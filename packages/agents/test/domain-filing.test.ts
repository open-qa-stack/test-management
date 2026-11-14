import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DomainIndexSubmission, IndexSourceType, SourceCard } from "@open-qa-stack/shared";
import { cartographyRequest } from "../src/cartographer/cartographer-prompt.ts";
import { domainIndexRules } from "../src/cartographer/domain-index-rules.ts";
import type { RunSource } from "../src/cartographer/run-sources.ts";

const TYPES: ReadonlyMap<string, IndexSourceType> = new Map<string, IndexSourceType>([
  ["orders-api", "openapi"],
  ["orders-db", "postgresql"],
  ["crm-db", "postgresql"],
  ["order-specs", "document"],
  ["storefront", "web"],
  ["empty", "document"],
]);

const INVENTORY = new Map<string, readonly string[]>([
  ["orders-api", ["orders", "customers", "/health"]],
  ["orders-db", ["public.orders", "public.order_lines", "public.invoices"]],
  ["crm-db", ["public.customers", "public.addresses"]],
  ["order-specs", ["Placing an order", "Purpose", "Open points", "Acceptance criteria", "§2"]],
  ["storefront", ["/", "/orders/:id", "/categories", "/address"]],
  ["empty", []],
]);

const rules = () => domainIndexRules(INVENTORY, TYPES, () => true, []);

type Domain = DomainIndexSubmission["domains"][number];
const domain = (id: string, references: Domain["references"]): Domain => ({ id, label: id, description: `The ${id}.`, references });
const errorsOf = (submission: DomainIndexSubmission) =>
  rules()
    .check(submission)
    .errors.map((error) => error.message);

/** Every element placed: orders and customers across sources, the rest in unassigned. */
const ORDERS = domain("orders", [
  { source: "orders-api", items: ["orders"] },
  { source: "orders-db", items: ["public.orders", "public.order_lines"] },
  { source: "order-specs", items: ["Placing an order"] },
]);
const CUSTOMERS = domain("customers", [
  { source: "orders-api", items: ["customers"] },
  { source: "crm-db", items: ["public.customers", "public.addresses"] },
]);
const REST = [
  { source: "orders-api", items: ["/health"] },
  { source: "orders-db", items: ["public.invoices"] },
  { source: "order-specs", items: ["Purpose", "Open points", "Acceptance criteria", "§2"] },
  { source: "storefront", items: ["/", "/orders/:id", "/categories", "/address"] },
];

function card(id: string, type: IndexSourceType, domains: SourceCard["domains"], unassigned: string[] = []): SourceCard {
  return {
    formatVersion: 1,
    source: { id, type },
    fingerprint: `sha256:${"0".repeat(64)}`,
    producedAt: "2026-11-13T09:00:00.000Z",
    model: { provider: "openai", baseUrl: "http://127.0.0.1:1/v1", model: "test-model" },
    run: { iterations: 1, actions: 1, durationMs: 1 },
    status: "complete",
    domains,
    unassigned,
  };
}

describe("domain filing, criterion 1 — the request names, for a screen, the domains of other cards that share a word with it", () => {
  it("names the domain of the base that holds the table of its word, and neither another domain nor its own card", () => {
    const cards = new Map([
      [
        "orders-db",
        card("orders-db", "postgresql", [
          {
            id: "ordering",
            label: "Ordering",
            description: "Orders.",
            items: [
              { name: "public.orders", summary: "The orders." },
              { name: "public.order_lines", summary: "Their lines." },
            ],
          },
          { id: "billing", label: "Billing", description: "Invoices.", items: [{ name: "public.invoices", summary: "The invoices." }] },
        ]),
      ],
      [
        "storefront",
        card(
          "storefront",
          "web",
          [
            {
              id: "browsing",
              label: "Browsing",
              description: "Screens.",
              items: [
                { name: "/", summary: "Home." },
                { name: "/orders/:id", summary: "An order." },
                { name: "/categories", summary: "Categories." },
              ],
            },
          ],
          ["/invoices"],
        ),
      ],
    ]);
    const inventory = new Map([
      ["orders-db", ["public.orders", "public.order_lines", "public.invoices"]],
      ["storefront", ["/", "/orders/:id", "/categories", "/invoices"]],
    ]);
    const sources: RunSource[] = [{ id: "storefront", type: "web", uiUrl: "http://127.0.0.1:1" }];
    const request = cartographyRequest("local", sources, cards, inventory).split("\n");
    assert.ok(request.includes("  - /orders/:id: An order. — shares words with orders-db › ordering"), request.join("\n"));
    assert.ok(request.includes("  - /categories: Categories."));
    assert.ok(request.includes("- Unassigned: /invoices") && request.includes("  - /invoices — shares words with orders-db › billing"));
  });
});

describe("domain filing, criterion 2 — a domain of one type of source is refused when another domain shares a word with it", () => {
  it("refuses a domain of screens only, which names it, while another shares the word of a screen", () => {
    const screens = domain("screens", [{ source: "storefront", items: ["/", "/orders/:id", "/categories", "/address"] }]);
    const errors = errorsOf({ domains: [ORDERS, CUSTOMERS, screens], unassigned: REST.filter((r) => r.source !== "storefront") });
    assert.deepEqual(errors, [
      "The domain screens holds only screens, although the domain orders shares words with them (order); put each in the domain of its functional area.",
    ]);
  });

  it("accepts a domain of one type of source that shares no word with another, and the schema of tables is no shared word", () => {
    const health = domain("health", [{ source: "orders-api", items: ["/health"] }]);
    const billing = domain("billing", [{ source: "orders-db", items: ["public.invoices"] }]);
    assert.deepEqual(errorsOf({ domains: [ORDERS, CUSTOMERS, health, billing], unassigned: REST.slice(2) }), []);
  });

  it("refuses a domain of screens that all begin with the word of a table, next to the domain of that table", () => {
    const inventory = new Map([
      ["spec", ["Order returns"]],
      ["db", ["shop.orders", "shop.customers"]],
      ["web", ["/orders/new", "/orders/list"]],
    ]);
    const types = new Map<string, IndexSourceType>([
      ["spec", "document"],
      ["db", "postgresql"],
      ["web", "web"],
    ]);
    const orders = domain("orders", [
      { source: "db", items: ["shop.orders"] },
      { source: "spec", items: ["Order returns"] },
    ]);
    const screens = domain("screens", [{ source: "web", items: ["/orders/new", "/orders/list"] }]);
    const { errors } = domainIndexRules(inventory, types, () => true, []).check({
      domains: [orders, screens],
      unassigned: [{ source: "db", items: ["shop.customers"] }],
    });
    assert.deepEqual(
      errors.map((error) => error.message),
      ["The domain screens holds only screens, although the domain orders shares words with them (order); put each in the domain of its functional area."],
    );
  });

  it("reads a plural as its singular, addresses as address", () => {
    const addresses = domain("addresses", [{ source: "storefront", items: ["/address"] }]);
    const errors = errorsOf({
      domains: [ORDERS, CUSTOMERS, addresses],
      unassigned: REST.map((r) => (r.source === "storefront" ? { ...r, items: r.items.filter((item) => item !== "/address") } : r)),
    });
    assert.deepEqual(errors, [
      "The domain addresses holds only screens, although the domain customers shares words with them (address); put each in the domain of its functional area.",
    ]);
  });

  it("leaves to the placement errors a domain of elements no card holds", () => {
    const ghosts = domain("ghosts", [{ source: "elsewhere", items: ["orders"] }]);
    const empty = domain("empty", [{ source: "empty", items: ["orders"] }]);
    const errors = errorsOf({ domains: [ORDERS, CUSTOMERS, ghosts, empty], unassigned: REST });
    assert.deepEqual(errors, [
      "/domains/2/references/0/source names elsewhere, which is not a source of this run.",
      "/domains/3/references/0/items/0: orders is not an item of empty; use one of the items listed for it.",
    ]);
  });
});

describe("domain filing — a domain made of sections of the structure of documents is refused", () => {
  it("refuses it even when no other domain shares a word with it, and accepts a section of the application on its own", () => {
    const structure = domain("open-points", [{ source: "order-specs", items: ["Purpose", "Open points", "Acceptance criteria"] }]);
    const rest = REST.map((r) => (r.source === "order-specs" ? { ...r, items: ["§2"] } : r));
    assert.deepEqual(errorsOf({ domains: [ORDERS, CUSTOMERS, structure], unassigned: rest }), [
      "The domain open-points holds only sections of the structure of documents (purpose, scope, acceptance criteria, open points…), which are no functional area; put each in the domain it is about, or in unassigned.",
    ]);
    const numbered = domain("numbered", [{ source: "order-specs", items: ["§2"] }]);
    assert.deepEqual(
      errorsOf({
        domains: [ORDERS, CUSTOMERS, numbered],
        unassigned: REST.map((r) => (r.source === "order-specs" ? { ...r, items: ["Purpose", "Open points", "Acceptance criteria"] } : r)),
      }),
      [],
    );
  });
});

describe("domain filing, criterion 4 — an element both in a domain and in unassigned is refused", () => {
  it("names the element", () => {
    const errors = errorsOf({ domains: [ORDERS, CUSTOMERS], unassigned: [...REST, { source: "orders-db", items: ["public.orders"] }] });
    assert.deepEqual(errors, ["public.orders of orders-db is both in a domain and in unassigned; it is one or the other."]);
  });
});

describe("domain filing — the second submission", () => {
  it("is asked for the elements left in unassigned, each with the domains that share a word with it", () => {
    const followUp = rules().followUp!({ domains: [ORDERS, CUSTOMERS], unassigned: REST })!;
    const lines = followUp.request.split("\n");
    assert.match(lines[0]!, /put each in the domain of the index it belongs to, repeating its id, label and description, or in a new domain/);
    assert.ok(
      lines.includes("- storefront: /orders/:id — shares words with the domains orders") &&
        lines.includes("- storefront: /address — shares words with the domains customers") &&
        lines.includes("- orders-api: /health"),
      followUp.request,
    );
    assert.equal(followUp.asked, "The index leaves 10 of its 17 elements in unassigned; a second submission limited to them was asked.");
    assert.equal(rules().followUp!({ domains: [ORDERS, CUSTOMERS, domain("rest", REST)], unassigned: [] }), undefined);
  });

  it("leaves out an element already placed, and refuses an unknown one and a new domain that breaks the rules of the first", () => {
    const followUp = rules().followUp!({ domains: [ORDERS, CUSTOMERS], unassigned: REST })!;
    // An error names the place of the element as the second submission gives it, after a domain it repeats whole.
    const again = followUp.check({
      domains: [
        CUSTOMERS,
        domain("orders", [{ source: "orders-db", items: ["public.orders", "public.nowhere"] }]),
        domain("screens", [{ source: "storefront", items: ["/orders/:id"] }]),
      ],
      unassigned: REST.map((r) => ({ ...r, items: r.items.filter((item) => item !== "/orders/:id") })),
    });
    assert.deepEqual(
      again.errors.map((error) => error.message),
      [
        "/domains/1/references/0/items/1: public.nowhere is not an item of orders-db; use one of the items listed for it.",
        "The domain screens holds only screens, although the domain orders shares words with them (order); put each in the domain of its functional area.",
      ],
    );
  });
});
