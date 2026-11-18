import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { validateDomainIndex } from "@open-qa-stack/domain";
import { answer, closedPort, toolCalls } from "@open-qa-stack/testing";
import { type SqlClient } from "@open-qa-stack/tools";
import {
  MODEL,
  DB_URL,
  CatalogDouble,
  site,
  elsewhere,
  references,
  SUBMISSION,
  from,
  MERGES,
  gathering,
  explored,
  submit,
  HOME_MAPPED,
  cartography,
  happy,
  messages,
  indexFile,
  cardPrint,
  toolsOffered,
  mappingTheBase,
} from "./cartographer-support.ts";

describe("criterion 1 — the cartographer writes an index that passes the schema of the index format", () => {
  it("consolidates the domains of a contract, a base, a document and an interface into those of the application", async () => {
    const { outcome, root, server } = await cartography(happy());
    assert.equal(outcome.indexPath, indexFile(root));
    const written = JSON.parse(readFileSync(indexFile(root), "utf8")) as unknown;
    assert.deepEqual(validateDomainIndex(written), { ok: true, value: outcome.index });
    assert.deepEqual(outcome.index!.sources, [
      { id: "shop-api", type: "openapi", state: "read", cardFingerprint: cardPrint(root, "shop-api") },
      { id: "shop-db", type: "postgresql", state: "read", cardFingerprint: cardPrint(root, "shop-db") },
      { id: "order-specs", type: "document", state: "read", cardFingerprint: cardPrint(root, "order-specs") },
      { id: "shop", type: "web", state: "read", cardFingerprint: cardPrint(root, "shop") },
    ]);
    assert.deepEqual(
      [outcome.index!.status, outcome.index!.producedAt, outcome.index!.environment, outcome.index!.run.iterations],
      ["complete", "2026-11-13T10:00:00.000Z", "local", 2],
    );
    assert.ok(["read_source_domain", "recall", "remember", "submit_index"].every((tool) => toolsOffered(server, 0).includes(tool)));
    assert.match(
      messages(outcome),
      /The card of shop is up to date; it was kept\.\nThe index is made: no index could be read\.\nThe index was accepted\.\nThe index was written to .*domain-index\.json, complete\./,
    );
  });
});

