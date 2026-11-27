import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { MemoryRefusedError, UnknownMemoryError } from "@open-qa-stack/domain";
import { KeptMemories } from "@open-qa-stack/testing";
import { AgentMemory } from "../src/index.ts";
import { MemoryLessonStore } from "./support/memory-lesson-store.ts";

const NOTED = {
  id: "m1",
  domain: "orders",
  kind: "pitfall" as const,
  text: "A refund takes a minute to show.",
  tags: ["refund"],
  source: "shop-api",
  written: { role: "cartographer", task: "t", at: "2026-11-27T09:00:00.000Z" },
};

/** The memory of an instance whose agents noted one thing, on a clock that ticks each time it is read. */
function memory(): { memory: AgentMemory; lessons: MemoryLessonStore; memories: KeptMemories } {
  let tick = 0;
  const lessons = new MemoryLessonStore();
  const memories = new KeptMemories([NOTED]);
  const now = () => new Date(Date.UTC(2026, 10, 27, 10, tick++));
  let id = 0;
  return { memory: new AgentMemory(lessons, memories, now, () => `l${++id}`), lessons, memories };
}

describe("the memory of the agents", () => {
  it("lists the lessons and what the agents noted, the latest first, with how many are active and set aside", async () => {
    const { memory: agent } = memory();
    const added = await agent.add({ text: "Create customers by the API.", application: "shop", target: "design", active: true });
    assert.deepEqual(added, {
      id: "l1",
      type: "instruction",
      text: "Create customers by the API.",
      application: "shop",
      target: "design",
      active: true,
      at: "2026-11-27T10:00:00.000Z",
    });
    await agent.add({ text: "Never test the risk report.", target: "all", active: false });
    const list = await agent.list();
    assert.deepEqual(
      list.items.map(({ id, type, active }) => [id, type, active]),
      [
        ["l2", "instruction", false],
        ["l1", "instruction", true],
        ["m1", "inferred", true],
      ],
    );
    assert.deepEqual(list.items[2], {
      id: "m1",
      type: "inferred",
      text: "A refund takes a minute to show.",
      target: "all",
      active: true,
      at: "2026-11-27T09:00:00.000Z",
      filed: { domain: "orders", kind: "pitfall", role: "cartographer" },
    });
    assert.deepEqual(list.counts, { active: 2, inactive: 1 });
  });

  it("rewords, retargets, moves and sets aside a lesson, the whole project when its application is taken away", async () => {
    const { memory: agent } = memory();
    await agent.add({ text: "Create customers by the API.", application: "shop", target: "design", active: true });
    assert.deepEqual(await agent.change("l1", { text: "Again.", target: "all", active: false }), {
      id: "l1",
      type: "instruction",
      text: "Again.",
      application: "shop",
      target: "all",
      active: false,
      at: "2026-11-27T10:00:00.000Z",
    });
    const moved = await agent.change("l1", { application: null });
    assert.equal(moved.application, undefined);
    assert.equal((await agent.change("l1", { application: "crm" })).application, "crm");
  });

  it("rewords what an agent noted and sets it aside, keeping its tags and its source, and refuses to move it or retarget it", async () => {
    const { memory: agent, memories } = memory();
    const changed = await agent.change("m1", { text: "A refund shows after a minute.", active: false });
    assert.deepEqual([changed.text, changed.active], ["A refund shows after a minute.", false]);
    const [kept] = await memories.list({});
    assert.deepEqual([kept!.tags, kept!.source, kept!.revised?.role, kept!.disabled], [["refund"], "shop-api", "person", true]);
    assert.equal((await agent.change("m1", { active: true })).active, true);
    const refused = new MemoryRefusedError("What an agent noted is for every work and every application: only what it says and whether it applies change.");
    await assert.rejects(agent.change("m1", { target: "design" }), refused);
    await assert.rejects(agent.change("m1", { application: "shop" }), refused);
    await assert.rejects(agent.change("nowhere", { active: false }), new UnknownMemoryError("nowhere"));
    // What an agent noted of no source keeps none.
    const { source: _, ...unsourced } = NOTED;
    await memories.add({ ...unsourced, id: "m3" });
    await agent.change("m3", { text: "Again." });
    assert.equal((await memories.list({})).find(({ id }) => id === "m3")?.source, undefined);
  });

  it("dates a lesson by the clock of the system and gives it a random identifier by default", async () => {
    const before = new Date().toISOString();
    const added = await new AgentMemory(new MemoryLessonStore(), new KeptMemories()).add({ text: "x", target: "all", active: true });
    assert.match(added.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.ok(added.at >= before);
  });
});
