import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AgentRuntimeError, type AgentEvent, type AgentRuntime, type ToolDefinition } from "@open-qa-stack/domain";
import type { ExportedElement, SourceExport } from "@open-qa-stack/tools";
import { Journal } from "../src/common/journal.ts";
import { MAX_BATCH_ELEMENTS } from "../src/source-workflow/element-batches.ts";
import { groupElements, NO_SESSION } from "../src/source-workflow/group-elements.ts";
import { Grouping } from "../src/source-workflow/grouping.ts";

const SECRET = "postgresql://shop:s3cr3t-pw@127.0.0.1:5999/shop";
const ORDERS = { id: "orders", label: "Orders", description: "Orders placed by customers." };
const LIMITS = { maxIterations: 20, maxDurationMs: null, maxActions: null };

const element = (name: string, summary = `table ${name}`): ExportedElement => ({
  name,
  kind: "table",
  summary,
  definition: "",
  fingerprint: "sha256:0",
  names: [],
  links: [],
  file: `tables/${name}.sql`,
});
const exportOf = (elements: readonly ExportedElement[]): SourceExport => ({ elements, fingerprint: "sha256:1" });
const NAMES = Array.from({ length: MAX_BATCH_ELEMENTS + 1 }, (_, i) => `public.t${i}`);

/** What a scripted session does when it receives a message: the events it gives, the last one terminal. */
type Turn = (message: string, tools: readonly ToolDefinition[]) => Promise<AgentEvent[]>;

/** Places every element the message names in the domain of the orders, then ends the turn. */
const placing: Turn = async (message, tools) => {
  const names = [...message.matchAll(/^### (.+)$/gm)].map((match) => match[1]!);
  const args = { domains: [ORDERS], items: names.map((name) => ({ name, domain: "orders", role: `Holds ${name}.` })) };
  const result = await tools[0]!.execute(args);
  return [
    { type: "tool-call", callId: "p", tool: "place_elements", arguments: args },
    { type: "tool-result", callId: "p", tool: "place_elements", result },
    { type: "end", counters: { iterations: 2, actions: 1, elapsedMs: 10.4, inputTokens: 100, outputTokens: 20 } },
  ];
};

/** Groups elements against sessions that each play the next turn of the script. */
async function grouped(turns: readonly Turn[], exported: SourceExport, grouping = new Grouping()) {
  const journal = new Journal();
  const sent: string[] = [];
  let opened = 0;
  const runtime: AgentRuntime = {
    openSession: async (options) => {
      const turn = turns[opened++]!;
      return {
        async *send(message: string): AsyncIterable<AgentEvent> {
          yield* await turn(message, options.tools);
        },
        close: async () => undefined,
      };
    },
    close: async () => undefined,
  };
  const received: AgentEvent[] = [];
  const used = await groupElements({
    sourceId: "shop-db",
    exported,
    grouping,
    runtime,
    limits: LIMITS,
    secrets: [SECRET],
    journal,
    sent: (message) => sent.push(message),
    received: (event) => received.push(event),
  });
  return { used, grouping, sent, received, opened: () => opened, journal: journal.entries().map((entry) => entry.message) };
}

describe("the grouping of the elements of a source", () => {
  it("opens one session per batch, tells the second where the first left the grouping, and adds up what they used", async () => {
    const { used, grouping, sent, received, opened } = await grouped([placing, placing], exportOf(NAMES.map((name) => element(name))));
    assert.equal(opened(), 2);
    assert.ok(sent[0]!.startsWith("Batch 1 of 2 of the source shop-db.\n\nNo domain exists yet"));
    assert.ok(
      sent[1]!.startsWith(
        `Batch 2 of 2 of the source shop-db.\n\nDomains so far:\n- orders — Orders: Orders placed by customers. (${MAX_BATCH_ELEMENTS} placed; such as public.t0, public.t1, public.t2)\n\nThe 1 elements to place`,
      ),
    );
    assert.deepEqual(used, { usage: { requests: 4, inputTokens: 200, outputTokens: 40 }, run: { iterations: 4, actions: 2, durationMs: 20 } });
    assert.equal(grouping.members("orders").length, NAMES.length);
    assert.equal(received.filter((event) => event.type === "end").length, 2);
  });

  it("asks nothing of the model when every element is settled, and only for those that are not", async () => {
    const grouping = new Grouping();
    for (const name of NAMES.slice(1)) grouping.place(name, ORDERS, "Placed before.");
    const one = await grouped([placing], exportOf(NAMES.map((name) => element(name))), grouping);
    assert.deepEqual([one.opened(), one.sent[0]!.includes("### public.t0\n"), one.sent[0]!.includes("### public.t1\n")], [1, true, false]);
    const none = await grouped([], exportOf(NAMES.map((name) => element(name))), grouping);
    assert.deepEqual([none.opened(), none.used], [0, NO_SESSION]);
  });

  it("masks the secrets of the configuration in the request of a batch", async () => {
    const { sent } = await grouped([placing], exportOf([element("public.links", `table public.links\n  columns: target text DEFAULT '${SECRET}'`)]));
    assert.ok(sent[0]!.includes("target text DEFAULT '[secret]'") && !sent[0]!.includes("s3cr3t-pw"));
  });

  it("goes on to the next batch when a limit stops a session, its elements left unplaced", async () => {
    const stopped: Turn = async () => [{ type: "stopped", reason: { limit: "duration", counters: { iterations: 1, actions: 0, elapsedMs: 5 } } }];
    const { used, grouping, journal, opened } = await grouped([stopped, placing], exportOf(NAMES.map((name) => element(name))));
    assert.deepEqual([opened(), used.stoppedBy, used.usage.requests], [2, "duration", 3]);
    assert.deepEqual(grouping.state("public.t0"), { unplaced: "The session ended before they were placed." });
    assert.deepEqual(grouping.state(NAMES.at(-1)!), { domain: "orders", role: `Holds ${NAMES.at(-1)!}.` });
    assert.ok(journal.includes("The session of batch 1 of 2 reached its duration limit."));
  });

  it("stops at a session that fails, the elements of the batches after it left unplaced with the reason", async () => {
    const failing: Turn = async () => [
      { type: "error", error: new AgentRuntimeError("Cannot reach the model."), counters: { iterations: 0, actions: 0, elapsedMs: 1 } },
    ];
    const { used, grouping, journal, opened } = await grouped([failing, placing], exportOf(NAMES.map((name) => element(name))));
    assert.deepEqual([opened(), used.stoppedBy, used.usage.requests], [1, undefined, 0]);
    assert.deepEqual(grouping.state("public.t0"), { unplaced: "The session ended before they were placed." });
    assert.deepEqual(grouping.state(NAMES.at(-1)!), { unplaced: "The grouping stopped before its batch." });
    assert.ok(journal.includes("The session of batch 1 of 2 failed: Cannot reach the model."));
  });
});