describe("criterion 2 — every domain of every source is in a domain of the application, and its elements follow", () => {
  it("gives the orchestrator the domains of the sources, not their elements, with the tool that reads a map and the tools of the sources", async () => {
    const { outcome, server } = await cartography(happy());
    const request = (server.requests[0]!.body as { messages: { role: string; content: string }[] }).messages.find(
      (message) => message.role === "user",
    )!.content;
    assert.ok(
      request.includes("## shop-db (postgresql)\n- orders — orders: What shop-db holds of the orders. (2 elements, such as public.orders, public.order_lines)"),
      request,
    );
    assert.ok(request.includes("- Set aside by its agent: 1 elements."));
    assert.ok(!request.includes("About public.orders."), "the elements are read with a tool, not given");
    const offered = toolsOffered(server, 0);
    for (const tool of [
      "read_source_domain",
      "shop_api_list_operations",
      "shop_db_list_tables",
      "order_specs_read_section",
      "shop_goto",
      "remember",
      "recall",
      "submit_index",
    ])
      assert.ok(offered.includes(tool), tool);
    assert.deepEqual([outcome.index!.domains, outcome.index!.unassigned], [SUBMISSION.domains, SUBMISSION.unassigned]);
  });

  it("lets the orchestrator read the map of a source, and the source itself, before it hands the index in", async () => {
    const looks = [
      { id: "m1", name: "read_source_domain", arguments: { source: "shop-db", domain: "orders" } },
      { id: "t1", name: "shop_db_list_tables", arguments: {} },
      // The browser of the application is guarded as an exploration is: nothing that removes data is clicked.
      { id: "k1", name: "shop_click", arguments: { target: { role: "button", name: "Delete order" } } },
    ];
    const { outcome, server } = await cartography([{ body: toolCalls(MODEL, looks) }, ...happy()]);
    assert.equal(outcome.index!.status, "complete", messages(outcome));
    const told = JSON.stringify(server.requests[1]!.body);
    assert.match(told, /orders \(`orders`\)[^"]*`public\.orders`: About public\.orders\./);
    assert.match(told, /order_lines/);
    assert.match(told, /may remove data of the application, and an exploration never removes any/);
  });

  it("journals the error of a tool the orchestrator called wrongly", async () => {
    const wrong = [{ id: "m1", name: "read_source_domain", arguments: { source: "shop-db" } }];
    const { outcome } = await cartography([{ body: toolCalls(MODEL, wrong) }, ...happy()]);
    assert.match(messages(outcome), /read_source_domain: /);
  });
});

describe("criterion 3 — an index that leaves a domain of a source aside is not written, and the journal says so", () => {
  /** A submission that gathers the orders alone: the customers of the contract and of the base are left aside. */
  const partial = { domains: [MERGES.domains[0]!] };

  it("refuses the submission, tells the agent what is left, and writes nothing", async () => {
    const { outcome, root, server } = await cartography([{ body: toolCalls(MODEL, [submit(partial)]) }, { body: answer(MODEL, "Done.") }]);
    assert.equal(existsSync(indexFile(root)), false);
    assert.match(messages(outcome), /The index was refused: 2 domains of the sources are in no domain of the application\./);
    const told = JSON.stringify(server.requests[1]!.body);
    assert.match(told, /Still in no domain of the application/);
    assert.ok(told.includes("- shop-api › customers") && told.includes("- shop-db › customers"));
  });

  it("names the limit that stopped the consolidation before an index was accepted", async () => {
    const { outcome, root } = await cartography([{ body: toolCalls(MODEL, [submit(partial)]) }, { body: answer(MODEL, "Done.") }], {
      limits: { maxIterations: 1, maxMinutes: 10, maxActions: 200 },
    });
    assert.equal(existsSync(indexFile(root)), false);
    assert.equal(outcome.stoppedBy, "iterations");
  });

  it("stops reminding after three times, with the latest refusal each time", async () => {
    const { outcome, server } = await cartography([
      { body: toolCalls(MODEL, [submit(partial)]) },
      ...Array.from({ length: 4 }, () => ({ body: answer(MODEL, "Done.") })),
    ]);
    assert.equal(server.requests.length, 5);
    assert.match(JSON.stringify(server.requests[4]!.body), /Still in no domain of the application/);
    assert.equal(outcome.journal.filter((e) => e.message.startsWith("The agent stopped without an accepted index")).length, 3);
    assert.match(messages(outcome), /No index was written: no index was accepted before the session ended\./);
  });

  it("keeps as domains of the application of their own those left aside twice in a row, and writes the index", async () => {
    const { outcome } = await cartography([
      { body: toolCalls(MODEL, [submit(partial)]) },
      { body: toolCalls(MODEL, [submit(partial, "x2")]) },
      { body: answer(MODEL, "Done.") },
    ]);
    assert.deepEqual(
      outcome.index!.domains.map((domain) => [domain.id, domain.references.map((reference) => reference.source)]),
      [
        ["orders", ["shop-api", "shop-db", "shop", "order-specs"]],
        ["customers", ["shop-api", "shop-db"]],
      ],
    );
    assert.match(messages(outcome), /the harness kept each as a domain of the application: shop-api › customers, shop-db › customers\./);
  });
});

describe("criterion 4 — an index that breaks the schema is not written, and the journal names the field", () => {
  it("journals the field of a whole index that breaks the schema", async () => {
    const { outcome, root } = await cartography([{ body: toolCalls(MODEL, [submit(gathering("shop", "order-specs"))]) }, { body: answer(MODEL, "Done.") }], {
      environment: "",
    });
    assert.equal(existsSync(indexFile(root)), false);
    assert.match(messages(outcome), /The index does not match its schema: \/environment must NOT have fewer than 1 characters\.\nNo index was written\./);
  });
});

describe("criterion 5 — a declared source that does not answer stops the run before any exploration", () => {
  it("names each source in error and its cause, starts no session, writes nothing", async () => {
    const down = await closedPort();
    const failing: SqlClient = { query: () => Promise.reject("refused") };
    const { outcome, root, server } = await cartography(
      [],
      { uiUrl: `http://127.0.0.1:${down}`, documents: ["specs/missing.md"], cards: [] },
      failing as unknown as CatalogDouble,
    );
    assert.deepEqual(server.requests, []);
    assert.equal(existsSync(indexFile(root)), false);
    const errors = outcome.journal.filter((entry) => entry.source !== undefined).map((entry) => [entry.source, entry.message]);
    assert.deepEqual(
      errors.map(([source]) => source),
      ["shop-db", "order-specs", "shop"],
    );
    assert.match(errors[0]![1]!, /^The source shop-db does not answer: refused$/);
    assert.match(errors[1]![1]!, /^The source order-specs does not answer: The document specs\/missing\.md does not exist\./);
    assert.match(errors[2]![1]!, /^The source shop does not answer: fetch failed: .*ECONNREFUSED/);
    assert.match(messages(outcome), /No index was written: every declared source must answer before the exploration\./);
  });

  it("refuses a user interface that answers with a server error, and a contract that cannot be fetched", async () => {
    const down = await closedPort();
    const { outcome } = await cartography([], { uiUrl: `${site.origin}/broken`, contractUrl: `http://127.0.0.1:${down}/v3/api-docs`, cards: [] });
    assert.match(messages(outcome), /The source shop does not answer: .*\/broken answered with status 500\./);
    assert.match(messages(outcome), /The source shop-api does not answer: fetch failed/);
  });
});

describe("defaults of a run", () => {
  it("checks the base with PostgreSQL itself, and says when it does not answer", async () => {
    const { outcome, server } = await cartography(happy(), { realDatabase: true, cards: [] });
    assert.deepEqual(server.requests, []);
    assert.match(messages(outcome), /The source shop-db does not answer: The database query failed: .*ECONNREFUSED/);
  });

  it("runs without limits at the autonomous level, and dates the index with the system clock", async () => {
    const before = Date.now();
    const { outcome } = await cartography(happy(), { autonomous: true });
    assert.equal(outcome.index!.status, "complete");
    assert.ok(Date.parse(outcome.index!.producedAt) >= before);
  });
});

describe("criterion 6 — a navigation outside the declared origins is refused, counted and journaled", () => {
  it("answers the agent of the interface with an error, reaches no other host, and counts the action in the index", async () => {
    const away = [{ id: "g1", name: "shop_goto", arguments: { url: `${elsewhere.origin}/` } }];
    const home = [{ id: "g2", name: "shop_goto", arguments: { url: "/" } }];
    const screens = explored();
    const { outcome } = await cartography(
      [
        { body: toolCalls(MODEL, away) },
        { body: toolCalls(MODEL, home) },
        { body: toolCalls(MODEL, HOME_MAPPED) },
        { body: answer(MODEL, "Done.") },
        { body: toolCalls(MODEL, [submit(screens)]) },
        { body: answer(MODEL, "Done.") },
      ],
      { cards: ["shop-api", "shop-db", "order-specs"] },
    );
    assert.deepEqual(elsewhere.requested, []);
    assert.equal(outcome.index!.run.actions, 2);
    assert.match(messages(outcome), new RegExp(`shop_goto: ${elsewhere.origin}/ is not an address of shop`));
  });
});

describe("criterion 7 — the database tool only queries the catalog", () => {
  it("sends only catalog queries while the base is mapped, and offers no tool of the base", async () => {
    const { database, server, outcome } = await cartography(mappingTheBase(), { cards: ["shop-api", "order-specs", "shop"] });
    assert.equal(outcome.index!.status, "complete");
    assert.ok(database.queries.length >= 3);
    for (const query of database.queries) assert.match(query, /information_schema|pg_catalog/);
    assert.deepEqual(toolsOffered(server, 0), ["place_elements", "remember"]);
  });
});

describe("single read, criterion 1 — a full cartography sends each catalog query once", () => {
  it("reads the catalog of the base at the check only", async () => {
    const { database, outcome } = await cartography(mappingTheBase(), { cards: ["shop-api", "order-specs", "shop"] });
    assert.equal(outcome.index!.status, "complete");
    assert.ok(database.queries.length > 0);
    assert.equal(new Set(database.queries).size, database.queries.length);
  });
});

describe("criterion 8 — the connection string appears in neither the index, the journal, nor the model exchanges", () => {
  it("keeps the secret out of every trace, the base mapped in the run", async () => {
    const { outcome, root, server } = await cartography(mappingTheBase(), { cards: ["shop-api", "order-specs", "shop"] });
    assert.ok(outcome.index);
    for (const trace of [readFileSync(indexFile(root), "utf8"), JSON.stringify(outcome.journal), JSON.stringify(server.requests)]) {
      assert.ok(!trace.includes("s3cret-db-pass") && !trace.includes(DB_URL));
    }
  });
});

describe("criterion 9 — past 200 actions nothing more runs, and no complete index exists", () => {
  it("stops the task of the interface at the 201st action: the interface has no card, and the index is truncated", async () => {
    const actions = Array.from({ length: 201 }, (_, i) => ({ id: `g${i}`, name: "shop_goto", arguments: { url: "/" } }));
    const before = site.requested.length;
    const { outcome } = await cartography(
      [{ body: toolCalls(MODEL, actions) }, { body: toolCalls(MODEL, [submit(gathering("shop"))]) }, { body: answer(MODEL, "Done.") }],
      { cards: ["shop-api", "shop-db", "order-specs"] },
    );
    assert.match(messages(outcome), /The session that explores shop reached its actions limit\.[^]*No card was written: no element of shop was placed\./);
    // The run checks the interface, its cartographer checks it again, opens its page, then one request per action that ran.
    assert.equal(site.requested.slice(before).filter((r) => r === "GET /").length, 3 + 200);
    assert.equal(outcome.journal.filter((entry) => entry.message === "shop_goto: The task reached its actions limit; the call did not run.").length, 1);
    assert.deepEqual([outcome.index!.status, outcome.index!.sources.find((s) => s.id === "shop")!.state], ["truncated", "not_read"]);
  });

  it("marks truncated an index accepted before a limit stopped the consolidation, or made from a truncated card", async () => {
    const { outcome } = await cartography([{ body: toolCalls(MODEL, [submit(MERGES)]) }, { body: answer(MODEL, "Done.") }], {
      limits: { maxIterations: 1, maxMinutes: 10, maxActions: 200 },
    });
    assert.deepEqual([outcome.index!.status, outcome.index!.run.iterations], ["truncated", 1]);
    // An index was written: the cartography is not to be resumed.
    assert.equal(outcome.stoppedBy, undefined);
    const late = [
      { body: toolCalls(MODEL, [{ id: "g1", name: "shop_goto", arguments: { url: "/" } }]) },
      // The session is cut once the home is placed: the screen its link leads to is left unplaced, and the card truncated.
      { body: toolCalls(MODEL, [HOME_MAPPED[0]!]) },
    ];
    const screens = explored();
    const cut = await cartography([...late, { body: toolCalls(MODEL, [submit(screens)]) }, { body: answer(MODEL, "Done.") }], {
      cards: ["shop-api", "shop-db", "order-specs"],
      limits: { maxIterations: 2, maxMinutes: 10, maxActions: 200 },
    });
    assert.match(messages(cut.outcome), /The card was written to .*shop\.json, truncated\./);
    assert.deepEqual([cut.outcome.index!.status, cut.outcome.index!.sources.find((s) => s.id === "shop")!.state], ["truncated", "read"]);
  });
});

describe("criterion 10 — a declared document is listed, read when it has a card", () => {
  it("marks a document without a card as not read, refuses an index that refers to it, and truncates the index", async () => {
    const noCard = Array.from({ length: 4 }, () => ({ body: answer(MODEL, "Nothing to say.") }));
    const [orders, customers] = MERGES.domains;
    const refersToIt = { domains: [{ ...orders!, from: [...orders!.from, from("specs-1", "returns")] }, customers!] };
    const { outcome, server } = await cartography(
      [...noCard, { body: toolCalls(MODEL, [submit(refersToIt)]) }, { body: toolCalls(MODEL, [submit(MERGES, "x2")]) }, { body: answer(MODEL, "Done.") }],
      { documents: ["specs/orders.md", "specs/returns.md"] },
    );
    assert.match(JSON.stringify(server.requests[5]!.body), /specs-1 is no source with a card\. The sources: shop-api, shop-db, order-specs, shop\./);
    assert.deepEqual(
      outcome.index!.sources.filter((s) => s.type === "document").map((s) => [s.id, s.state, s.cardFingerprint !== undefined]),
      [
        ["order-specs", "read", true],
        ["specs-1", "not_read", false],
      ],
    );
    assert.equal(outcome.index!.status, "truncated");
    assert.match(JSON.stringify(server.requests[4]!.body), /## specs-1 \(document\): not mapped; leave it out\./);
  });
});

describe("criterion 11 — the run commits and pushes nothing", () => {
  it("leaves the index untracked, and HEAD and every reference, local or remote, as they were", async () => {
    const { root, before } = await cartography(happy());
    const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    assert.deepEqual(references(root), before);
    assert.match(git(root, "status", "--porcelain", "--untracked-files=all"), /^\?\? \.oqas\/index\/domain-index\.json$/m);
    assert.match(before.remote, /refs\/heads\/main/);
  });
});

describe("a session that fails", () => {
  it("still writes, truncated, an index accepted before the consolidation failed", async () => {
    const { outcome } = await cartography([{ body: toolCalls(MODEL, [submit(MERGES)]) }, { status: 500, body: { error: { message: "overloaded" } } }]);
    assert.equal(outcome.index!.status, "truncated");
    assert.match(messages(outcome), /The index was accepted\.\nThe consolidation failed: .*\nThe index was written to/);
  });

  it("journals the failure of the model, and writes nothing when no source has a card", async () => {
    const down = await closedPort();
    const consolidation = await cartography([], {}, new CatalogDouble(), `http://127.0.0.1:${down}/v1`);
    assert.equal(existsSync(indexFile(consolidation.root)), false);
    assert.match(messages(consolidation.outcome), /The consolidation failed: /);
    const cards = await cartography([], { cards: [] }, new CatalogDouble(), `http://127.0.0.1:${down}/v1`);
    assert.match(
      messages(cards.outcome),
      /No card was written: no element of shop-api was placed\.[^]*No card was written: no element of shop-db was placed\.[^]*The session that explores shop failed: [^]*No index was written: no source has a card\./,
    );
  });
});
