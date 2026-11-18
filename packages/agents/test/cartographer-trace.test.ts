import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { answer, closedPort, toolCalls } from "@open-qa-stack/testing";
import type { TraceLine } from "@open-qa-stack/domain";
import { MAX_TRACED_LENGTH } from "../src/index.ts";
import {
  MODEL,
  DB_URL,
  TABLES,
  SUBMISSION,
  MERGES,
  gathering,
  without,
  submit,
  cartography,
  happy,
  messages,
  indexFile,
  cardPrint,
  BASE_PLACEMENTS,
  mappingTheBase,
  traceOf,
  PHASES,
  everyStartEnds,
} from "./cartographer-support.ts";

describe("trace, criterion 1 — the trace holds the phases in order, and each tool call with its arguments and result", () => {
  it("writes survey, then card, then consolidation, then index lines, and every call of the agents", async () => {
    const { outcome } = await cartography(mappingTheBase(), { cards: ["shop-api", "order-specs", "shop"] });
    const lines = traceOf(outcome);
    const order = lines.map((line) => PHASES.indexOf(line.phase));
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
    );
    assert.deepEqual([...new Set(lines.map((line) => line.phase))], PHASES);
    for (const { id, name, arguments: args } of [...BASE_PLACEMENTS, submit(MERGES)]) {
      const call = lines.find((line) => line.actor === "agent" && line.event.type === "tool-call" && line.event.callId === id);
      assert.deepEqual(call?.event, { type: "tool-call", callId: id, tool: name, arguments: args }, name);
      const result = lines.find((line) => line.actor === "agent" && line.event.type === "tool-result" && line.event.callId === id);
      assert.ok(result?.event.type === "tool-result" && result.event.tool === name, name);
    }
    const asked = lines.find((line) => line.source === "shop-db" && line.event.type === "message");
    for (const table of TABLES) assert.match(JSON.stringify(asked?.event), new RegExp(`### public\\.${table}`));
    assert.ok(lines.filter((line) => line.phase === "card" && line.actor === "agent").every((line) => line.source === "shop-db"));
    const inventory = lines.find((line) => line.source === "shop-db" && line.event.type === "inventory");
    assert.ok(
      inventory?.event.type === "inventory" && inventory.event.items === TABLES.length && !inventory.event.truncated && inventory.event.fingerprint !== "",
    );
    assert.ok(lines.some((line) => line.phase === "consolidation" && line.event.type === "message" && line.event.text.includes("submit_index")));
    assert.ok(everyStartEnds(lines));
    assert.deepEqual(
      lines
        .filter((line) => line.event.type === "finished" && line.source === undefined)
        .map((line) => [line.phase, line.event.type === "finished" && line.event.outcome]),
      [
        ["survey", "done"],
        ["card", "done"],
        ["consolidation", "done"],
        ["index", "done"],
      ],
    );
  });
});

describe("trace, criterion 2 — a reasoning of the model is in the trace, in its place among the tool calls", () => {
  it("writes the reasoning of the agent of a card before the call it led to", async () => {
    const thinking = toolCalls(MODEL, [BASE_PLACEMENTS[0]!]) as { choices: { message: Record<string, unknown> }[] };
    thinking.choices[0]!.message.reasoning_content = "One domain is enough.";
    const { outcome } = await cartography([{ body: thinking }, ...mappingTheBase().slice(1)], { cards: ["shop-api", "order-specs", "shop"] });
    const agent = traceOf(outcome)
      .filter((line) => line.actor === "agent" && line.source === "shop-db")
      .map((line) => line.event);
    assert.deepEqual(agent.slice(0, 2), [
      { type: "reasoning", text: "One domain is enough." },
      { type: "tool-call", callId: "c1", tool: "place_elements", arguments: BASE_PLACEMENTS[0]!.arguments },
    ]);
  });
});

describe("trace, criterion 3 — a card kept because it is up to date leaves a harness line, and no line of an agent", () => {
  it("says the card was kept, for each source whose card is up to date", async () => {
    const { outcome } = await cartography(happy());
    const lines = traceOf(outcome);
    for (const source of ["shop-api", "shop-db", "order-specs", "shop"]) {
      const own = lines.filter((line) => line.source === source && line.phase === "card");
      assert.ok(
        own.every((line) => line.actor === "harness"),
        source,
      );
      assert.ok(
        own.some((line) => line.event.type === "journal" && line.event.message === `The card of ${source} is up to date; it was kept.`),
        source,
      );
      assert.deepEqual(own.at(-1)?.event, { type: "finished", outcome: "kept" }, source);
    }
  });
});

