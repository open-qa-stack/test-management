import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import type { RunEntry, RunState } from "@open-qa-stack/domain";
import type { SessionEvent } from "@open-qa-stack/domain/sessions";
import { afterAll, describe, it } from "vitest";
import { EventNotifications } from "../src/sessions/event-notifications.ts";
import { repositoryProject } from "../src/sessions/repository-project.ts";
import { RunningExecutions, type RunningExecution } from "../src/sessions/running-executions.ts";
import { SessionEventStream } from "../src/sessions/session-event-stream.ts";
import { SessionInbox } from "../src/sessions/session-inbox.ts";
import { SessionJournal } from "../src/sessions/session-journal.ts";
import { SessionRunStore } from "../src/sessions/session-run-store.ts";
import { WaitingSessions } from "../src/sessions/waiting-sessions.ts";
import { eventually } from "./support/eventually.ts";
import { held } from "./support/held.ts";
import { MemorySessionStore } from "./support/memory-session-store.ts";

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** A test repository whose configuration holds a given text; none when the text is left out. */
function repositoryWith(configuration?: string): string {
  const folder = mkdtempSync(join(tmpdir(), "oqas-session-project-"));
  folders.push(folder);
  if (configuration !== undefined) writeFileSync(join(folder, "oqas.json"), configuration);
  return folder;
}

describe("the project of a test repository", () => {
  it("is named after its folder, with the applications its configuration declares, one without a name named after its identifier", async () => {
    const folder = repositoryWith(JSON.stringify({ applications: [{ id: "shop", name: "Shop" }, { id: "back-office" }, { name: "No identifier" }, "shop"] }));
    assert.deepEqual(await repositoryProject(folder), {
      name: basename(folder),
      applications: [
        { id: "shop", name: "Shop" },
        { id: "back-office", name: "back-office" },
      ],
    });
  });

  it("has no application when the configuration declares none as a list, is no object, is no JSON, or cannot be read", async () => {
    for (const folder of [repositoryWith('{"applications":{}}'), repositoryWith("[]"), repositoryWith("{"), repositoryWith()])
      assert.deepEqual(await repositoryProject(folder), { name: basename(folder), applications: [] });
  });
});

const entry = (message: string): RunEntry => ({ at: "2026-11-16T08:00:00.000Z", step: "configuration", event: "info", message });

describe("the journal of a run, as its session tells it", () => {
  it("holds the entries until the run has its journal kept, tells those the run gives then, masked, and each one after it as it is written", () => {
    const told: string[] = [];
    const journal = new SessionJournal("s1", ({ message }) => told.push(message));
    journal.entry(entry("The key is k-123."));
    assert.deepEqual(told, []);
    journal.keep({ runId: "oqas-1", stateDir: ".oqas" }, [entry("The key is ***.")]);
    journal.entry(entry("The cartography starts."));
    assert.deepEqual(told, ["The key is ***.", "The cartography starts."]);
    journal.release();
    assert.deepEqual(told, ["The key is ***.", "The cartography starts."]);
  });

  it("tells the entries it held as they were written when the run ended before its journal was kept, once", () => {
    const told: string[] = [];
    const journal = new SessionJournal("s1", ({ message }) => told.push(message));
    journal.entry(entry("The configuration starts."));
    journal.entry(entry("oqas.json cannot be read."));
    journal.release();
    journal.release();
    assert.deepEqual(told, ["The configuration starts.", "oqas.json cannot be read."]);
  });

  it("is kept where the events of its session are read", () => {
    assert.equal(new SessionJournal("s1", () => undefined).location(), "sessions/s1/events");
  });
});

describe("the state of a run, as its session keeps it", () => {
  const state: RunState = {
    formatVersion: 1,
    runId: "oqas-2026-11-16T08-00-00-000Z",
    environment: "local",
    startedAt: "2026-11-16T08:00:00.000Z",
    durationMs: 4000,
    exitCode: 1,
    steps: [
      { step: "cartography", durationMs: 1000, modelRequests: 2 },
      { step: "design", durationMs: 3000, modelRequests: 5 },
    ],
    branch: "oqas/design",
    designed: ["orders.spec.ts"],
    tests: [{ id: "orders", verdict: "failed", reason: "The total is wrong." }],
    journal: "sessions/s1/events",
  };

  it("gives no result until the run wrote its state, then the result the domain reads from it", async () => {
    const store = new SessionRunStore();
    assert.equal(store.result, undefined);
    await store.write({ runId: state.runId, stateDir: ".oqas" }, state);
    assert.deepEqual(store.result, {
      outcome: "failed",
      durationMs: 4000,
      modelRequests: 7,
      branch: "oqas/design",
      tests: [{ id: "orders", verdict: "failed", reason: "The total is wrong." }],
    });
  });
});

