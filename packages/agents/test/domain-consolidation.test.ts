import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SourceCard } from "@open-qa-stack/shared";
import { cartographyRequest, CARTOGRAPHER_INSTRUCTIONS } from "../src/cartographer/cartographer-prompt.ts";
import { DomainConsolidation } from "../src/cartographer/domain-consolidation.ts";
import { sourceDomainTool } from "../src/cartographer/source-domain-tool.ts";
import { Journal } from "../src/common/journal.ts";

/** The card of a source, from the elements of each of its domains and those its agent set aside. */
function card(id: string, type: SourceCard["source"]["type"], domains: Readonly<Record<string, readonly string[]>>, unassigned: string[] = []): SourceCard {
  return {
    formatVersion: 1,
    source: { id, type },
    fingerprint: "sha256:0",
    producedAt: "2026-01-05T10:00:00.000Z",
    model: { provider: "openai", baseUrl: "http://127.0.0.1:1/v1", model: "m" },
    run: { iterations: 1, actions: 1, durationMs: 1 },
    status: "complete",
    domains: Object.entries(domains).map(([domain, items]) => ({
      id: domain,
      label: `${domain} of ${id}`,
      description: `What ${id} holds of ${domain}.`,
      items: items.map((name) => ({ name, summary: `About ${name}.`, facts: {} })),
    })),
    unassigned,
  };
}

const CARDS = new Map([
  ["shop-api", card("shop-api", "openapi", { orders: ["GET /orders", "POST /orders"], customers: ["GET /customers"] }, ["GET /health"])],
  ["shop-db", card("shop-db", "postgresql", { sales: ["public.orders", "public.customers"] }, ["public.schema_migrations"])],
  ["shop", card("shop", "web", { orders: ["/orders"] })],
]);
const ORDERS = { id: "orders", label: "Orders", description: "Placing and following an order." };
const CUSTOMERS = { id: "customers", label: "Customers", description: "The customers of the shop." };
const from = (source: string, domain: string, items?: readonly string[]) => ({ source, domain, ...(items === undefined ? {} : { items }) });

type Told = string | { error: string };
function consolidation(secrets: readonly string[] = []) {
  const journal = new Journal();
  const made = new DomainConsolidation(CARDS, secrets, journal);
  const submit = (args: unknown) => made.tool().execute(args) as Promise<Told>;
  return { made, journal, submit };
}
const ACCEPTED = "The index was accepted. Answer with one sentence that sums it up; call no more tools.";
const refusal = (...lines: string[]) => ({ error: ["The index was refused. Fix it and submit it again.", ...lines].join("\n") });
const STILL = "Still in no domain of the application; give each in from, to the domain it belongs to or to one of its own:";

