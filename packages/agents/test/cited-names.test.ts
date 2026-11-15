import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ExportedElement, SourceExport } from "@open-qa-stack/tools";
import { citedNameProblems, cites, exportVocabulary } from "../src/source-workflow/cited-names.ts";
import { coverageErrors, domainFileErrors } from "../src/source-workflow/domain-file-control.ts";

const element = (name: string, kind: string, names: readonly string[], definition: string): ExportedElement => ({
  name,
  kind,
  summary: `${kind} ${name}`,
  definition,
  fingerprint: "sha256:0",
  names,
  links: [],
  file: `${kind}s/${name}.sql`,
});

const EXPORTED: SourceExport = {
  elements: [
    element(
      "public.orders",
      "table",
      ["id", "customer_id", "Status"],
      "CREATE TABLE public.orders (\n  id bigint,\n  customer_id bigint,\n  Status public.order_status DEFAULT 'open'::public.order_status\n);",
    ),
    element(
      "public.customers",
      "table",
      ["id", "email"],
      "CREATE TABLE public.customers (\n  id bigint,\n  email text\n);\n\nCREATE INDEX customers_email_idx ON public.customers USING btree (email);",
    ),
    element("archive.orders", "table", ["id"], "CREATE TABLE archive.orders (\n  id bigint\n);"),
    element("public.empty", "table", [], "CREATE TABLE public.empty (\n);"),
    element("public.open_orders", "view", ["id"], "CREATE VIEW public.open_orders AS\n SELECT o.id\n   FROM orders o\n  WHERE o.status = 'open';"),
    element(
      "public.order_total(order_id bigint)",
      "routine",
      ["order_id"],
      "CREATE OR REPLACE FUNCTION public.order_total(order_id bigint)\n RETURNS numeric\n LANGUAGE sql\nRETURN 1",
    ),
  ],
  fingerprint: "sha256:1",
};
const VOCABULARY = exportVocabulary("shop-db", EXPORTED);
const problems = (body: string) => citedNameProblems(body, VOCABULARY);
const NONE = { errors: [], warnings: [] };

