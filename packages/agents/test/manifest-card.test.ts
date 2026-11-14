import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateSourceCard, validateSourceManifest } from "@open-qa-stack/shared";
import type { ExportedElement, SourceExport, SourceInventory } from "@open-qa-stack/tools";
import { exportManifest } from "../src/source-workflow/export-manifest.ts";
import { Grouping } from "../src/source-workflow/grouping.ts";
import { manifestCard } from "../src/source-workflow/manifest-card.ts";

const AT = new Date("2026-11-13T03:00:00.000Z");
const SOURCE = { id: "shop-db", type: "postgresql" } as const;
const ORDERS = { id: "orders", label: "Orders", description: "Orders placed by customers." };
const BILLING = { id: "billing", label: "Billing", description: "What is charged." };
const MODEL = { provider: "openai", baseUrl: "http://127.0.0.1:1/v1", model: "local-model" };

const element = (name: string, kind: string): ExportedElement => ({
  name,
  kind,
  summary: `${kind} ${name}`,
  definition: "",
  fingerprint: `sha256:${name}`,
  names: [],
  links: [],
  file: `${kind}s/${name}.sql`,
});

const EXPORTED: SourceExport = {
  elements: [
    element("public.orders", "table"),
    element("public.audit", "table"),
    element("public.late", "table"),
    element("public.open_orders", "view"),
    element("public.charge()", "routine"),
  ],
  fingerprint: "sha256:all",
};
const INVENTORY: SourceInventory = {
  items: ["public.orders", "public.audit", "public.late", "public.open_orders"],
  facts: new Map([["public.orders", { kind: "table", columns: 3 }]]),
  fingerprint: "sha256:all",
  export: EXPORTED,
};

describe("the manifest of a source, as its grouping stands", () => {
  it("is in progress while an element is not settled, complete once each is in a domain or set aside, truncated when one is unplaced or the source was read in part", () => {
    const grouping = new Grouping();
    assert.equal(exportManifest(SOURCE, EXPORTED, grouping, false, AT).status, "in_progress");
    grouping.place("public.orders", ORDERS, "One order.");
    grouping.place("public.open_orders", ORDERS, "The orders still open.");
    grouping.place("public.charge()", BILLING, "Charges an order.");
    grouping.dismiss("public.audit", "Technical.");
    assert.equal(exportManifest(SOURCE, EXPORTED, grouping, false, AT).status, "in_progress");
    grouping.leave("public.late", "The model had 3 calls.");
    const truncated = exportManifest(SOURCE, EXPORTED, grouping, false, AT);
    assert.deepEqual(validateSourceManifest(truncated), { ok: true, value: truncated });
    assert.deepEqual([truncated.status, truncated.domains], ["truncated", [ORDERS, BILLING]]);
    assert.deepEqual(truncated.elements, [
      {
        name: "public.orders",
        kind: "table",
        fingerprint: "sha256:public.orders",
        file: "export/tables/public.orders.sql",
        domain: "orders",
        role: "One order.",
      },
      { name: "public.audit", kind: "table", fingerprint: "sha256:public.audit", file: "export/tables/public.audit.sql", dismissed: "Technical." },
      { name: "public.late", kind: "table", fingerprint: "sha256:public.late", file: "export/tables/public.late.sql", unplaced: "The model had 3 calls." },
      {
        name: "public.open_orders",
        kind: "view",
        fingerprint: "sha256:public.open_orders",
        file: "export/views/public.open_orders.sql",
        domain: "orders",
        role: "The orders still open.",
      },
      {
        name: "public.charge()",
        kind: "routine",
        fingerprint: "sha256:public.charge()",
        file: "export/routines/public.charge().sql",
        domain: "billing",
        role: "Charges an order.",
      },
    ]);
    grouping.dismiss("public.late", "Unused.");
    assert.equal(exportManifest(SOURCE, EXPORTED, grouping, false, AT).status, "complete");
    assert.equal(exportManifest(SOURCE, EXPORTED, grouping, true, AT).status, "truncated");
  });
});

describe("the card derived from the manifest of a source", () => {
  it("holds the tables and views only, by domain with their role and facts, and leaves the others unassigned", () => {
    const grouping = new Grouping();
    grouping.place("public.orders", ORDERS, "One order.");
    grouping.place("public.open_orders", ORDERS, "The orders still open.");
    grouping.place("public.charge()", BILLING, "Charges an order.");
    grouping.dismiss("public.audit", "Technical.");
    grouping.leave("public.late", "The model had 3 calls.");
    const run = { iterations: 2, actions: 0, durationMs: 40 };
    const card = manifestCard(exportManifest(SOURCE, EXPORTED, grouping, false, AT), INVENTORY, run, MODEL, AT);
    assert.deepEqual(validateSourceCard(card), { ok: true, value: card });
    assert.deepEqual(card, {
      formatVersion: 1,
      source: SOURCE,
      fingerprint: "sha256:all",
      producedAt: "2026-11-13T03:00:00.000Z",
      model: MODEL,
      run,
      status: "truncated",
      domains: [
        {
          ...ORDERS,
          items: [
            { name: "public.orders", summary: "One order.", facts: { kind: "table", columns: 3 } },
            { name: "public.open_orders", summary: "The orders still open.", facts: {} },
          ],
        },
      ],
      unassigned: ["public.audit", "public.late"],
    });
    grouping.dismiss("public.late", "Unused.");
    assert.equal(manifestCard(exportManifest(SOURCE, EXPORTED, grouping, false, AT), INVENTORY, run, MODEL, AT).status, "complete");
  });
});
