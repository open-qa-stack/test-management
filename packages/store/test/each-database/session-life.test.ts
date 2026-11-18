import assert from "node:assert/strict";
import { MessageNotPendingError, SessionEndedError, SessionStateError, UnknownSessionError } from "@open-qa-stack/domain";
import type { Session, SessionEvent, SessionResult, UnrankedEvent } from "@open-qa-stack/domain/sessions";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { instant } from "../../src/database/stored-values.ts";
import { SessionStore } from "../../src/sessions/session-store.ts";
import { at } from "../support/at.ts";
import { engineUnderTest } from "../support/database-engine.ts";
import { SessionDatabase } from "../support/session-database.ts";

/** What names the process the tests host their sessions as. */
const HOST = "host-under-test";

const RESULT: SessionResult = { outcome: "passed", durationMs: 30_000, modelRequests: 3, tests: [{ id: "profile", verdict: "passed", reason: "Passed." }] };

const noted = (seconds: number, text: string): UnrankedEvent => ({ at: at(seconds), type: "note", phase: "plan", text });

let sessions: SessionDatabase;
let store: SessionStore;
/** What the clock of the store tells, in seconds after the start of the tests. */
let now: number;
beforeAll(async () => {
  sessions = await SessionDatabase.create(engineUnderTest());
  store = new SessionStore(sessions.database, () => new Date(at(now)));
});
beforeEach(async () => {
  await sessions.clear();
  now = 0;
});
afterAll(() => sessions.drop());

/** Asks for a session at a given second. */
function asked(seconds: number, request = "cover the profile"): Promise<Session> {
  now = seconds;
  return store.ask({ request }, HOST);
}

/** Asks for a session, which its host starts at once. */
async function started(): Promise<Session> {
  const { id } = await asked(now);
  return store.start(id, HOST);
}

/** The events of a session as their rank and their type, in order. */
async function told(id: string): Promise<[number, SessionEvent["type"]][]> {
  return (await store.eventsAfter(id, 0)).map((event) => [event.id, event.type]);
}

/** The events a session gained after a rank, without the changes of state told before it. */
async function gained(id: string, after: number): Promise<SessionEvent[]> {
  return (await store.eventsAfter(id, 0)).slice(after);
}

/** The messages the database keeps of a session, in the order of their numbers, their dates as the store tells dates. */
async function messages(id: string): Promise<{ number: number; at: string; text: string; delivered_to: string | null; delivered_at: string | null }[]> {
  const rows = await sessions.database.kysely
    .selectFrom("session_messages")
    .select(["number", "at", "text", "delivered_to", "delivered_at"])
    .where("session_id", "=", id)
    .orderBy("number")
    .execute();
  return rows.map((row) => ({ ...row, at: instant(row.at), delivered_at: row.delivered_at === null ? null : instant(row.delivered_at) }));
}

/** Asserts that a command is refused with an error of a class, and wrote nothing to the session. */
async function refused(command: () => Promise<unknown>, error: new (...parameters: never[]) => Error, id: string): Promise<void> {
  const before = [await store.session(id), await store.eventsAfter(id, 0), await messages(id)];
  await assert.rejects(command(), (raised) => raised instanceof error && raised.name === error.name);
  assert.deepEqual([await store.session(id), await store.eventsAfter(id, 0), await messages(id)], before);
}