describe("the names a domain file cites", () => {
  it("accepts the elements of the source, of this domain or another, their columns, and what a definition names, whatever the case and the quotes", () => {
    const body = [
      "Read `public.orders` by `public.orders.status` or `customer_id`; its type is `public.order_status`.",
      'See also `archive.orders`, `PUBLIC.Customers`, `"public"."orders"."Status"`, `public.customers.email` and `customers_email_idx`.',
      "The view `public.open_orders` and the function `public.order_total(order_id bigint)`, or `public.order_total()`.",
      "",
      "```sql",
      "SELECT o.id, c.email, public.order_total(o.id) AS total",
      "  FROM public.orders o JOIN public.customers c ON c.id = o.customer_id",
      " WHERE o.status = 'open' AND c.email LIKE '%@example.org';",
      "```",
      "Types such as `bigint`, values such as `NULL` or `'open'`, and prose such as `e.g.` or `orders.md` of another kind are not names of the source.",
    ].join("\n");
    assert.deepEqual(problems(body), {
      errors: [],
      warnings: [
        "orders.md: orders has no column md. Its columns: id, customer_id, Status, id. If orders is not that relation here, answer again with the same body to confirm.",
      ],
    });
    assert.deepEqual(problems(body.replace(" or `orders.md` of another kind", "")), NONE);
    assert.deepEqual(problems("`public.empty.anything` has no column the catalog knows."), NONE);
  });

  it("refuses a table the source does not have, in the text or in an example query, and proposes the one of that name in another schema", () => {
    assert.deepEqual(problems("Join `public.invoices` to the orders."), {
      errors: ["public.invoices is not an element of shop-db, and nothing in its export has this name. Remove it, or use a name the request shows."],
      warnings: [],
    });
    const query = "```sql\nSELECT * FROM public.invoices i JOIN archive.customers c ON c.id = i.customer_id;\nSELECT * FROM Public.Invoices;\n```";
    assert.deepEqual(problems(query).errors, [
      "public.invoices is not an element of shop-db, and nothing in its export has this name. Remove it, or use a name the request shows.",
      "archive.customers is not an element of shop-db, and nothing in its export has this name. Proposed: `public.customers`.",
      "Public.Invoices is not an element of shop-db, and nothing in its export has this name. Remove it, or use a name the request shows.",
    ]);
    assert.deepEqual(problems("`archive.order_total` and `public.orders_archive.id`").errors, [
      "archive.order_total is not an element of shop-db, and nothing in its export has this name. Proposed: `public.order_total(order_id bigint)`.",
      "public.orders_archive is not an element of shop-db, and nothing in its export has this name. Remove it, or use a name the request shows.",
    ]);
  });

  it("refuses a column a table does not have when the table is written with its schema, and only warns when it is not", () => {
    assert.deepEqual(problems("Filter on `public.orders.total` or `public.open_orders.status`."), {
      errors: [
        "public.orders.total: public.orders has no column total. Its columns: id, customer_id, Status.",
        "public.open_orders.status: public.open_orders has no column status. Its columns: id.",
      ],
      warnings: [],
    });
    assert.deepEqual(problems("```sql\nSELECT customers.phone FROM customers;\n```"), {
      errors: [],
      warnings: [
        "customers.phone: customers has no column phone. Its columns: id, email. If customers is not that relation here, answer again with the same body to confirm.",
      ],
    });
  });

  it("warns of a lone name of several words the export writes nowhere, each once", () => {
    assert.deepEqual(problems("Filter on `customer_ref`, then `customer_ref` again, or on `in_progress`; `customer_id` and `Customer_Ref` are left alone."), {
      errors: [],
      warnings: [
        "The export of shop-db writes these names nowhere: `customer_ref`, `in_progress`. If they are columns or elements, use the names the request shows. If they are something else, answer again with the same body to confirm.",
      ],
    });
  });
});

describe("the citation of an element", () => {
  it("is its exact name between backticks, or, with arguments, its name without them", () => {
    const routine = "public.order_total(order_id bigint)";
    assert.deepEqual(
      ["`public.order_total(order_id bigint)`", "`public.order_total`", "`public.order_total()`", "public.order_total", "`order_total`"].map((text) =>
        cites(text, routine),
      ),
      [true, true, true, false, false],
    );
    assert.deepEqual([cites("`public.orders`", "public.orders"), cites("`public.orders_archive`", "public.orders")], [true, false]);
    const members = [{ name: routine, kind: "routine", role: "Adds up an order." }];
    assert.deepEqual(domainFileErrors("Call `public.order_total` for the total.", members, []), []);
    assert.deepEqual(domainFileErrors("Call public.order_total for the total.", members, []), [
      "These elements of the domain are not named: public.order_total(order_id bigint). Name each exactly as written, between backticks, such as `public.order_total(order_id bigint)`.",
    ]);
    const manifest = {
      formatVersion: 1 as const,
      source: { id: "shop-db", type: "postgresql" as const },
      fingerprint: "sha256:1",
      producedAt: "2026-11-13T03:00:00.000Z",
      status: "in_progress" as const,
      domains: [{ id: "orders", label: "Orders", description: "Orders." }],
      elements: [{ name: routine, kind: "routine", fingerprint: "sha256:0", file: "export/routines/x.sql", domain: "orders", role: "Adds up an order." }],
    };
    assert.deepEqual(coverageErrors(manifest, new Map([["orders", "Call `public.order_total()`."]])), []);
  });

  it("reads the names of a source whose elements have no schema", () => {
    const flat = exportVocabulary("specs", { elements: [element("Orders", "section", [], "")], fingerprint: "sha256:1" });
    assert.deepEqual([[...flat.schemas], [...flat.words], flat.elements.get("orders")], [[], ["orders", "section"], ["Orders"]]);
    assert.deepEqual(citedNameProblems("`public.orders` and `orders.total`", flat), NONE);
  });
});
