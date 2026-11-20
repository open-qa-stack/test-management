import assert from "node:assert/strict";
import type { Session, SessionResult, UnrankedEvent } from "@open-qa-stack/domain/sessions";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { Database } from "../../src/database/database.ts";
import { DatabaseUrl } from "../../src/database/database-url.ts";
import { SessionStore } from "../../src/sessions/session-store.ts";
import { at } from "../support/at.ts";
import { engineUnderTest } from "../support/database-engine.ts";
import { RecordingLogger } from "../support/recording-logger.ts";
import { SessionDatabase } from "../support/session-database.ts";

/** What names the process the tests host their sessions as. */
const HOST = "host-under-test";

const RESULT: SessionResult = {
  outcome: "passed",
  durationMs: 30_000,
  modelRequests: 3,
  branch: "oqas/design",
  tests: [{ id: "profile", verdict: "passed", reason: "Passed." }],
};

const said = (seconds: number, text: string): UnrankedEvent => ({ at: at(seconds), type: "note", phase: "plan", text });

const engine = engineUnderTest();

let sessions: SessionDatabase;
let store: SessionStore;
/** What the clock of the store tells, in seconds after the start of the tests. */
let now: number;
beforeAll(async () => {
  sessions = await SessionDatabase.create(engine);
  store = new SessionStore(sessions.database, () => new Date(at(now)));
});
beforeEach(async () => {
  await sessions.clear();
  now = 0;
});
afterAll(() => sessions.drop());

/** Asks for a session at a given second, which its host starts at once. */
async function running(seconds: number): Promise<Session> {
  now = seconds;
  const { id } = await store.ask({ request: "cover the profile", environment: "local" }, HOST);
  return store.start(id, HOST);
}

describe("the project the store keeps", () => {
  it("has neither name nor application until one is saved", async () => {
    assert.deepEqual(await store.project(), { applications: [] });
  });

  it("is the one saved last, whose name is left out when it has none", async () => {
    await store.saveProject({ name: "shop-tests", applications: [{ id: "shop", name: "Shop" }] });
    assert.deepEqual(await store.project(), { name: "shop-tests", applications: [{ id: "shop", name: "Shop" }] });
    await store.saveProject({ applications: [] });
    assert.deepEqual(await store.project(), { applications: [] });
    assert.equal((await sessions.database.kysely.selectFrom("project").select("name").execute()).length, 1);
  });
});

describe("a session the store keeps", () => {
  it("is read as it is now, its result once it is completed, in the order a client reads its fields", async () => {
    const session = await running(0);
    assert.deepEqual(await store.session(session.id), session);
    now = 30;
    await store.complete(session.id, RESULT);
    const completed = {
      id: session.id,
      request: "cover the profile",
      environment: "local",
      openedAt: at(0),
      lastEventAt: at(30),
      state: "completed",
      result: RESULT,
    };
    assert.equal(JSON.stringify(await store.session(session.id)), JSON.stringify(completed));
  });

  it("keeps what of the project it keeps its work to, as it was asked", async () => {
    const scope = { applications: ["policy-management"], domains: ["insurance-quotes", "policies"], levels: ["functional" as const] };
    const asked = await store.ask({ request: "cover the quotes", environment: "local", scope }, "host");
    assert.deepEqual(asked.scope, scope);
    assert.equal(JSON.stringify((await store.session(asked.id))?.scope), JSON.stringify(scope));
  });

  it("is read without what its row lacks: a request, an environment, a result", async () => {
    await sessions.database.kysely
      .insertInto("sessions")
      .values({ id: "s1", opened_at: at(0), last_event_at: at(0), state: "interrupted" })
      .execute();
    assert.deepEqual(await store.session("s1"), { id: "s1", openedAt: at(0), lastEventAt: at(0), state: "interrupted" });
  });

  it("is listed with the others, the latest opened first", async () => {
    const first = await running(0);
    const third = await running(60);
    const second = await running(30);
    assert.deepEqual(await store.sessions(), [third, second, first]);
  });

  it("is nothing when the store holds none of its identifier: it has no rank, and no event", async () => {
    assert.equal(await store.session("unknown"), undefined);
    assert.equal(await store.lastRank("unknown"), 0);
    assert.deepEqual(await store.eventsAfter("unknown", 0), []);
    assert.deepEqual(await store.sessions(), []);
  });
});