describe("a session that is asked for", () => {
  it("waits under an identifier of its own, with what the person asked as its first event", async () => {
    now = 45.12;
    const session = await store.ask({ request: "cover the profile", environment: "local" }, HOST);
    assert.match(session.id, /^session-2026-11-14T09-00-45-120Z-[0-9a-f]{8}$/);
    assert.deepEqual(session, {
      id: session.id,
      request: "cover the profile",
      environment: "local",
      openedAt: at(45.12),
      lastEventAt: at(45.12),
      state: "queued",
    });
    assert.deepEqual(await store.session(session.id), session);
    assert.equal(
      JSON.stringify(await store.eventsAfter(session.id, 0)),
      JSON.stringify([{ id: 1, at: at(45.12), type: "user_message", text: "cover the profile" }]),
    );
  });

  it("names no environment when the person named none", async () => {
    const session = await store.ask({ request: "cover the profile" }, HOST);
    assert.equal("environment" in session, false);
    assert.deepEqual(await store.session(session.id), session);
  });

  it("differs from another asked for in the same millisecond, and sorts after those asked for before", async () => {
    const [first, twin] = await Promise.all([asked(1), asked(1)]);
    const later = await asked(2);
    assert.notEqual(first.id, twin.id);
    assert.deepEqual([first.id, twin.id, later.id].sort().at(-1), later.id);
    assert.deepEqual((await store.sessions()).at(0), later);
  });

  it("is dated by the clock of the machine when the store is given none", async () => {
    const before = Date.now();
    const session = await sessions.store.ask({ request: "cover the profile" }, HOST);
    const opened = Date.parse(session.openedAt);
    assert.ok(opened >= before && opened <= Date.now(), session.openedAt);
  });
});

describe("a session its host starts", () => {
  it("runs from then on, which an event tells", async () => {
    const waiting = await asked(1);
    now = 10;
    const running = await store.start(waiting.id, HOST);
    assert.deepEqual(running, { ...waiting, state: "running", lastEventAt: at(10) });
    assert.deepEqual(await store.session(waiting.id), running);
    assert.deepEqual(await store.eventsAfter(waiting.id, 1), [{ id: 2, at: at(10), type: "state_changed", state: "running" }]);
  });

  it("is started once: one that runs already is refused, as are one that ended and one that does not exist", async () => {
    const { id } = await started();
    await refused(() => store.start(id, HOST), SessionStateError, id);
    await assert.rejects(store.start(id, HOST), { message: `The session ${id} takes no start while it is running.` });
    await store.interrupt(id);
    await refused(() => store.start(id, HOST), SessionEndedError, id);
    await refused(() => store.start("unknown", HOST), UnknownSessionError, "unknown");
  });

  it("is started by one of two that start it at the same time", async () => {
    const { id } = await asked(0);
    const starts = await Promise.allSettled([store.start(id, HOST), store.start(id, HOST)]);
    assert.deepEqual(starts.map(({ status }) => status).sort(), ["fulfilled", "rejected"]);
    assert.deepEqual(await told(id), [
      [1, "user_message"],
      [2, "state_changed"],
    ]);
  });
});

describe("the events appended to a session that runs", () => {
  it("take the ranks that follow the last event of the session, and date the session by the last of them", async () => {
    const { id } = await started();
    await store.say(id, "only what a customer sees");
    await store.append(id, [noted(5, "One."), noted(6, "Two.")]);
    assert.deepEqual(await gained(id, 3), [
      { id: 4, at: at(5), type: "note", phase: "plan", text: "One." },
      { id: 5, at: at(6), type: "note", phase: "plan", text: "Two." },
    ]);
    assert.deepEqual(await store.session(id), { id, request: "cover the profile", openedAt: at(0), lastEventAt: at(6), state: "running" });
  });

  it("change nothing when there are none", async () => {
    const session = await started();
    await store.append(session.id, []);
    assert.deepEqual(await store.session(session.id), session);
    assert.equal(await store.lastRank(session.id), 2);
  });

  it("are refused for a session that still waits", async () => {
    const waiting = await asked(1);
    await refused(() => store.append(waiting.id, [noted(1, "One.")]), SessionStateError, waiting.id);
    await assert.rejects(store.append(waiting.id, []), { message: `The session ${waiting.id} takes no append while it is queued.` });
  });

  it("are refused for a session that does not exist, and for one that ended, which tells its work to stop", async () => {
    await refused(() => store.append("unknown", [noted(1, "One.")]), UnknownSessionError, "unknown");
    const { id } = await started();
    await store.complete(id, RESULT);
    await refused(() => store.append(id, [noted(1, "One.")]), SessionEndedError, id);
    await refused(() => store.append(id, []), SessionEndedError, id);
  });
});