describe("trace, criterion 4 — no connection string is in the trace", () => {
  it("masks the connection string the agents write, and cuts a string too long, the base mapped in the run", async () => {
    const echo = [{ id: "c0", name: "place_elements", arguments: { items: [{ name: "public.orders", domain: "all", role: `Read from ${DB_URL}` }] } }];
    const replies = [
      { body: toolCalls(MODEL, echo) },
      ...mappingTheBase().slice(0, -2),
      { body: toolCalls(MODEL, [submit(MERGES)]) },
      { body: answer(MODEL, `Done with ${DB_URL}. ${"z".repeat(MAX_TRACED_LENGTH + 1)}`) },
    ];
    const { outcome } = await cartography(replies, { cards: ["shop-api", "order-specs", "shop"] });
    const trace = readFileSync(outcome.tracePath, "utf8");
    assert.ok(trace.includes("[secret]") && !trace.includes(DB_URL) && !trace.includes("s3cret-db-pass"));
    assert.match(trace, /"Done with \[secret\]\. z+\[… 21 characters cut\]"/);
  });
});

describe("trace, criterion 5 — a cartography stopped by a limit leaves a trace readable up to the stop", () => {
  it("ends every phase it started, the task of the interface stopped at its limit", async () => {
    const actions = Array.from({ length: 201 }, (_, i) => ({ id: `g${i}`, name: "shop_goto", arguments: { url: "/" } }));
    const { outcome } = await cartography(
      [{ body: toolCalls(MODEL, actions) }, { body: toolCalls(MODEL, [submit(gathering("shop"))]) }, { body: answer(MODEL, "Done.") }],
      { cards: ["shop-api", "shop-db", "order-specs"] },
    );
    const lines = traceOf(outcome);
    assert.ok(lines.some((line) => line.source === "shop" && line.actor === "agent" && line.event.type === "stopped"));
    assert.deepEqual(lines.filter((line) => line.source === "shop").at(-1)?.event, { type: "finished", outcome: "failed" });
    assert.ok(everyStartEnds(lines));
  });
});

describe("trace, criterion 6 — an observer gets each line as it is written, and every phase started ends", () => {
  it("knows a phase has started before it is over, and gets the lines of the file in their order", async () => {
    const seen: TraceLine[] = [];
    let root = "";
    let indexBeforeConsolidation: boolean | undefined;
    const observe = (line: TraceLine) => {
      seen.push(line);
      if (line.phase === "consolidation" && line.event.type === "started") indexBeforeConsolidation = existsSync(indexFile(root));
    };
    const run = await cartography(mappingTheBase(), {
      cards: ["shop-api", "order-specs", "shop"],
      observe,
      prepare: (made) => (root = made),
    });
    assert.deepEqual(seen, traceOf(run.outcome));
    const started = seen.findIndex((line) => line.source === "shop-db" && line.event.type === "started");
    const firstCall = seen.findIndex((line) => line.source === "shop-db" && line.event.type === "tool-call");
    assert.ok(started >= 0 && started < firstCall);
    assert.equal(indexBeforeConsolidation, false);
  });

  it("ends as failed the phases a source that does not answer stops, and those a run that throws leaves open", async () => {
    const down = await closedPort();
    const silent = await cartography([], { uiUrl: `http://127.0.0.1:${down}`, cards: [] });
    const survey = traceOf(silent.outcome);
    assert.ok(survey.some((line) => line.source === "shop" && line.event.type === "survey" && !line.event.answers && line.event.error !== undefined));
    assert.deepEqual(survey.at(-1)?.event, { type: "finished", outcome: "failed" });
    assert.ok(everyStartEnds(survey) && survey.every((line) => line.phase === "survey"));
    const observed: TraceLine[] = [];
    const blocked = cartography(mappingTheBase(), {
      cards: ["shop-api", "order-specs", "shop"],
      observe: (line) => observed.push(line),
      prepare: (root) => mkdirSync(join(root, ".oqas", "index", "sources", "shop-db.json")),
    });
    await assert.rejects(blocked);
    assert.ok(everyStartEnds(observed));
    const ends = observed
      .filter((line) => line.event.type === "finished")
      .map((line) => [line.phase, line.source ?? "", line.event.type === "finished" && line.event.outcome]);
    assert.ok(ends.some(([phase, source, outcome]) => phase === "card" && source === "shop-db" && outcome === "failed"));
    assert.deepEqual(ends.at(-1), ["card", "", "failed"]);
  });
});