describe("the domains of an application, consolidated from those of its sources", () => {
  it("gathers the domains of the sources into those of the application, their elements following, cuts one between two, and keeps aside what the sources set aside", async () => {
    const { made, journal, submit } = consolidation();
    // The base has one domain for the orders and the customers: it is cut, the part that names no element taking the rest.
    const domains = [
      { ...ORDERS, from: [from("shop-api", "orders"), from("shop-db", "sales"), from("shop", "orders")] },
      { ...CUSTOMERS, from: [from("shop-api", "customers"), from("shop-db", "sales", ["public.customers"])] },
    ];
    assert.equal(await submit({ domains }), ACCEPTED);
    assert.deepEqual(made.accepted, {
      domains: [
        {
          ...ORDERS,
          references: [
            { source: "shop-api", items: ["GET /orders", "POST /orders"] },
            { source: "shop-db", items: ["public.orders"] },
            { source: "shop", items: ["/orders"] },
          ],
        },
        {
          ...CUSTOMERS,
          references: [
            { source: "shop-api", items: ["GET /customers"] },
            { source: "shop-db", items: ["public.customers"] },
          ],
        },
      ],
      unassigned: [
        { source: "shop-api", items: ["GET /health"] },
        { source: "shop-db", items: ["public.schema_migrations"] },
      ],
    });
    assert.deepEqual(
      journal.entries().map((entry) => entry.message),
      ["The index was accepted."],
    );
    // Two domains of one source gathered in one domain of the application are one reference to that source.
    const one = consolidation();
    await one.submit({
      domains: [{ ...ORDERS, from: [from("shop-api", "orders"), from("shop-api", "customers"), from("shop-db", "sales"), from("shop", "orders")] }],
    });
    assert.deepEqual(one.made.accepted!.domains[0]!.references[0], { source: "shop-api", items: ["GET /orders", "POST /orders", "GET /customers"] });
    // A domain of a source cut by naming every one of its elements leaves nothing aside.
    const cut = consolidation();
    const whole = [
      { ...ORDERS, from: [from("shop-api", "orders"), from("shop", "orders"), from("shop-db", "sales", ["public.orders"])] },
      { ...CUSTOMERS, from: [from("shop-api", "customers"), from("shop-db", "sales", ["public.customers"])] },
    ];
    assert.equal(await cut.submit({ domains: whole }), ACCEPTED);
    // A domain taken whole once every element of it was named elsewhere brings nothing: it adds no reference, and a domain left with none is not written.
    const emptied = consolidation();
    const rest = { id: "sales", label: "Sales", description: "What is left of the sales." };
    assert.equal(await emptied.submit({ domains: [...whole, { ...rest, from: [from("shop-db", "sales")] }] }), ACCEPTED);
    assert.deepEqual(
      emptied.made.accepted!.domains.map((domain) => [domain.id, domain.references.map((reference) => reference.source)]),
      [
        ["orders", ["shop-api", "shop", "shop-db"]],
        ["customers", ["shop-api", "shop-db"]],
      ],
    );
    // Items that name nothing are refused: the whole domain is taken by leaving them out.
    const empty = (await consolidation().submit({ domains: [{ ...ORDERS, from: [from("shop-db", "sales", [])] }] })) as { error: string };
    assert.ok(
      empty.error.includes(
        "\n- domains/0: items of shop-db › sales is empty. Leave items out to take the whole domain, or name the elements this domain takes.",
      ),
      empty.error,
    );
    // A source mapped into no domain has none to give.
    const bare = new DomainConsolidation(new Map([["notes", card("notes", "document", {}, ["Changes"])]]), [], new Journal());
    assert.deepEqual(
      await bare.tool().execute({ domains: [{ id: "notes", label: 5, description: "Notes.", from: [from("notes", "all")] }] }),
      refusal("- domains/0: give its label on one line of 200 characters at most.", "- domains/0: notes has no domain all. Its domains: none."),
    );
    // Only the first index accepted is kept.
    assert.equal(await submit({ domains: [] }), "The index was already accepted; there is nothing more to do.");
    assert.equal(made.reminder(), undefined);
  });

  it("refuses what the cards do not bear, saying what to do, and names the domains of the sources left aside", async () => {
    const { made, journal, submit } = consolidation(["s3cr3t-token"]);
    assert.deepEqual(await submit({}), refusal("- Give in domains the domains of the application, one at least."));
    assert.deepEqual(await submit(null), refusal("- Give in domains the domains of the application, one at least."));
    assert.deepEqual(await submit({ domains: [] }), refusal("- Give in domains the domains of the application, one at least."));
    const domains = [
      { id: "Orders!", label: " ", description: "x".repeat(201), from: "none" },
      {
        ...ORDERS,
        from: [from("shop-api", "orders"), from("ledger", "orders"), from("shop", "sales"), from("shop-db", "sales", ["public.orders", "public.invoices"])],
      },
      { ...ORDERS, description: "Uses s3cr3t-token.", from: [from("shop-api", "orders"), from("shop-db", "sales", ["public.orders"])] },
    ];
    assert.deepEqual(
      await submit({ domains }),
      refusal(
        '- domains/0: the id "Orders!" is not a slug. Write lower case letters and digits separated by hyphens, such as "order-returns".',
        "- domains/0: give its label on one line of 200 characters at most.",
        "- domains/0: give its description on one line of 200 characters at most.",
        "- domains/0: give in from the domains of the sources that Orders! gathers.",
        "- domains/1: ledger is no source with a card. The sources: shop-api, shop-db, shop.",
        "- domains/1: shop has no domain sales. Its domains: orders.",
        "- domains/1: public.invoices is no element of the domain sales of shop-db. Write it exactly as the source names it.",
        "- domains/2: the id orders is given to several domains. Give them one domain, or two ids.",
        "- domains/2: public.orders of shop-db › sales is taken by two domains. An element is in one domain.",
        "- shop-api › orders is taken whole by two domains. Give it to one, or cut it by naming in items the elements each takes.",
        "- The index holds a secret of the configuration; write it without the secret.",
      ),
    );
    assert.ok(journal.entries().every((entry) => !entry.message.includes("s3cr3t-token")));
    // A submission that is right but for domains left aside names them, with the elements left of one that was cut.
    const partial = { domains: [{ ...ORDERS, from: [from("shop-api", "orders"), from("shop-db", "sales", ["public.orders"])] }] };
    const left = refusal(STILL, "- shop-api › customers", "- shop-db › sales: public.customers", "- shop › orders");
    assert.deepEqual(await submit(partial), left);
    assert.equal(journal.entries().at(-1)!.message, "The index was refused: 3 domains of the sources are in no domain of the application.");
    assert.equal(made.reminder(), `You have not handed in an accepted index yet. Call submit_index now.\n\n${left.error}`);
    assert.equal(made.accepted, undefined);
  });

  it("keeps each domain of a source left aside twice in a row as a domain of the application of its own, joined to the one that bears its identifier", async () => {
    const { made, journal, submit } = consolidation();
    assert.equal(made.reminder(), "You have not handed in an accepted index yet. Call submit_index now.");
    const partial = { domains: [{ ...ORDERS, from: [from("shop-api", "orders"), from("shop-db", "sales", ["public.orders"])] }] };
    await submit(partial);
    // A refusal for another reason in between starts the count again.
    await submit({ domains: [{ ...ORDERS, from: [from("ledger", "orders")] }] });
    assert.ok(typeof (await submit(partial)) === "object");
    assert.equal(await submit(partial), ACCEPTED);
    assert.deepEqual(
      made.accepted!.domains.map((domain) => [domain.id, domain.label, domain.references]),
      [
        [
          "orders",
          "Orders",
          [
            { source: "shop-api", items: ["GET /orders", "POST /orders"] },
            { source: "shop-db", items: ["public.orders"] },
            { source: "shop", items: ["/orders"] },
          ],
        ],
        ["customers", "customers of shop-api", [{ source: "shop-api", items: ["GET /customers"] }]],
        ["sales", "sales of shop-db", [{ source: "shop-db", items: ["public.customers"] }]],
      ],
    );
    assert.equal(
      journal.entries().at(-2)!.message,
      "2 submissions of the index in a row left domains of the sources aside; the harness kept each as a domain of the application: shop-api › customers, shop-db › sales, shop › orders.",
    );
  });
});

