import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ExportedElement } from "@open-qa-stack/tools";
import { Journal } from "../src/common/journal.ts";
import { BatchPlacement, MAX_LINE_LENGTH, MAX_PLACEMENT_CALLS } from "../src/source-workflow/batch-placement.ts";
import { batchSummary, elementBatches, MAX_BATCH_ELEMENTS, MAX_SUMMARY_LENGTH } from "../src/source-workflow/element-batches.ts";
import { Grouping, MAX_DOMAIN_ELEMENTS } from "../src/source-workflow/grouping.ts";
import { batchRequest } from "../src/source-workflow/grouping-prompt.ts";

const SECRET = "postgresql://shop:s3cr3t-pw@127.0.0.1:5999/shop";
const ORDERS = { id: "orders", label: "Order management", description: "Orders placed by customers." };

const element = (name: string, more: Partial<ExportedElement> = {}): ExportedElement => ({
  name,
  kind: "table",
  summary: `table ${name}`,
  definition: "",
  fingerprint: "sha256:0",
  names: [],
  links: [],
  file: `tables/${name}.sql`,
  ...more,
});

/** A batch of the base `shop-db`, its grouping and its journal. */
function batchOf(names: readonly string[] = ["public.orders", "public.customers", "public.audit"], grouping = new Grouping()) {
  const journal = new Journal();
  const placement = new BatchPlacement({
    sourceId: "shop-db",
    label: "batch 1 of 2",
    batch: names.map((name) => element(name)),
    grouping,
    secrets: [SECRET],
    journal,
  });
  const call = async (args: unknown): Promise<string> => {
    const answer = (await placement.tool().execute(args)) as string | { error: string };
    return typeof answer === "string" ? answer : answer.error;
  };
  return { placement, grouping, call, journal: () => journal.entries().map((entry) => `${entry.level}: ${entry.message}`) };
}

const placed = (name: string, domain = "orders", role = "What it holds.") => ({ name, domain, role });

