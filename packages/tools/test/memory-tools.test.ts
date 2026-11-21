import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ToolDefinition } from "@open-qa-stack/domain";
import { KeptMemories } from "@open-qa-stack/testing";
import { MAX_FOUND_MEMORIES, memoryTools } from "../src/index.ts";

const SECRET = "p@ss word";

/** The tools over memories of their own, on a clock that moves a second at each date and identifiers that follow each other. */
function tools(memories = new KeptMemories(), task = "t1", role = "cartographer") {
  let tick = 0;
  let id = 0;
  const now = () => new Date(Date.UTC(2026, 10, 21, 9, 0, tick++));
  const made = memoryTools(memories, { role, task, secrets: [SECRET, ""], now, newId: () => `m${++id}` });
  const tool = (name: string): ToolDefinition => made.find((one) => one.name === name)!;
  return { memories, remember: (args: object) => tool("remember").execute(args), recall: (args: object) => tool("recall").execute(args) as Promise<Shown[]> };
}

interface Shown {
  readonly id: string;
  readonly domain: string;
  readonly kind: string;
  readonly text: string;
  readonly tags: readonly string[];
  readonly source?: string;
  readonly role: string;
  readonly writtenAt: string;
  readonly revisedAt?: string;
  readonly score: number;
}

describe("criterion 3 — recall keeps exactly to a domain and a kind, then ranks lexically", () => {
  it("gives only the memories of the domain and the kind named, by tags, words and recency, ten by default and thirty at most", async () => {
    const { remember, recall } = tools();
    await remember({ domain: "orders", kind: "pitfall", text: "The total clears when the currency changes.", tags: ["Checkout"], distinct: true });
    await remember({
      domain: "orders",
      kind: "pitfall",
      text: "A refund takes a minute to show.",
      tags: ["refund", "checkout"],
      source: "shop-api",
      distinct: true,
    });
    await remember({ domain: "orders", kind: "business_rule", text: "The total is rounded to the cent.", tags: ["checkout"], distinct: true });
    await remember({ domain: "orders-archive", kind: "pitfall", text: "The archived total is never shown.", tags: ["checkout"], distinct: true });
    const found = await recall({ domain: "orders", kind: "pitfall", tags: ["checkout"], text: "total" });
    assert.deepEqual(
      found.map(({ id, score }) => [id, score]),
      [
        ["m1", 3],
        ["m2", 2],
      ],
    );
    assert.deepEqual(found[1], {
      id: "m2",
      domain: "orders",
      kind: "pitfall",
      text: "A refund takes a minute to show.",
      tags: ["refund", "checkout"],
      source: "shop-api",
      role: "cartographer",
      writtenAt: "2026-11-21T09:00:01.000Z",
      score: 2,
    });
    assert.deepEqual(
      (await recall({ kind: "pitfall" })).map(({ id }) => id),
      ["m4", "m2", "m1"],
    );
    assert.deepEqual(
      (await recall({ source: "shop-api" })).map(({ id }) => id),
      ["m2"],
    );
    assert.deepEqual(await recall({ domain: "customers" }), []);

    const many = tools();
    for (let i = 0; i < MAX_FOUND_MEMORIES + 2; i++)
      await many.remember({ domain: "orders", kind: "test_data", text: `Order number ${i} exists.`, distinct: true });
    assert.equal((await many.recall({})).length, 10);
    assert.equal((await many.recall({ limit: MAX_FOUND_MEMORIES })).length, MAX_FOUND_MEMORIES);
  });
});

describe("criterion 4 — a memory with none close to it is kept", () => {
  it("is kept and its identifier given when no memory of its domain and its kind is close, whatever those of other domains or kinds say", async () => {
    const { remember, recall } = tools();
    assert.equal(await remember({ domain: "orders", kind: "pitfall", text: "The total clears when the currency changes." }), "Kept as m1.");
    assert.equal(await remember({ domain: "orders", kind: "business_rule", text: "The total clears when the currency changes." }), "Kept as m2.");
    assert.equal(await remember({ domain: "customers", kind: "pitfall", text: "The total clears when the currency changes." }), "Kept as m3.");
    assert.equal(await remember({ domain: "orders", kind: "pitfall", text: "Refunds show after a minute." }), "Kept as m4.");
    assert.equal((await recall({})).length, 4);
  });

  it("dates it by the system clock and names it by a random UUID by default", async () => {
    const memories = new KeptMemories();
    const [remember] = memoryTools(memories, { role: "planner", task: "t", secrets: [] });
    assert.match(String(await remember!.execute({ domain: "general", kind: "vocabulary", text: "Clients are customers." })), /^Kept as [0-9a-f-]{36}\.$/);
    const [kept] = await memories.list({});
    assert.ok(Date.parse(kept!.written.at) > Date.UTC(2026, 0, 1));
    assert.deepEqual([kept!.written.role, kept!.written.task, kept!.tags], ["planner", "t", []]);
  });
});