describe("a session that ends", () => {
  it("is completed with its result, which its last event tells", async () => {
    const { id } = await started();
    now = 30;
    await store.complete(id, RESULT);
    assert.deepEqual(await store.session(id), { id, request: "cover the profile", openedAt: at(0), lastEventAt: at(30), state: "completed", result: RESULT });
    assert.deepEqual((await store.eventsAfter(id, 0)).at(-1), { id: 3, at: at(30), type: "state_changed", state: "completed" });
  });

  it("is interrupted without a result, which its last event tells", async () => {
    const { id } = await started();
    now = 30;
    await store.interrupt(id);
    assert.deepEqual(await store.session(id), { id, request: "cover the profile", openedAt: at(0), lastEventAt: at(30), state: "interrupted" });
    assert.deepEqual((await store.eventsAfter(id, 0)).at(-1), { id: 3, at: at(30), type: "state_changed", state: "interrupted" });
  });

  it("can be interrupted while it still waits, and is then never started", async () => {
    const { id } = await asked(0);
    await store.interrupt(id);
    assert.equal((await store.session(id))?.state, "interrupted");
    await refused(() => store.start(id, HOST), SessionEndedError, id);
  });

  it("is completed while it runs alone: the end of a session that still waits is refused", async () => {
    const waiting = await asked(1);
    await refused(() => store.complete(waiting.id, RESULT), SessionStateError, waiting.id);
  });

  it("ends once: another end is refused, as is the end of a session that does not exist", async () => {
    const { id } = await started();
    await store.interrupt(id);
    await refused(() => store.complete(id, RESULT), SessionEndedError, id);
    await refused(() => store.interrupt(id), SessionEndedError, id);
    await refused(() => store.complete("unknown", RESULT), UnknownSessionError, "unknown");
    await refused(() => store.interrupt("unknown"), UnknownSessionError, "unknown");
  });
});

describe("a message a person sends to a session", () => {
  it("takes the number that follows the last of its session, waits for an agent, and is told by an event with that number", async () => {
    const { id } = await started();
    const other = await asked(1, "another");
    now = 5;
    assert.deepEqual(await store.say(id, "only what a customer sees"), { number: 1 });
    now = 6;
    assert.deepEqual(await store.say(id, "and not the admin pages"), { number: 2 });
    assert.deepEqual(await store.say(other.id, "to a session that still waits"), { number: 1 });
    assert.equal(
      JSON.stringify(await gained(id, 2)),
      JSON.stringify([
        { id: 3, at: at(5), type: "user_message", text: "only what a customer sees", number: 1 },
        { id: 4, at: at(6), type: "user_message", text: "and not the admin pages", number: 2 },
      ]),
    );
    assert.deepEqual(await messages(id), [
      { number: 1, at: at(5), text: "only what a customer sees", delivered_to: null, delivered_at: null },
      { number: 2, at: at(6), text: "and not the admin pages", delivered_to: null, delivered_at: null },
    ]);
    assert.equal((await store.session(id))?.lastEventAt, at(6));
  });

  it("is refused by a session that does not exist, and by one that ended", async () => {
    await refused(() => store.say("unknown", "to no one"), UnknownSessionError, "unknown");
    for (const end of [(id: string) => store.complete(id, RESULT), (id: string) => store.interrupt(id)]) {
      const { id } = await started();
      await end(id);
      await refused(() => store.say(id, "too late"), SessionEndedError, id);
    }
  });

  it("is numbered once, and every event ranked once, when messages and events are written to the session at the same time", async () => {
    const { id } = await started();
    const receipts: number[] = [];
    await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const message = store.say(id, `Message ${index + 1}.`).then(({ number }) => receipts.push(number));
        await Promise.all([message, store.append(id, [noted(index, `Event ${index + 1}.`), noted(index, `Its second.`)])]);
      }),
    );
    assert.deepEqual(
      receipts.sort((one, other) => one - other),
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    const events = await store.eventsAfter(id, 0);
    assert.deepEqual(
      events.map((event) => event.id),
      Array.from({ length: 62 }, (_, index) => index + 1),
    );
    assert.deepEqual(
      events.flatMap((event) => (event.type === "user_message" && event.number !== undefined ? [event.number] : [])),
      Array.from({ length: 20 }, (_, index) => index + 1),
      "the messages are told in the order of their numbers",
    );
    assert.deepEqual(
      (await messages(id)).map(({ number }) => number),
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    assert.equal(events.filter((event) => event.type === "note").length, 40);
  });
});

