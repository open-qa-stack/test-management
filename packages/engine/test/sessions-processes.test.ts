import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
import type { SessionEvent } from "@open-qa-stack/domain/sessions";
import { chain } from "@open-qa-stack/testing/test-repository";
import { afterEach, describe, it } from "vitest";
import { DEFAULT_PACE } from "../src/index.ts";
import { eventually } from "./support/eventually.ts";
import { designDoor, Hosted } from "./support/hosted.ts";
import { MemorySessionStore } from "./support/memory-session-store.ts";

const REQUEST = "Test the listing of the orders.";

/** A session whose run the configuration stops at once: it names an environment the test repository does not declare. */
const STOPPED_AT_ONCE = { request: REQUEST, environment: "nowhere" };

/** What names another process that hosts sessions on the store of a test. */
const OTHER = "host-other";

/** The paces of a host that beats every few milliseconds, and allows a host fifteen seconds of silence by the clock of the store. */
const BEATING = { beatMs: 5, silentAfterMs: 15_000, followMs: 5 };

/** A store whose clock a test sets, in milliseconds: what tells a silence is the clock of the store. */
function clocked(): { store: MemorySessionStore; set: (ms: number) => void } {
  let now = 0;
  return { store: new MemorySessionStore(() => new Date(now)), set: (ms) => void (now = ms) };
}

/** Waits until the store answered a command a number of times more. */
async function answered({ answered: counts }: MemorySessionStore, command: string, times = 2): Promise<void> {
  const from = counts.get(command) ?? 0;
  await eventually(() => assert.ok((counts.get(command) ?? 0) >= from + times));
}

let hosts: Hosted[] = [];
afterEach(async () => {
  for (const hosted of hosts) await hosted.close();
  hosts = [];
});

/** Hosts the operations for a test, closed after it. */
async function host(...setup: Parameters<typeof Hosted.create>): Promise<Hosted> {
  const hosted = await Hosted.create(...setup);
  hosts.push(hosted);
  return hosted;
}

describe("the paces of a process among the others that reach its store", () => {
  it("are a beat a second, a host silent after fifteen, and a followed session read twice a second, unless its host sets others", () => {
    assert.deepEqual(DEFAULT_PACE, { beatMs: 1000, silentAfterMs: 15_000, followMs: 500 });
  });
});

describe("what another process sends a session through the store", () => {
  it("is a message the host reads at its next beat: the agent at work receives it, once", async () => {
    const door = designDoor();
    const hosted = await host(chain(), { before: door.hold, host: { pace: BEATING } });
    const opened = await hosted.sessions.open({ request: REQUEST, environment: "local" });
    await door.reached;
    // Another process says it: the store takes it, and nothing tells this one but the store.
    assert.deepEqual(await hosted.store.say(opened.id, "Only what a customer sees."), { number: 1 });
    await answered(hosted.store, "pendingMessages");
    door.open();
    assert.equal((await hosted.ended(opened.id)).state, "completed");
    const delivered = (await hosted.events(opened.id)).filter((event) => event.type === "message_delivered");
    assert.deepEqual(
      delivered.map((event) => [event.message, event.agent]),
      [[1, "planner"]],
    );
  });

  it("is an interruption the host obeys at its next beat: the run stops, and the session is told interrupted", async () => {
    const door = designDoor();
    const hosted = await host(chain(), { before: door.hold, host: { pace: BEATING } });
    const opened = await hosted.sessions.open({ request: REQUEST, environment: "local" });
    const untouched = await hosted.sessions.open(STOPPED_AT_ONCE);
    await door.reached;
    await hosted.store.requestInterruption(opened.id, BEATING.silentAfterMs);
    assert.equal((await hosted.sessions.session(opened.id)).state, "running", "the host has not beaten yet");
    await answered(hosted.store, "interruptionRequests");
    door.open();
    const session = await hosted.ended(opened.id);
    assert.deepEqual([session.state, session.result], ["interrupted", undefined]);
    assert.ok(hosted.server.requests.length < chain().length, "the run stopped instead of going to its end");
    assert.equal((await hosted.ended(untouched.id)).state, "interrupted", "the next session ran");
    assert.ok((await hosted.events(untouched.id)).some((event) => event.type === "phase_started"));
  });
});