describe("the placement of a batch", () => {
  it("keeps every element placed in a new or a known domain, or set aside once confirmed, and is then closed", async () => {
    const { placement, grouping, call, journal } = batchOf();
    assert.equal(placement.closed, false);
    const answer = await call({
      domains: [ORDERS],
      items: [placed("public.orders"), placed("shop-db/public.customers", "orders", "Who\n  buys."), placed("shop-db:public.audit")],
    });
    assert.equal(answer, "The 3 elements of this batch are settled. Answer with one word; call no more tools.");
    assert.deepEqual(
      [placement.closed, grouping.domains(), grouping.members("orders")],
      [true, [ORDERS], ["public.orders", "public.customers", "public.audit"]],
    );
    assert.deepEqual(grouping.state("public.customers"), { domain: "orders", role: "Who buys." });
    assert.deepEqual(journal(), ["info: Every element of batch 1 of 2 is placed."]);
    assert.equal(await call({ items: [placed("public.orders", "other")] }), "This batch is over. Call no more tools.");
    assert.equal(placement.reminder(), undefined);
  });

  it("refuses a call that breaks the schema, with what is still to place and an example", async () => {
    const { call, journal } = batchOf();
    assert.equal(
      await call({ items: [] }),
      [
        "0 of 3 elements are settled. Fix what follows and call place_elements again with the elements still to place only.",
        "- /items must NOT have fewer than 1 items.",
        'Still to place: ["public.orders","public.customers","public.audit"]',
        'Example: {"items":[{"name":"public.orders","domain":"orders","role":"One line on what it holds."}]}',
      ].join("\n"),
    );
    assert.deepEqual(journal(), ["error: The placement of batch 1 of 2 was not kept as it is: /items must NOT have fewer than 1 items."]);
  });

  it("keeps the elements placed validly and names only the others: unknown, given twice, in neither form or in both", async () => {
    const { grouping, call } = batchOf();
    const answer = await call({
      domains: [ORDERS],
      items: [
        placed("public.orders"),
        placed("public.orders", "orders", "Again."),
        placed("public.invoices"),
        { name: "public.customers", domain: "orders" },
        { name: "public.audit", domain: "orders", role: "Audit.", reason: "Technical." },
      ],
    });
    assert.deepEqual(answer.split("\n").slice(0, 6), [
      "1 of 3 elements are settled. Fix what follows and call place_elements again with the elements still to place only.",
      "- public.orders is given twice; the first was read. Give each element once.",
      "- public.invoices is not an element of this batch. Use the names of the ### lines only.",
      "- public.customers needs either a domain and a role, or a reason alone.",
      "- public.audit needs either a domain and a role, or a reason alone.",
      'Still to place: ["public.customers","public.audit"]',
    ]);
    assert.ok(answer.endsWith('Example: {"items":[{"name":"public.customers","domain":"orders","role":"One line on what it holds."}]}'));
    assert.deepEqual(grouping.state("public.orders"), { domain: "orders", role: "What it holds." });
    assert.equal(
      await call({ items: [placed("public.orders", "nowhere"), placed("public.customers"), placed("public.audit")] }),
      "The 3 elements of this batch are settled. Answer with one word; call no more tools.",
    );
    assert.deepEqual(grouping.state("public.orders"), { domain: "orders", role: "What it holds." });
  });

  it("refuses a domain that does not exist, and proposes the domain whose id or label was meant", async () => {
    const { grouping, call } = batchOf();
    assert.match(
      await batchOf().call({ items: [placed("public.orders", "sales")] }),
      /- public\.orders: the domain "sales" does not exist\. Declare it in domains with an id, a label and a description\.\n/,
    );
    const answer = await call({
      domains: [ORDERS],
      items: [placed("public.orders"), placed("public.customers", "Orders"), placed("public.audit", "order management")],
    });
    assert.ok(
      answer.includes('- public.customers: "Orders" is not a domain id. Proposed: "orders". If it suits you, place public.customers again with that id.'),
    );
    assert.ok(
      answer.includes('- public.audit: "order management" is not a domain id. Proposed: "orders". If it suits you, place public.audit again with that id.'),
    );
    assert.equal(grouping.state("public.customers"), undefined, "the harness does not apply its proposal itself");
    assert.match(
      await call({ items: [placed("public.customers", "sales")] }),
      /the domain "sales" does not exist\. Declare it in domains with an id, a label and a description, or use one of orders\./,
    );
  });

  it("proposes a slug for a domain id that is none, and another label or the known domain for a label already taken", async () => {
    const grouping = new Grouping();
    grouping.place("public.products", ORDERS, "Products.");
    const { call } = batchOf(undefined, grouping);
    const answer = await call({
      domains: [
        { id: "Order Returns", label: "Returns", description: "Orders sent back." },
        { id: "§", label: "Other", description: "Other." },
        { id: "ordering", label: "order MANAGEMENT", description: "Twin." },
        { id: "orders", label: "Ignored", description: "A known domain declared again is left as it is." },
      ],
      items: [placed("public.orders", "Order Returns"), placed("public.customers", "ordering"), placed("public.audit", "orders")],
    });
    assert.deepEqual(answer.split("\n").slice(1, 6), [
      '- The domain id "Order Returns" is not a slug. Proposed: "order-returns". If it suits you, declare the domain and place its elements again with that id.',
      '- The domain id "§" is not a slug. Write lower case letters and digits separated by hyphens, such as "order-returns".',
      "- The domain ordering has the label of the domain orders. Proposed: place its elements in orders. If it is another area, give it another label.",
      '- public.orders: its domain "Order Returns" was not created, for the reason given above.',
      '- public.customers: its domain "ordering" was not created, for the reason given above.',
    ]);
    assert.deepEqual(grouping.domains(), [ORDERS]);
    assert.deepEqual(grouping.members("orders"), ["public.products", "public.audit"]);
  });

  it("refuses a role, a reason, a label or a description that is empty, too long or holds a secret, without repeating the secret", async () => {
    const { call, journal } = batchOf();
    const long = "x".repeat(MAX_LINE_LENGTH + 1);
    const answer = await call({
      domains: [{ id: "a", label: long, description: "A." }, { id: "b", label: "B", description: `Read with ${SECRET}.` }, ORDERS],
      items: [
        placed("public.orders", "orders", "  \n "),
        placed("public.customers", "orders", long),
        { name: "public.audit", reason: `See ${encodeURIComponent(SECRET)}` },
      ],
    });
    assert.deepEqual(answer.split("\n").slice(1, 6), [
      `- The label of the domain a has ${MAX_LINE_LENGTH + 1} characters. Keep it under ${MAX_LINE_LENGTH}, such as "Orders placed by customers, one row each."`,
      "- The description of the domain b holds a secret of the configuration. Write it without the secret.",
      "- The role of public.orders is empty. Write one line.",
      `- The role of public.customers has ${MAX_LINE_LENGTH + 1} characters. Keep it under ${MAX_LINE_LENGTH}, such as "Orders placed by customers, one row each."`,
      "- The reason of public.audit holds a secret of the configuration. Write it without the secret.",
    ]);
    assert.ok(![answer, ...journal()].some((text) => text.includes("s3cr3t-pw")));
    assert.match(await call({ items: [placed(`public.${SECRET}`)] }), /- public\.\[secret\] is not an element of this batch\./);
  });

  it("refuses to place an element in a full domain, the elements of the call counted", async () => {
    const names = Array.from({ length: MAX_DOMAIN_ELEMENTS + 1 }, (_, i) => `public.t${i}`);
    const { grouping, call } = batchOf(names);
    const answer = await call({ domains: [ORDERS], items: names.map((name) => placed(name)) });
    assert.ok(answer.startsWith(`${MAX_DOMAIN_ELEMENTS} of ${MAX_DOMAIN_ELEMENTS + 1} elements are settled.`));
    assert.ok(
      answer.includes(
        `- public.t${MAX_DOMAIN_ELEMENTS}: the domain orders is full, with ${MAX_DOMAIN_ELEMENTS} elements. Place it in another domain, or declare a narrower one, such as "orders-history".`,
      ),
    );
    assert.equal(grouping.isFull("orders"), true);
    const next = batchOf(["public.late"], grouping);
    assert.match(await next.call({ items: [placed("public.late")] }), /the domain orders is full/);
  });

  it("warns once when elements are set aside, and sets them aside when the model gives them again", async () => {
    const { grouping, call } = batchOf();
    const aside = { name: "public.audit", reason: "A technical\nlog." };
    const answer = await call({ domains: [ORDERS], items: [placed("public.orders"), aside] });
    assert.ok(
      answer.includes(
        "- You set aside public.audit. An element set aside is in no domain, and no agent will find it by domain. If that is what you mean, give them again the same way; otherwise place them.",
      ),
    );
    assert.equal(grouping.state("public.audit"), undefined);
    assert.equal(
      await call({ items: [aside, { name: "public.customers", reason: "Unused." }] }),
      "The 3 elements of this batch are settled. Answer with one word; call no more tools.",
    );
    assert.deepEqual([grouping.state("public.audit"), grouping.state("public.customers")], [{ dismissed: "A technical log." }, { dismissed: "Unused." }]);
    assert.deepEqual([grouping.isSettled("public.audit"), grouping.isSettled("public.missing")], [true, false]);
  });

  it(`closes the batch after ${MAX_PLACEMENT_CALLS} calls: what is left is unplaced, with what was last said of it`, async () => {
    const { placement, grouping, call, journal } = batchOf();
    await call({ items: [placed("public.orders", "sales"), { name: "public.audit", reason: "Technical." }] });
    await call({ items: [placed("public.orders", "sales")] });
    assert.equal(
      await call({ items: [placed("public.orders", "sales")] }),
      "This batch is closed: 3 elements stay unplaced and will be asked again later. Call no more tools.",
    );
    assert.equal(placement.closed, true);
    assert.deepEqual(
      [grouping.state("public.orders"), grouping.state("public.customers"), grouping.state("public.audit")],
      [
        { unplaced: 'public.orders: the domain "sales" does not exist. Declare it in domains with an id, a label and a description.' },
        { unplaced: `The model had ${MAX_PLACEMENT_CALLS} calls.` },
        { unplaced: "The model set it aside and did not confirm." },
      ],
    );
    assert.equal(grouping.isSettled("public.orders"), false);
    assert.equal(
      journal().at(-1),
      `error: batch 1 of 2 was closed with 3 elements unplaced: public.orders, public.customers, public.audit. The model had ${MAX_PLACEMENT_CALLS} calls.`,
    );
    assert.equal(await call({ items: [placed("public.orders")] }), "This batch is over. Call no more tools.");
  });

  it("reminds the model of what is left, and leaves it unplaced when the session ends", () => {
    const { placement, grouping, journal } = batchOf(["public.orders"]);
    assert.equal(placement.reminder(), '1 elements of this batch are not placed yet: ["public.orders"]. Call place_elements with them now.');
    placement.close("The session ended before they were placed.");
    assert.deepEqual(grouping.state("public.orders"), { unplaced: "The session ended before they were placed." });
    assert.deepEqual(journal(), [
      "info: The model stopped with 1 elements of batch 1 of 2 to place; it was reminded to place them.",
      "error: batch 1 of 2 was closed with 1 elements unplaced: public.orders. The session ended before they were placed.",
    ]);
    assert.equal(placement.reminder(), undefined);
  });
});