describe("the events the store keeps of a session", () => {
  it("are read as they were written, their fields in the order they were given", async () => {
    const { id } = await running(0);
    await store.append(id, [said(1, "One."), { at: at(2), type: "action_started", action: "a1", agent: "planner", tool: "read", arguments: { z: 1, a: [2] } }]);
    assert.equal(
      JSON.stringify(await store.eventsAfter(id, 2)),
      JSON.stringify([
        { id: 2, at: at(0), type: "state_changed", state: "running" },
        { id: 3, at: at(1), type: "note", phase: "plan", text: "One." },
        { id: 4, at: at(2), type: "action_started", action: "a1", agent: "planner", tool: "read", arguments: { z: 1, a: [2] } },
      ]),
    );
    assert.equal(await store.lastRank(id), 4);
  });

  it("are kept whole, however long: a megabyte of text over many lines, in the arguments and the look of an action", async () => {
    const { id } = await running(0);
    const long = Array.from({ length: 4096 }, (_, rank) => `ligne ${rank} — ${"é".repeat(250)}`).join("\n");
    const events: UnrankedEvent[] = [
      { at: at(1), type: "refusal", phase: "write", code: "TEST-CHECK", text: long },
      { at: at(2), type: "action_started", action: "a1", agent: "writer", tool: "run_test", arguments: { content: long } },
      {
        at: at(3),
        type: "action_finished",
        action: "a1",
        outcome: "passed",
        result: long,
        durationMs: 1,
        look: { kind: "file", name: "a.spec.ts", lines: long.split("\n") },
      },
    ];
    await store.append(id, events);
    assert.deepEqual(
      (await store.eventsAfter(id, 2)).slice(1),
      events.map((event, rank) => ({ id: rank + 3, ...event })),
    );
  });

  it("belong to their session alone", async () => {
    const first = await running(0);
    const second = await running(60);
    await store.append(first.id, [said(1, "Of the first.")]);
    await store.append(second.id, [said(61, "Of the second."), said(62, "Of the second too.")]);
    assert.deepEqual([await store.lastRank(first.id), await store.lastRank(second.id)], [3, 4]);
    assert.deepEqual(
      (await store.eventsAfter(first.id, 0)).map(({ type }) => type),
      ["user_message", "state_changed", "note"],
    );
  });

  it("are read after a rank, with the changes of state told up to it", async () => {
    const { id } = await running(0);
    await store.append(id, [said(2, "Two."), said(3, "Three.")]);
    await store.complete(id, RESULT);
    const ranksAfter = async (rank: number) => (await store.eventsAfter(id, rank)).map((event) => event.id);
    assert.deepEqual(await ranksAfter(0), [1, 2, 3, 4, 5]);
    assert.deepEqual(await ranksAfter(3), [2, 4, 5]);
    assert.deepEqual(await ranksAfter(5), [2, 5]);
    assert.deepEqual(await ranksAfter(9), [2, 5]);
  });

  it("are written whole or not at all: an event that cannot be written leaves the session as it was", async () => {
    const session = await running(0);
    const unwritable = { ...said(2, "Two."), at: "not a date" };
    await assert.rejects(store.append(session.id, [said(1, "One."), unwritable]));
    assert.deepEqual(await store.session(session.id), session);
    assert.equal(await store.lastRank(session.id), 2);
  });

  it("are removed with their session", async () => {
    const { id } = await running(0);
    await sessions.database.kysely.deleteFrom("sessions").where("id", "=", id).execute();
    assert.equal(await store.lastRank(id), 0);
  });
});

describe("a store whose database fails", () => {
  it("raises the error of the database, without the statement nor its values", async () => {
    const empty = await engine.create();
    const database = new Database(DatabaseUrl.parse(empty.url) as DatabaseUrl, new RecordingLogger());
    try {
      await assert.rejects(new SessionStore(database).ask({ request: "witness-4b1d" }, HOST), (error: Error) => {
        assert.match(error.message, /^(relation "sessions" does not exist|no such table: sessions)$/);
        assert.ok(!String(error.stack).includes("witness-4b1d"));
        return true;
      });
    } finally {
      await database.close();
      await empty.drop();
    }
  });
});