describe("a session another process hosts", () => {
  it("is interrupted through the store: at once when it waits, by its host when it runs", async () => {
    const hosted = await host([]);
    const waiting = await hosted.store.ask({ request: REQUEST }, OTHER);
    const running = await hosted.store.start((await hosted.store.ask({ request: REQUEST }, OTHER)).id, OTHER);
    await hosted.sessions.interrupt(waiting.id);
    await hosted.sessions.interrupt(running.id);
    assert.deepEqual([(await hosted.sessions.session(waiting.id)).state, (await hosted.sessions.session(running.id)).state], ["interrupted", "running"]);
    assert.deepEqual(await hosted.store.interruptionRequests(OTHER), [running.id]);
  });

  it("is said something through the store, which its host reads there", async () => {
    const hosted = await host([]);
    const running = await hosted.store.start((await hosted.store.ask({ request: REQUEST }, OTHER)).id, OTHER);
    assert.deepEqual(await hosted.sessions.say(running.id, { text: "Only what a customer sees." }), { number: 1 });
    assert.deepEqual(
      (await hosted.store.pendingMessages(running.id)).map(({ number, text }) => [number, text]),
      [[1, "Only what a customer sees."]],
    );
  });

  it("is followed by reading the store again at the pace of the process, to its end, and its thread so far is read at once", async () => {
    const hosted = await host([], { host: { pace: BEATING } });
    const running = await hosted.store.start((await hosted.store.ask({ request: REQUEST }, OTHER)).id, OTHER);
    const seen: SessionEvent[] = [];
    let ended = false;
    (await hosted.sessions.events(running.id, 0)).subscribe({ event: (event) => seen.push(event), ended: () => (ended = true), failed: assert.fail });
    await eventually(() => assert.equal(seen.length, 2));
    // The process that hosts the session tells it: nothing notifies this one.
    await hosted.store.append(running.id, [{ at: "2026-11-16T08:00:00.000Z", type: "note", phase: "plan", text: "Told elsewhere." }]);
    await eventually(() => assert.equal(seen.at(-1)?.type, "note"));
    assert.deepEqual(await hosted.sessions.thread(running.id), seen);
    assert.equal(ended, false);
    await hosted.store.interrupt(running.id);
    await eventually(() => assert.equal(ended, true));
    assert.deepEqual(seen, await hosted.events(running.id));
    const reads = hosted.store.answered.get("eventsAfter");
    await pause(BEATING.followMs * 4);
    assert.equal(hosted.store.answered.get("eventsAfter"), reads, "a session that ended is read no more");
    await assert.rejects(hosted.sessions.thread("unknown"), { name: "UnknownSessionError" });
  });

  it("is left to its host as long as that host beats: a host that starts on the same store neither interrupts it nor takes it over", async () => {
    const { store, set } = clocked();
    const door = designDoor();
    const first = await host(chain(), { store, before: door.hold, host: { pace: BEATING } });
    const running = await first.sessions.open({ request: REQUEST, environment: "local" });
    const waiting = await first.sessions.open(STOPPED_AT_ONCE);
    await door.reached;
    const second = await host([], { store, host: { pace: BEATING } });
    await second.sessions.start();
    // Time goes by, by the clock of the store: the first host beats, and its sessions stay its own.
    set(10_000);
    await answered(store, "beat", 4);
    set(20_000);
    await answered(store, "abandonSilent", 4);
    assert.deepEqual([(await second.sessions.session(running.id)).state, (await second.sessions.session(waiting.id)).state], ["running", "queued"]);
    assert.deepEqual(second.logger.lines, []);
    door.open();
    assert.equal((await first.ended(running.id)).state, "completed");
    assert.equal((await first.ended(waiting.id)).state, "interrupted");
    assert.ok(first.logger.lines.includes(`log The session ${waiting.id} starts.`), "the host that was asked for the session ran it");
  });
});