describe("what the orchestrator of the cartography is given, and reads", () => {
  it("is asked with the domains each source was mapped into, not their elements, and told how to consolidate them", () => {
    const sources = [
      { id: "shop-api", type: "openapi" },
      { id: "shop-db", type: "postgresql" },
      { id: "specs", type: "document" },
      { id: "notes", type: "document" },
    ] as never;
    const cards = new Map([...CARDS, ["notes", card("notes", "document", {})]]);
    assert.equal(
      cartographyRequest("local", sources, cards),
      [
        "Consolidate the domains of the application in the environment local. The domains each source was mapped into:",
        "## shop-api (openapi)\n- orders — orders of shop-api: What shop-api holds of orders. (2 elements, such as GET /orders, POST /orders)\n- customers — customers of shop-api: What shop-api holds of customers. (1 element, such as GET /customers)\n- Set aside by its agent: 1 elements.",
        "## shop-db (postgresql)\n- sales — sales of shop-db: What shop-db holds of sales. (2 elements, such as public.orders, public.customers)\n- Set aside by its agent: 1 elements.",
        "## specs (document): not mapped; leave it out.",
        "## notes (document)\n- No domain.",
        "Next: read with read_source_domain what a name does not tell, then call submit_index.",
      ].join("\n\n"),
    );
    for (const said of [
      "You orchestrate the cartography of an application",
      "You do not place elements again",
      "read_source_domain gives what the agent of a source wrote of one of its domains",
      "look in the source itself with its tools",
      "Keep with remember what the agents that plan tests should know about the application as a whole",
    ])
      assert.ok(CARTOGRAPHER_INSTRUCTIONS.includes(said), said);
    assert.doesNotMatch(CARTOGRAPHER_INSTRUCTIONS, /[ \t]$/m);
  });

  it("reads what the agent of a source wrote of a domain: its file, cut when long, or its elements when it has none", async () => {
    const files = new Map([
      ["shop-api/orders", "# Orders\n\n`GET /orders` lists the orders."],
      ["shop-db/sales", "x".repeat(8010)],
    ]);
    const tool = sourceDomainTool(CARDS, async (source, domain) => files.get(`${source}/${domain}`));
    const read = (source: string, domain: string) => tool.execute({ source, domain });
    assert.equal(await read("shop-api", "orders"), "# Orders\n\n`GET /orders` lists the orders.");
    assert.equal(await read("shop-db", "sales"), `${"x".repeat(8000)}\n\n[Cut at 8000 of 8010 characters.]`);
    assert.equal(await read("shop", "orders"), "# orders of shop (`orders`)\n\nWhat shop holds of orders.\n\n- `/orders`: About /orders.");
    assert.deepEqual(await read("ledger", "orders"), { error: "ledger is no source that was mapped. The sources: shop-api, shop-db, shop." });
    assert.deepEqual(await read("shop", "sales"), { error: "shop has no domain sales. Its domains: orders." });
    const empty = sourceDomainTool(new Map([["notes", card("notes", "document", {})]]), async () => undefined);
    assert.deepEqual(await empty.execute({ source: "notes", domain: "x" }), { error: "notes has no domain x. Its domains: none." });
  });
});