describe("the messages a session holds for its agents", () => {
  it("are pending in the order of their numbers until an agent received them, which an event tells", async () => {
    const { id } = await started();
    now = 5;
    await store.say(id, "only what a customer sees");
    now = 6;
    await store.say(id, "and not the admin pages");
    assert.deepEqual(await store.pendingMessages(id), [
      { number: 1, at: at(5), text: "only what a customer sees" },
      { number: 2, at: at(6), text: "and not the admin pages" },
    ]);
    now = 9;
    await store.deliver(id, 1, "planner");
    assert.deepEqual(await store.pendingMessages(id), [{ number: 2, at: at(6), text: "and not the admin pages" }]);
    assert.deepEqual((await store.eventsAfter(id, 0)).at(-1), { id: 5, at: at(9), type: "message_delivered", message: 1, agent: "planner" });
    assert.deepEqual(
      (await messages(id)).map(({ number, delivered_to, delivered_at }) => ({ number, delivered_to, delivered_at })),
      [
        { number: 1, delivered_to: "planner", delivered_at: at(9) },
        { number: 2, delivered_to: null, delivered_at: null },
      ],
    );
    assert.equal((await store.session(id))?.lastEventAt, at(9));
  });

  it("are none for a session that was sent none, or that does not exist", async () => {
    const { id } = await started();
    assert.deepEqual(await store.pendingMessages(id), []);
    assert.deepEqual(await store.pendingMessages("unknown"), []);
  });

  it("are delivered once: a message an agent received, or that the session does not hold, is refused", async () => {
    const { id } = await started();
    await store.say(id, "only what a customer sees");
    await store.deliver(id, 1, "planner");
    await refused(() => store.deliver(id, 1, "writer"), MessageNotPendingError, id);
    await refused(() => store.deliver(id, 2, "writer"), MessageNotPendingError, id);
  });

  it("are delivered while the session runs alone: one that still waits keeps them pending", async () => {
    const waiting = await asked(1);
    await store.say(waiting.id, "to a session that still waits");
    await refused(() => store.deliver(waiting.id, 1, "planner"), SessionStateError, waiting.id);
    assert.deepEqual(await store.pendingMessages(waiting.id), [{ number: 1, at: at(1), text: "to a session that still waits" }]);
  });

  it("reach one agent when two deliver the same message at the same time", async () => {
    const { id } = await started();
    await store.say(id, "only what a customer sees");
    const deliveries = await Promise.allSettled([store.deliver(id, 1, "planner"), store.deliver(id, 1, "writer")]);
    assert.deepEqual(deliveries.map(({ status }) => status).sort(), ["fulfilled", "rejected"]);
    assert.equal((await told(id)).filter(([, type]) => type === "message_delivered").length, 1);
  });

  it("are no longer delivered once their session ended, nor to a session that does not exist", async () => {
    await refused(() => store.deliver("unknown", 1, "planner"), UnknownSessionError, "unknown");
    const { id } = await started();
    await store.say(id, "only what a customer sees");
    await store.interrupt(id);
    await refused(() => store.deliver(id, 1, "planner"), SessionEndedError, id);
    assert.deepEqual(await store.pendingMessages(id), [{ number: 1, at: at(0), text: "only what a customer sees" }]);
  });

  it("are removed with their session", async () => {
    const { id } = await started();
    await store.say(id, "only what a customer sees");
    await sessions.database.kysely.deleteFrom("sessions").where("id", "=", id).execute();
    assert.deepEqual(await messages(id), []);
  });
});

/** What names another process that hosts sessions on the same database. */
const OTHER = "host-other";