describe("the batches of a source", () => {
  it("keeps the order of the export, and closes a batch at its number of elements", () => {
    const elements = Array.from({ length: MAX_BATCH_ELEMENTS + 1 }, (_, i) => element(`public.t${i}`));
    const batches = elementBatches(elements);
    assert.deepEqual(
      batches.map((batch) => batch.length),
      [MAX_BATCH_ELEMENTS, 1],
    );
    assert.deepEqual(batches.flat(), elements);
    assert.deepEqual(elementBatches([]), []);
  });

  it("closes a batch before the element that would take its summaries past the bound, and cuts a long summary with where to read the rest", () => {
    const long = element("public.wide", { summary: "c".repeat(MAX_SUMMARY_LENGTH + 40) });
    assert.equal(batchSummary(long), `${"c".repeat(MAX_SUMMARY_LENGTH)}… [40 more characters, in export/tables/public.wide.sql]`);
    assert.equal(batchSummary(element("public.small")), "table public.small");
    const batches = elementBatches(Array.from({ length: 14 }, () => long));
    assert.deepEqual(
      batches.map((batch) => batch.length),
      [12, 2],
    );
  });
});

describe("the request of a batch", () => {
  it("lists the domains so far with their count and examples, marks a full one, and tells where the elements linked to each element are", () => {
    const grouping = new Grouping();
    for (let i = 0; i < MAX_DOMAIN_ELEMENTS; i++) grouping.place(`public.o${i}`, ORDERS, "An order table.");
    grouping.place("public.customers", { id: "customers", label: "Customers", description: "The customers." }, "A customer.");
    grouping.dismiss("public.audit", "Technical.");
    // A domain an earlier run left, which holds no element yet, and an element that changed since it was placed there.
    grouping.remember({ id: "returns", label: "Returns", description: "Orders sent back." });
    const former = new Map([["public.payments", "returns"]]);
    const batch = [element("public.invoices", { links: ["public.customers", "public.audit", "public.unknown"] }), element("public.payments")];
    assert.equal(
      batchRequest("shop-db", 2, 3, batch, grouping, former),
      [
        "Batch 2 of 3 of the source shop-db.",
        "",
        "Domains so far:",
        `- orders — Order management: Orders placed by customers. (${MAX_DOMAIN_ELEMENTS} placed, full: place nothing more in it; such as public.o0, public.o1, public.o2)`,
        "- customers — Customers: The customers. (1 placed; such as public.customers)",
        "- returns — Returns: Orders sent back. (0 placed)",
        "",
        "The 2 elements to place, each named by its ### line:",
        "",
        "### public.invoices",
        "table public.invoices",
        "Linked: public.customers is in customers.",
        "",
        "### public.payments",
        "table public.payments",
        "It changed since it was placed in returns.",
        "",
        "Call place_elements with these 2 elements.",
      ].join("\n"),
    );
  });
});