describe("faster cartography", () => {
  const sources = (ids: readonly string[]) => (root: string) =>
    ids.map((id) => ({
      id,
      type: id === "shop" ? "web" : id === "shop-db" ? "postgresql" : id === "shop-api" ? "openapi" : "document",
      state: "read",
      cardFingerprint: cardPrint(root, id),
    }));
  const ALL = ["shop-api", "shop-db", "order-specs", "shop"];
  /** An index of the cards of the repository, as a run made it before. */
  const index = (root: string, changes: object = {}, ids: readonly string[] = ALL) => ({
    formatVersion: 1,
    producedAt: "2026-11-12T08:00:00.000Z",
    environment: "local",
    model: { provider: "openai", baseUrl: "http://127.0.0.1:1/v1", model: MODEL },
    run: { iterations: 9, actions: 0, durationMs: 1 },
    status: "complete",
    sources: sources(ids)(root),
    ...SUBMISSION,
    ...changes,
  });
  const written =
    (content: (root: string) => unknown) =>
    (root: string): void => {
      const value = content(root);
      writeFileSync(indexFile(root), typeof value === "string" ? value : JSON.stringify(value));
    };
  const usages = (lines: readonly TraceLine[]) =>
    lines.flatMap((line) =>
      line.event.type === "usage" ? [[line.phase, line.source ?? "", line.event.requests, line.event.inputTokens, line.event.outputTokens]] : [],
    );

  describe("faster cartography, criterion 1 — up-to-date cards and an index made of them send no request and keep the index", () => {
    it("keeps the index without any request to the model, and the trace says why", async () => {
      const { outcome, root, server } = await cartography([], { prepare: written((made) => index(made)) });
      assert.equal(server.requests.length, 0);
      assert.deepEqual([outcome.indexPath, outcome.index!.producedAt], [indexFile(root), "2026-11-12T08:00:00.000Z"]);
      const lines = traceOf(outcome);
      const why = lines.find((line) => line.phase === "index" && line.event.type === "journal");
      assert.match(
        why?.event.type === "journal" ? why.event.message : "",
        /^The index .*domain-index\.json is complete and made of the cards every source has now, by their fingerprints; it was kept\.$/,
      );
      const phases = lines.filter((line) => line.source === undefined && (line.event.type === "started" || line.event.type === "finished"));
      assert.deepEqual(
        phases.slice(-2).map((line) => [line.phase, line.event]),
        [
          ["index", { type: "started" }],
          ["index", { type: "finished", outcome: "kept" }],
        ],
      );
      assert.ok(!lines.some((line) => line.phase === "consolidation" || line.actor === "agent"));
      assert.ok(usages(lines).every(([, , requests, input]) => requests === 0 && input === undefined));
    });

    it("makes the index again when it is truncated, of another environment, unreadable, recorded no fingerprint, or force is set", async () => {
      const stale: readonly [(root: string) => unknown, string][] = [
        [
          (root) => ({ ...index(root), status: "truncated", sources: [...sources(ALL.slice(0, 3))(root), { id: "shop", type: "web", state: "not_read" }] }),
          "the index at hand is truncated",
        ],
        [(root) => index(root, { environment: "staging" }), "the index at hand is of the environment staging"],
        [() => "{ not json", "no index could be read"],
        [
          (root) => index(root, { sources: sources(ALL)(root).map(({ cardFingerprint: _, ...source }) => source) }),
          "the index at hand records no fingerprint of the card of shop-api, as an earlier version made it",
        ],
      ];
      for (const [content, reason] of stale) {
        const { outcome, server } = await cartography(happy(), { prepare: written(content) });
        assert.ok(server.requests.length > 0, reason);
        assert.equal(outcome.index!.producedAt, "2026-11-13T10:00:00.000Z", reason);
        assert.ok(messages(outcome).includes(`The index is made: ${reason}.`), messages(outcome));
      }
      const silent = Array.from({ length: 16 }, () => ({ body: answer(MODEL, "Nothing to say.") }));
      const forced = await cartography(silent, { force: true, prepare: written((made) => index(made)) });
      assert.ok(forced.server.requests.length > 0);
      assert.match(messages(forced.outcome), /The index is made: force is set\./);
    });
  });

  describe("faster cartography, criterion 2 — a card made again, added or removed makes the consolidation again, with the new fingerprints", () => {
    it("consolidates again when a card was made again, and records its new fingerprint", async () => {
      let before = "";
      // The document changed: the agent that maps it reads it again and hands its domain in, then the index is consolidated.
      const orders = {
        id: "orders",
        label: "orders",
        description: "What order-specs holds of the orders.",
        elements: [{ file: "orders.md", role: "About the orders." }],
        body: "`orders.md` tells how an order is placed.",
      };
      const remade = [
        { body: toolCalls(MODEL, [{ id: "r1", name: "order_specs_read_file", arguments: {} }]) },
        { body: toolCalls(MODEL, [{ id: "w1", name: "write_domain", arguments: orders }]) },
        { body: answer(MODEL, "Done.") },
        ...happy(),
      ];
      const prepare = (root: string) => {
        written(index)(root);
        before = cardPrint(root, "order-specs");
        writeFileSync(join(root, "specs", "orders.md"), "# Orders\n\n## Placing an order\n\nA customer places an order, then pays it.\n");
      };
      const { outcome, root, server } = await cartography(remade, { prepare });
      assert.equal(server.requests.length, 5);
      assert.match(messages(outcome), /The index is made: the card of order-specs is not the one the index at hand was made of\./);
      const recorded = outcome.index!.sources.find((source) => source.id === "order-specs")!.cardFingerprint;
      assert.ok(recorded === cardPrint(root, "order-specs") && recorded !== before);
      assert.deepEqual(
        outcome.index!.sources.map((source) => source.cardFingerprint),
        ALL.map((id) => cardPrint(root, id)),
      );
    });

    it("consolidates again when a source was added or removed, and records the fingerprints of the cards of the run", async () => {
      const added = await cartography(happy(), { prepare: written((root) => index(root, without("shop"), ALL.slice(0, 3))) });
      assert.match(messages(added.outcome), /The index is made: shop is not a source of the index at hand\./);
      assert.deepEqual(
        added.outcome.index!.sources.map((source) => [source.id, source.cardFingerprint]),
        ALL.map((id) => [id, cardPrint(added.root, id)]),
      );
      const gone = { id: "old-specs", type: "document", state: "read", cardFingerprint: `sha256:${"0".repeat(64)}` };
      const removed = await cartography(happy(), { prepare: written((root) => index(root, { sources: [...sources(ALL)(root), gone] })) });
      assert.match(messages(removed.outcome), /The index is made: old-specs is no longer a source of the run\./);
      assert.deepEqual(
        removed.outcome.index!.sources.map((source) => [source.id, source.cardFingerprint]),
        ALL.map((id) => [id, cardPrint(removed.root, id)]),
      );
    });
  });

  describe("faster cartography, criterion 3 — the trace gives the requests to the model of each phase and of each source", () => {
    it("counts the requests and the tokens of each phase and of each card, on scripted answers", async () => {
      const { outcome, server } = await cartography(mappingTheBase(), { cards: ["shop-api", "order-specs", "shop"] });
      // The base has two domains: two batches of calls to place its tables, then the file of each domain, then the consolidation.
      assert.equal(server.requests.length, 7);
      assert.deepEqual(usages(traceOf(outcome)), [
        ["survey", "", 0, undefined, undefined],
        ["card", "shop-api", 0, undefined, undefined],
        ["card", "shop-db", 5, 5, 5],
        ["card", "order-specs", 0, undefined, undefined],
        ["card", "shop", 0, undefined, undefined],
        ["card", "", 5, 5, 5],
        ["consolidation", "", 2, 2, 2],
        ["index", "", 0, undefined, undefined],
      ]);
      const ends = traceOf(outcome).flatMap((line, i, lines) => (line.event.type === "finished" ? [lines[i - 1]!.event.type] : []));
      assert.ok(
        ends.every((type) => type === "usage"),
        "each phase gives its usage just before its end",
      );
    });
  });
});