/** How long without a beat tells the tests that a host died, in milliseconds. */
const SILENCE_MS = 15_000;

/** The host of a session and its last beat, as the database keeps them, with the interruption another process asked for. */
async function hosting(id: string): Promise<{ host: string | null; seen: string | null; asked: string | null }> {
  const row = await sessions.database.kysely
    .selectFrom("sessions")
    .select(["host", "host_seen_at", "interruption_requested_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
  const dated = (date: Date | string | null): string | null => (date === null ? null : instant(date));
  return { host: row.host, seen: dated(row.host_seen_at), asked: dated(row.interruption_requested_at) };
}

describe("the host of a session", () => {
  it("is the process that asked for it, then the one that starts it, each dated as its first beat", async () => {
    const { id } = await asked(3);
    assert.deepEqual(await hosting(id), { host: HOST, seen: at(3), asked: null });
    now = 5;
    await store.start(id, OTHER);
    assert.deepEqual(await hosting(id), { host: OTHER, seen: at(5), asked: null });
  });

  it("beats on the sessions it hosts that go on, and on no other", async () => {
    const waiting = await asked(0);
    const running = await started();
    const ended = await started();
    await store.interrupt(ended.id);
    const elsewhere = await store.ask({ request: "cover the orders" }, OTHER);
    now = 9;
    await store.beat(HOST);
    assert.deepEqual(
      (await Promise.all([waiting, running, ended, elsewhere].map(({ id }) => hosting(id)))).map(({ seen }) => seen),
      [at(9), at(9), at(0), at(0)],
    );
    assert.deepEqual((await store.session(running.id))?.lastEventAt, at(0), "a beat is no event");
  });

  it("withdraws its beats when it stops: its sessions that go on read as left at once", async () => {
    const waiting = await asked(0);
    const running = await started();
    const elsewhere = await store.ask({ request: "cover the orders" }, OTHER);
    await store.release(HOST);
    assert.deepEqual(
      (await Promise.all([waiting, running, elsewhere].map(({ id }) => hosting(id)))).map(({ seen }) => seen),
      [null, null, at(0)],
    );
    assert.deepEqual(await store.abandonSilent(SILENCE_MS), [running.id]);
    assert.deepEqual(await store.takeOver(OTHER, SILENCE_MS), [waiting.id]);
  });
});

describe("the sessions a host that went silent left running", () => {
  it("are interrupted, which an event tells, and named", async () => {
    const left = await started();
    const alsoLeft = await started();
    now = 15.001;
    assert.deepEqual((await store.abandonSilent(SILENCE_MS)).sort(), [left.id, alsoLeft.id].sort());
    for (const { id } of [left, alsoLeft]) {
      assert.deepEqual(await store.session(id), { id, request: "cover the profile", openedAt: at(0), lastEventAt: at(15.001), state: "interrupted" });
      assert.deepEqual((await store.eventsAfter(id, 0)).at(-1), { id: 3, at: at(15.001), type: "state_changed", state: "interrupted" });
    }
    await refused(() => store.append(left.id, [noted(16, "Too late.")]), SessionEndedError, left.id);
    assert.deepEqual(await store.abandonSilent(SILENCE_MS), []);
  });

  it("are those whose host did not beat for longer than the silence allowed: one whose host beats is left to it", async () => {
    const silent = await started();
    const alive = await store.start((await store.ask({ request: "cover the orders" }, OTHER)).id, OTHER);
    now = 15;
    assert.deepEqual(await store.abandonSilent(SILENCE_MS), [], "a beat as old as the silence allowed is still a beat");
    now = 20;
    await store.beat(OTHER);
    now = 30;
    assert.deepEqual(await store.abandonSilent(SILENCE_MS), [silent.id]);
    assert.equal((await store.session(alive.id))?.state, "running");
  });

  it("are those that run alone: one that waits and one that ended are left as they are", async () => {
    const ended = await started();
    await store.complete(ended.id, RESULT);
    await asked(0);
    const states = await store.sessions();
    now = 601;
    assert.deepEqual(await store.abandonSilent(SILENCE_MS), []);
    assert.deepEqual(await store.sessions(), states);
  });

  it("are also those that bear no host: a session an earlier version of the schema left running", async () => {
    const stamp = at(0);
    await sessions.database.kysely.insertInto("sessions").values({ id: "earlier", opened_at: stamp, last_event_at: stamp, state: "running" }).execute();
    assert.deepEqual(await store.abandonSilent(SILENCE_MS), ["earlier"]);
  });
});

describe("the sessions a host that went silent left waiting", () => {
  it("are taken over by a host that stays, in the order they were asked for, and wait for it from then on", async () => {
    const second = await asked(2);
    const first = await asked(1);
    const running = await started();
    const alive = await store.ask({ request: "cover the orders" }, OTHER);
    now = 20;
    await store.beat(OTHER);
    now = 30;
    assert.deepEqual(await store.takeOver("host-that-stays", SILENCE_MS), [first.id, second.id]);
    for (const { id } of [first, second]) assert.deepEqual(await hosting(id), { host: "host-that-stays", seen: at(30), asked: null });
    assert.equal((await hosting(running.id)).host, HOST, "a session that runs is not taken over: it is abandoned");
    assert.equal((await hosting(alive.id)).host, OTHER, "a session whose host beats is left to it");
    assert.deepEqual(await store.takeOver(OTHER, SILENCE_MS), [], "a session is taken over once");
    assert.deepEqual((await store.sessions()).map(({ state }) => state).sort(), ["queued", "queued", "queued", "running"]);
  });

  it("are taken in the order of their identifiers when they were asked for in the same millisecond", async () => {
    const twins = await Promise.all([asked(1), asked(1), asked(1)]);
    now = 30;
    assert.deepEqual(await store.takeOver(OTHER, SILENCE_MS), twins.map(({ id }) => id).sort());
  });
});

describe("an interruption another process asks for", () => {
  it("is kept for the host of a session that runs, which reads it among those of its sessions", async () => {
    const running = await started();
    const untouched = await started();
    now = 4;
    await store.requestInterruption(running.id, SILENCE_MS);
    assert.deepEqual(await hosting(running.id), { host: HOST, seen: at(0), asked: at(4) });
    assert.equal((await store.session(running.id))?.state, "running", "its host stops the run, then interrupts it");
    assert.deepEqual(await store.interruptionRequests(HOST), [running.id]);
    assert.deepEqual(await store.interruptionRequests(OTHER), []);
    assert.equal((await hosting(untouched.id)).asked, null);
    await store.interrupt(running.id);
    assert.deepEqual(await store.interruptionRequests(HOST), [], "a session that ended is asked nothing more");
  });

  it("interrupts at once a session that waits, and one whose host went silent: nobody would do it", async () => {
    const waiting = await asked(0);
    const left = await started();
    now = 1;
    await store.requestInterruption(waiting.id, SILENCE_MS);
    now = 16;
    await store.requestInterruption(left.id, SILENCE_MS);
    for (const { id } of [waiting, left]) assert.equal((await store.session(id))?.state, "interrupted");
    assert.deepEqual((await store.eventsAfter(waiting.id, 0)).at(-1), { id: 2, at: at(1), type: "state_changed", state: "interrupted" });
    assert.deepEqual((await store.eventsAfter(left.id, 0)).at(-1), { id: 3, at: at(16), type: "state_changed", state: "interrupted" });
    assert.deepEqual(await store.interruptionRequests(HOST), []);
  });

  it("interrupts at once a session whose host withdrew its beats", async () => {
    const left = await started();
    await store.release(HOST);
    await store.requestInterruption(left.id, SILENCE_MS);
    assert.equal((await store.session(left.id))?.state, "interrupted");
  });

  it("is refused for a session that ended, and for one that does not exist", async () => {
    const { id } = await started();
    await store.complete(id, RESULT);
    await refused(() => store.requestInterruption(id, SILENCE_MS), SessionEndedError, id);
    await refused(() => store.requestInterruption("unknown", SILENCE_MS), UnknownSessionError, "unknown");
  });
});