describe("the inbox of the execution of a session", () => {
  it("holds the messages it was dropped until an agent received them", () => {
    const inbox = new SessionInbox();
    assert.deepEqual([inbox.pending(), inbox.heard()], [[], []]);
    inbox.drop({ number: 1, text: "One." });
    inbox.drop({ number: 2, text: "Two." });
    inbox.drop({ number: 3, text: "Three." });
    inbox.delivered(2);
    assert.deepEqual(inbox.pending(), [{ number: 3, text: "Three." }]);
    assert.deepEqual(inbox.heard(), [
      { number: 1, text: "One." },
      { number: 2, text: "Two." },
    ]);
    inbox.delivered(3);
    assert.deepEqual([inbox.pending().length, inbox.heard().length], [0, 3]);
  });

  it("takes a message once, whoever drops it again, and gives the messages in the order of their numbers", () => {
    const inbox = new SessionInbox();
    // A message said while the execution starts is dropped by whoever said it, then again among those the store kept.
    inbox.drop({ number: 2, text: "Two." });
    inbox.drop({ number: 1, text: "One." });
    inbox.drop({ number: 2, text: "Two." });
    assert.deepEqual(inbox.pending(), [
      { number: 1, text: "One." },
      { number: 2, text: "Two." },
    ]);
    inbox.delivered(2);
    inbox.drop({ number: 1, text: "One." });
    assert.deepEqual(inbox.pending(), [], "a message an agent received is not given again");
  });
});

describe("the registry of the executions that run", () => {
  const execution = (): RunningExecution => ({ inbox: new SessionInbox(), stop: new AbortController(), ended: Promise.resolve() });

  it("finds the execution of a session again from its identifier, until it is removed", () => {
    const registry = new RunningExecutions();
    const [first, second] = [execution(), execution()];
    assert.deepEqual([registry.find("s1"), registry.all()], [undefined, []]);
    registry.add("s1", first);
    registry.add("s2", second);
    assert.equal(registry.find("s1"), first);
    assert.equal(registry.find("s2"), second);
    assert.deepEqual(registry.all(), [first, second]);
    registry.remove("s1");
    registry.remove("s1");
    assert.deepEqual([registry.find("s1"), registry.all()], [undefined, [second]]);
  });

  it("gives every execution under the identifier of its session, in the order they were added", () => {
    const registry = new RunningExecutions();
    const [one, other] = [execution(), execution()];
    registry.add("s2", one);
    registry.add("s1", other);
    assert.deepEqual(registry.entries(), [
      ["s2", one],
      ["s1", other],
    ]);
  });

  it("holds one execution per session: a session that runs is not added again", () => {
    const registry = new RunningExecutions();
    const first = execution();
    registry.add("s1", first);
    assert.throws(() => registry.add("s1", execution()), { message: "The session s1 is already running." });
    assert.equal(registry.find("s1"), first);
  });

  it("gives what an operation needs of an execution: its inbox to speak to it, its stop to interrupt it, its end to wait for it", async () => {
    const registry = new RunningExecutions();
    const over = held();
    registry.add("s1", { inbox: new SessionInbox(), stop: new AbortController(), ended: over.promise });
    registry.find("s1")?.inbox.drop({ number: 1, text: "One." });
    registry.find("s1")?.stop.abort();
    over.resolve();
    await registry.find("s1")?.ended;
    assert.deepEqual([registry.find("s1")?.inbox.pending().length, registry.find("s1")?.stop.signal.aborted], [1, true]);
  });
});