describe("criterion 5 — a memory close to one of its domain and its kind is not kept unasked", () => {
  it("keeps nothing and gives back the close memories with their identifiers, then keeps it when told it is distinct", async () => {
    const { remember, recall } = tools();
    await remember({ domain: "orders", kind: "pitfall", text: "The total clears when the currency changes.", tags: ["checkout"] });
    const answer = (await remember({ domain: "orders", kind: "pitfall", text: "Changing the currency empties the total." })) as {
      kept: boolean;
      message: string;
      close: Shown[];
    };
    assert.equal(answer.kept, false);
    assert.match(answer.message, /^Nothing was kept: these memories of the domain orders and the kind pitfall are close to it\. .*revises.*distinct/);
    assert.deepEqual(
      answer.close.map(({ id, text }) => [id, text]),
      [["m1", "The total clears when the currency changes."]],
    );
    assert.equal((await recall({})).length, 1);
    assert.equal(await remember({ domain: "orders", kind: "pitfall", text: "Changing the currency empties the total.", distinct: true }), "Kept as m2.");
    assert.equal((await recall({})).length, 2);
  });
});

describe("criterion 6 — remember corrects a memory instead of adding one", () => {
  it("replaces what the memory says, which keeps its identifier, its domain, its kind and who wrote it, and is dated by its correction", async () => {
    const memories = new KeptMemories();
    await tools(memories).remember({
      domain: "orders",
      kind: "pitfall",
      text: "The total clears when the currency changes.",
      tags: ["checkout"],
      source: "shop-ui",
    });
    const planner = tools(memories, "t2", "planner");
    assert.equal(
      await planner.remember({
        domain: "orders",
        kind: "pitfall",
        text: "The total clears when the currency or the country changes.",
        tags: ["Checkout", "Country"],
        revises: "m1",
      }),
      "Corrected m1.",
    );
    assert.deepEqual(await planner.recall({}), [
      {
        id: "m1",
        domain: "orders",
        kind: "pitfall",
        text: "The total clears when the currency or the country changes.",
        tags: ["checkout", "country"],
        role: "cartographer",
        writtenAt: "2026-11-21T09:00:00.000Z",
        revisedAt: "2026-11-21T09:00:00.000Z",
        score: 0,
      },
    ]);
    const [kept] = await memories.list({});
    assert.deepEqual(
      [kept!.written, kept!.revised],
      [
        { role: "cartographer", task: "t1", at: "2026-11-21T09:00:00.000Z" },
        { role: "planner", task: "t2", at: "2026-11-21T09:00:00.000Z" },
      ],
    );
  });

  it("is refused for a memory it does not know, or of another domain or another kind, and with distinct besides, and nothing changes", async () => {
    const { remember, recall } = tools();
    await remember({ domain: "orders", kind: "pitfall", text: "The total clears when the currency changes." });
    const before = await recall({});
    for (const [domain, kind, id] of [
      ["orders", "pitfall", "m9"],
      ["customers", "pitfall", "m1"],
      ["orders", "locator", "m1"],
    ] as const) {
      assert.deepEqual(await remember({ domain, kind, text: "Something else.", revises: id }), {
        error: `No memory ${id} is of the domain ${domain} and the kind ${kind}: nothing was changed. Recall them to find its id.`,
      });
    }
    assert.deepEqual(await remember({ domain: "orders", kind: "pitfall", text: "Something else.", revises: "m1", distinct: true }), {
      error: "Give revises or distinct, not both: a memory is either corrected or added.",
    });
    assert.deepEqual(await recall({}), before);
  });
});

describe("criterion 7 — a memory that holds a secret is refused", () => {
  const REFUSED = { error: "The memory holds a secret of the configuration; it was not kept. Write it without the secret." };

  it("refuses the secret as it is or encoded in an address, in the text, a tag, the source or a correction, and keeps nothing", async () => {
    const { remember, recall } = tools();
    await remember({ domain: "accounts", kind: "test_data", text: "A test account exists for each role." });
    for (const memory of [
      { text: `The password is ${SECRET}.` },
      { text: `Sign in at /login?p=${encodeURIComponent(SECRET)}` },
      { text: "A test account.", tags: ["accounts", SECRET] },
      { text: "A test account.", source: SECRET },
      { text: `Each role signs in with ${SECRET}.`, revises: "m1" },
    ])
      assert.deepEqual(await remember({ domain: "accounts", kind: "test_data", ...memory }), REFUSED);
    assert.deepEqual(
      (await recall({})).map(({ text }) => text),
      ["A test account exists for each role."],
    );
  });

  it("refuses a secret in the domain", async () => {
    const memories = new KeptMemories();
    const [remember] = memoryTools(memories, { role: "r", task: "t", secrets: ["staging-key"] });
    assert.deepEqual(await remember!.execute({ domain: "staging-key", kind: "test_data", text: "A test account." }), REFUSED);
    assert.deepEqual(await memories.list({}), []);
  });
});