describe("the sessions of a host that died", () => {
  it("are seen to by a host that stays, once the silence of the dead one lasted: one that ran is interrupted, those that waited are run in the order they were asked for", async () => {
    const { store, set } = clocked();
    const left = await store.start((await store.ask({ request: "left running" }, OTHER)).id, OTHER);
    const first = await store.ask(STOPPED_AT_ONCE, OTHER);
    const second = await store.ask(STOPPED_AT_ONCE, OTHER);
    const hosted = await host([], { store, host: { pace: BEATING } });
    await hosted.sessions.start();
    set(BEATING.silentAfterMs);
    await answered(store, "takeOver");
    assert.deepEqual(
      (await Promise.all([left, first, second].map(({ id }) => hosted.sessions.session(id)))).map(({ state }) => state),
      ["running", "queued", "queued"],
      "a beat as old as the silence allowed is still a beat",
    );
    set(BEATING.silentAfterMs + 1);
    assert.equal((await hosted.ended(left.id)).state, "interrupted");
    await hosted.ended(first.id);
    await hosted.ended(second.id);
    await eventually(() =>
      assert.deepEqual(hosted.logger.lines, [
        "warn 1 session was left running by a process that stopped, and interrupted.",
        `log The session ${first.id} starts.`,
        `log The session ${first.id} is over.`,
        `log The session ${second.id} starts.`,
        `log The session ${second.id} is over.`,
      ]),
    );
  });

  it("are interrupted when they ran, and left to wait when they waited, by a host that runs the session it opens and leaves", async () => {
    const { store, set } = clocked();
    const left = await store.start((await store.ask({ request: "left running" }, OTHER)).id, OTHER);
    const waiting = await store.ask(STOPPED_AT_ONCE, OTHER);
    await store.release(OTHER);
    const hosted = await host([], { store, host: { takesOver: false, pace: BEATING } });
    const opened = await hosted.sessions.open(STOPPED_AT_ONCE);
    assert.equal((await hosted.ended(opened.id)).state, "interrupted");
    assert.equal((await hosted.sessions.session(left.id)).state, "interrupted");
    set(60_000);
    await answered(store, "abandonSilent");
    assert.equal((await hosted.sessions.session(waiting.id)).state, "queued", "it waits for a host that stays");
    assert.equal(store.answered.get("takeOver"), undefined);
  });

  it("are interrupted at once when someone asks, without waiting for a host to see to them", async () => {
    const hosted = await host([]);
    const left = await hosted.store.start((await hosted.store.ask({ request: REQUEST }, OTHER)).id, OTHER);
    await hosted.store.release(OTHER);
    await hosted.sessions.interrupt(left.id);
    assert.equal((await hosted.sessions.session(left.id)).state, "interrupted");
  });
});

describe("a host whose store does not answer its beat", () => {
  it("says so once, beats again, and says once that the store answers again", async () => {
    const hosted = await host([], { host: { pace: BEATING } });
    await hosted.sessions.start();
    let down = true;
    hosted.store.before = (command) => {
      if (command === "beat" && down) throw new Error("The database is unreachable.");
    };
    await eventually(() => assert.ok(hosted.logger.lines.length > 0));
    await pause(BEATING.beatMs * 4);
    assert.deepEqual(hosted.logger.lines, ["warn The store does not answer the beat of this process, which is made again: The database is unreachable."]);
    down = false;
    await answered(hosted.store, "beat");
    assert.deepEqual(hosted.logger.lines.slice(1), ["log The store answers again: the sessions of this process are seen alive."]);
  });
});

describe("a host that stops, among the others", () => {
  it("withdraws its beats, once: the sessions it still hosts are seen as left at once by a host that stays", async () => {
    const { store } = clocked();
    const door = designDoor();
    const first = await host(chain(), { store, before: door.hold, host: { pace: BEATING } });
    const running = await first.sessions.open({ request: REQUEST, environment: "local" });
    const waiting = await first.sessions.open(STOPPED_AT_ONCE);
    await door.reached;
    assert.equal(await first.sessions.stop(10), false);
    assert.equal(store.answered.get("release"), 1);
    const beats = store.answered.get("beat");
    await pause(BEATING.beatMs * 4);
    assert.equal(store.answered.get("beat"), beats, "a host that stopped beats no more");
    const second = await host([], { store });
    await second.sessions.start();
    assert.equal((await second.sessions.session(running.id)).state, "interrupted");
    assert.equal((await second.ended(waiting.id)).state, "interrupted");
    assert.ok(second.logger.lines.includes(`log The session ${waiting.id} starts.`));
    door.open();
    await eventually(() => assert.ok(first.logger.lines.includes(`log The session ${running.id} is over.`)));
  });

  it("says so when its store refuses to withdraw them, and withdraws nothing when it never started", async () => {
    const hosted = await host([]);
    assert.equal(await hosted.sessions.stop(10), true);
    assert.equal(hosted.store.answered.get("release"), undefined);
    const started = await host([]);
    await started.sessions.start();
    started.store.before = (command) => {
      if (command === "release") throw new Error("The database is unreachable.");
    };
    assert.equal(await started.sessions.stop(10), true);
    assert.deepEqual(started.logger.lines, ["warn The sessions of this process stay as its last beat left them: The database is unreachable."]);
  });
});