describe("the sessions that wait their turn", () => {
  it("are taken in the order they were added, one at a time, but those that were removed", () => {
    const waiting = new WaitingSessions();
    assert.equal(waiting.next(), undefined);
    for (const id of ["s1", "s2", "s3"]) waiting.add(id);
    waiting.remove("s2");
    waiting.remove("unknown");
    assert.deepEqual([waiting.has("s1"), waiting.has("s2"), waiting.has("unknown")], [true, false, false]);
    assert.deepEqual([waiting.next(), waiting.next(), waiting.next()], ["s1", "s3", undefined]);
    assert.equal(waiting.has("s1"), false);
  });
});

describe("the notifications of the events of the sessions", () => {
  it("wake whoever follows the session notified, and no one else, until they leave", () => {
    const notifications = new EventNotifications();
    const woken: string[] = [];
    const leave = notifications.follow("s1", () => woken.push("first of s1"));
    notifications.follow("s1", () => woken.push("second of s1"));
    notifications.follow("s2", () => woken.push("of s2"));
    notifications.notify("s1");
    notifications.notify("unknown");
    assert.deepEqual(woken, ["first of s1", "second of s1"]);
    leave();
    notifications.notify("s1");
    assert.deepEqual(woken, ["first of s1", "second of s1", "second of s1"]);
  });

  it("keep waking those that follow a session after another left it twice", () => {
    const notifications = new EventNotifications();
    let woken = 0;
    const leave = notifications.follow("s1", () => assert.fail("left"));
    leave();
    notifications.follow("s1", () => (woken += 1));
    leave();
    notifications.notify("s1");
    assert.equal(woken, 1);
  });
});

/** The events of a session as a test follows them. */
function followed(stream: SessionEventStream): { readonly events: SessionEvent[]; readonly ends: unknown[]; readonly leave: () => void } {
  const events: SessionEvent[] = [];
  const ends: unknown[] = [];
  const leave = stream.subscribe({ event: (event) => events.push(event), ended: () => ends.push("ended"), failed: (error) => ends.push(error) });
  return { events, ends, leave };
}

describe("the events of a session, from a rank on", () => {
  /** A store that holds one session, which runs. */
  async function running(): Promise<{ store: MemorySessionStore; notifications: EventNotifications; id: string }> {
    const store = new MemorySessionStore();
    const { id } = await store.ask({ request: "cover the profile" }, "host");
    await store.start(id, "host");
    return { store, notifications: new EventNotifications(), id };
  }
  const note = (text: string) => ({ at: "2026-11-16T08:00:00.000Z", type: "note", phase: "plan", text }) as const;

  it("are those the store holds, then each one the session gains once it is notified, and end with the one that tells the end of the session", async () => {
    const { store, notifications, id } = await running();
    const { events, ends } = followed(new SessionEventStream(store, notifications, id, 0));
    await eventually(() =>
      assert.deepEqual(
        events.map((event) => event.id),
        [1, 2],
      ),
    );
    await store.append(id, [note("One.")]);
    await pause(20);
    assert.equal(events.length, 2, "the store is not polled: an event nobody notified is not read");
    notifications.notify(id);
    await eventually(() => assert.equal(events.length, 3));
    await store.interrupt(id);
    notifications.notify(id);
    await eventually(() => assert.deepEqual(ends, ["ended"]));
    assert.deepEqual(
      events.map((event) => event.type),
      ["user_message", "state_changed", "note", "state_changed"],
    );
    const reads = store.answered.get("eventsAfter");
    notifications.notify(id);
    await pause(20);
    assert.equal(store.answered.get("eventsAfter"), reads, "events that ended are followed no more");
  });

  it("start after the rank given, and end at once when the end of the session is at or before it", async () => {
    const { store, notifications, id } = await running();
    await store.append(id, [note("One."), note("Two.")]);
    const resumed = followed(new SessionEventStream(store, notifications, id, 3));
    await eventually(() =>
      assert.deepEqual(
        resumed.events.map((event) => event.id),
        [4],
      ),
    );
    await store.interrupt(id);
    const late = followed(new SessionEventStream(store, notifications, id, 5));
    await eventually(() => assert.deepEqual(late.ends, ["ended"]));
    assert.deepEqual(late.events, []);
    resumed.leave();
  });

  it("go on through an end a person resumed the session from, and end with the end of its last turn", async () => {
    const { store, notifications, id } = await running();
    await store.interrupt(id);
    await store.resume(id, "Go on.", "host");
    const { events, ends } = followed(new SessionEventStream(store, notifications, id, 0));
    const after = followed(new SessionEventStream(store, notifications, id, 3));
    await eventually(() => assert.deepEqual([events.length, after.events.length], [5, 2]));
    await pause(20);
    assert.deepEqual([ends, after.ends], [[], []]);
    await store.start(id, "host");
    await store.complete(id, { outcome: "passed", durationMs: 1, modelRequests: 1, tests: [] });
    notifications.notify(id);
    await eventually(() => assert.deepEqual([ends, after.ends], [["ended"], ["ended"]]));
    assert.deepEqual(
      events.map((event) => (event.type === "state_changed" ? event.state : event.type)),
      ["user_message", "running", "interrupted", "user_message", "queued", "running", "completed"],
    );
  });

  it("tell no end to a listener that left on the last event before it", async () => {
    const { store, notifications, id } = await running();
    await store.interrupt(id);
    const ends: string[] = [];
    const leave = new SessionEventStream(store, notifications, id, 0).subscribe({
      event: (event) => {
        if (event.id === 3) leave();
      },
      ended: () => ends.push("ended"),
      failed: assert.fail,
    });
    await pause(20);
    assert.deepEqual(ends, []);
  });

  it("are read once more after a reading during which the session was notified, from the last event told", async () => {
    const { store, notifications, id } = await running();
    const reading = held();
    let reads = 0;
    store.before = (command) => {
      reads += command === "eventsAfter" ? 1 : 0;
      return command === "eventsAfter" && reads === 1 ? reading.promise : undefined;
    };
    const { events, leave } = followed(new SessionEventStream(store, notifications, id, 0));
    await eventually(() => assert.equal(reads, 1));
    notifications.notify(id);
    notifications.notify(id);
    reading.resolve();
    await eventually(() => assert.equal(reads, 2));
    await pause(20);
    assert.deepEqual([reads, events.map((event) => event.id)], [2, [1, 2]]);
    leave();
  });

  it("are no longer read, nor told, once they are left: while they wait, in the middle of a reading, or from the listener itself", async () => {
    const { store, notifications, id } = await running();
    const waiting = followed(new SessionEventStream(store, notifications, id, 0));
    await eventually(() => assert.equal(waiting.events.length, 2));
    waiting.leave();
    const reads = store.answered.get("eventsAfter");
    await store.append(id, [note("One.")]);
    notifications.notify(id);
    await pause(20);
    assert.deepEqual([store.answered.get("eventsAfter"), waiting.events.length], [reads, 2]);

    const reading = held();
    store.before = (command) => (command === "eventsAfter" ? reading.promise : undefined);
    const midway = followed(new SessionEventStream(store, notifications, id, 0));
    midway.leave();
    reading.resolve();
    await pause(20);
    assert.deepEqual([midway.events, midway.ends], [[], []]);

    store.before = () => undefined;
    const told: number[] = [];
    const leave = new SessionEventStream(store, notifications, id, 0).subscribe({
      event: (event) => {
        told.push(event.id);
        leave();
      },
      ended: assert.fail,
      failed: assert.fail,
    });
    await pause(20);
    assert.deepEqual(told, [1]);
  });

  it("fail when the store can no longer be read, which releases them; a failure after they were left is told to no one", async () => {
    const { store, notifications, id } = await running();
    const down = new Error("The database is unreachable.");
    store.before = (command) => {
      if (command === "eventsAfter") throw down;
    };
    const { events, ends } = followed(new SessionEventStream(store, notifications, id, 0));
    await eventually(() => assert.deepEqual(ends, [down]));
    notifications.notify(id);
    await pause(20);
    assert.deepEqual([events, ends, store.answered.get("eventsAfter")], [[], [down], undefined]);

    const reading = held();
    store.before = async (command) => {
      if (command !== "eventsAfter") return;
      await reading.promise;
      throw down;
    };
    const left = followed(new SessionEventStream(store, notifications, id, 0));
    left.leave();
    reading.resolve();
    await pause(20);
    assert.deepEqual(left.ends, []);
  });
});
