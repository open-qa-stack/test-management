import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { basename } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { Logger } from "@nestjs/common";
import type { MessageReceipt, Problem, Session, SessionEvent, SessionList, SessionResult } from "@open-qa-stack/domain/sessions";
import type { EventListener } from "@open-qa-stack/engine";
import type { SessionStore } from "@open-qa-stack/store";
import { acceptConnections, listeningConnections, refuseConnections, SessionDatabase, type DatabaseEngine } from "@open-qa-stack/store/testing";
import { at, closedPort } from "@open-qa-stack/testing";
import { chain } from "@open-qa-stack/testing/fixture-repository";
import { startApi } from "../../src/start-api.ts";
import { CapturedLogger } from "../support/captured-logger.ts";
import { EventStream } from "../support/event-stream.ts";
import { eventually } from "../support/eventually.ts";
import { sessionsApi, type TestApi } from "../support/sessions-api.ts";
import { TestRepository } from "../support/test-repository.ts";

/** What names a process that hosted sessions on the database of the tests, other than the API under test. */
const GONE = "host-gone";

const JSON_TYPE = "application/json; charset=utf-8";
const PROBLEM_TYPE = "application/problem+json; charset=utf-8";
const RESULT: SessionResult = { outcome: "passed", durationMs: 2000, modelRequests: 3, tests: [] };

/** What a client is told while the instance cannot reach its database. */
const UNAVAILABLE = "The database of the instance cannot be reached, and its sessions with it: try again once the instance reports itself ready.";

/** A request whose run the configuration stops at once, without a call to the model: it names an environment the test repository does not declare. */
const STOPPED_AT_ONCE = JSON.stringify({ request: "cover the profile", environment: "nowhere" });

/** A request whose run goes through the whole scripted chain. */
const WHOLE_CHAIN = JSON.stringify({ request: "Test the listing of the orders.", environment: "local" });

/**
 * The tests of the API over a database, written once for every database the store supports: the routes, the
 * streams and the runs behave the same whichever keeps the sessions.
 *
 * @param engine - The database to run them on.
 */
export function sessionsApiSuite(engine: DatabaseEngine): void {
  let sessions: SessionDatabase;
  let store: SessionStore;
  /** A test repository whose model has nothing to answer: for the sessions that never reach it. */
  let quiet: TestRepository;
  let logger: CapturedLogger;
  let api: TestApi;
  /** What a test started besides the API of every test, closed after it. */
  let started: { close(): Promise<void> }[];
  before(async () => {
    sessions = await SessionDatabase.create(engine, new Logger("Database"));
    store = sessions.store;
    quiet = await TestRepository.create([]);
  });
  beforeEach(async () => {
    await sessions.clear();
    logger = new CapturedLogger();
    started = [];
    api = await hosted(quiet);
  });
  afterEach(async () => {
    await api.close();
    for (const one of started.reverse()) await one.close();
  });
  after(async () => {
    await quiet.close();
    await sessions.drop();
  });

  /** Starts the API on the database of the tests, with a test repository to run its sessions in. */
  function hosted(repository: TestRepository): Promise<TestApi> {
    return sessionsApi({ database: sessions.url, repository: repository.root, environment: repository.environment, logger });
  }

  /** Starts another API, on a test repository of its own whose model answers the whole scripted chain; both are closed after the test. */
  async function chained(): Promise<{ repository: TestRepository; api: TestApi }> {
    await api.close();
    const repository = await TestRepository.create(chain());
    const own = await hosted(repository);
    started.push(repository, own);
    return { repository, api: own };
  }

  /** The status, the media type and the JSON body of an answer. */
  async function answerOf(response: Response): Promise<{ status: number; type: string; body: unknown }> {
    return { status: response.status, type: String(response.headers.get("content-type")), body: await response.json() };
  }

  /** An answer that is a problem of a code, with a status and a detail. */
  function problem(status: number, code: Problem["code"], detail: string): { status: number; type: string; body: Partial<Problem> } {
    return { status, type: PROBLEM_TYPE, body: { status, code, detail } };
  }

  /** What a test compares of an answer that is a problem: its status and its media type, and the status, the code and the detail of its body. */
  async function problemOf(response: Response): Promise<{ status: number; type: string; body: Partial<Problem> }> {
    const { status, type, body } = await answerOf(response);
    const { status: told, code, detail } = body as Problem;
    return { status, type, body: { status: told, code, detail } };
  }

  /** Asks to open a session. */
  function post(body: string, type = "application/json", to = api): Promise<Response> {
    return fetch(`${to.url}/sessions`, { method: "POST", headers: { "content-type": type }, body });
  }

  /** Sends a message to a session. */
  function say(id: string, body: string, to = api): Promise<Response> {
    return fetch(`${to.url}/sessions/${id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body });
  }

  /** Interrupts a session. */
  function interrupt(id: string, to = api): Promise<Response> {
    return fetch(`${to.url}/sessions/${id}/interruption`, { method: "POST" });
  }

  /** Opens a session, and gives it as the API answered it. */
  async function opened(body: string, to = api): Promise<Session> {
    const { status, body: session } = await answerOf(await post(body, "application/json", to));
    assert.equal(status, 201, JSON.stringify(session));
    return session as Session;
  }

  /** Waits until a session ended, and gives it. */
  function ended(id: string, to = api): Promise<Session> {
    return eventually(async () => {
      const session = (await answerOf(await fetch(`${to.url}/sessions/${id}`))).body as Session;
      return (session.state === "completed" || session.state === "interrupted") && session;
    });
  }

  /** A session the database holds as running, which no run of this API tells: for the routes that only read and write it. */
  async function kept(request = "cover the profile"): Promise<Session> {
    const { id } = await store.ask({ request }, GONE);
    return store.start(id, GONE);
  }

  /** A note the database holds of a session. */
  const tell = (id: string, text: string) => store.append(id, [{ at: new Date().toISOString(), type: "note", phase: "plan", text }]);

  /** The operations on one running session `s1`, as a double a test replaces the answers of. */
  function doubled(): Record<string, unknown> {
    const session: Session = { id: "s1", openedAt: at(0), lastEventAt: at(0), state: "running" };
    return { project: async () => ({ applications: [] }), sessions: async () => [session], session: async () => session };
  }

  describe("the routes of the project and of the sessions", () => {
    it("give the project of the test repository the API was started with, which no cache may keep", async () => {
      const response = await fetch(`${api.url}/project`);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await answerOf(response), {
        status: 200,
        type: JSON_TYPE,
        body: { name: basename(quiet.root), applications: [{ id: "shop", name: "Shop" }] },
      });
    });

    it("list the sessions as the items of a list, the latest first, and give one by its identifier, which no cache may keep", async () => {
      const first = await kept();
      await store.complete(first.id, RESULT);
      const second = await store.ask({ request: "cover the orders", environment: "local" }, GONE);
      const listed = await fetch(`${api.url}/sessions`);
      assert.equal(listed.headers.get("cache-control"), "no-store");
      const { status, body } = await answerOf(listed);
      assert.equal(status, 200);
      assert.deepEqual(Object.keys(body as SessionList), ["items"]);
      const items = (body as SessionList).items;
      assert.deepEqual(
        items.map(({ id, state, request, environment }) => [id, state, request, environment]),
        [
          [second.id, "queued", "cover the orders", "local"],
          [first.id, "completed", "cover the profile", undefined],
        ],
      );
      assert.deepEqual(items[1]?.result, RESULT);
      const one = await fetch(`${api.url}/sessions/${first.id}`);
      assert.equal(one.headers.get("cache-control"), "no-store");
      assert.deepEqual(await answerOf(one), { status: 200, type: JSON_TYPE, body: items[1] });
    });

    it("answer 404 with a problem for a session that does not exist: for itself, its events, a message and an interruption", async () => {
      const unknown = {
        type: "/problems/unknown-session",
        title: "Unknown session",
        status: 404,
        detail: "No session session-unknown.",
        code: "unknown_session",
      };
      for (const response of [
        await fetch(`${api.url}/sessions/session-unknown`),
        await fetch(`${api.url}/sessions/session-unknown/events`),
        await say("session-unknown", JSON.stringify({ text: "not that page" })),
        await interrupt("session-unknown"),
      ])
        assert.deepEqual(await answerOf(response), { status: 404, type: PROBLEM_TYPE, body: unknown });
    });
  });

  describe("every answer of the API that is not a success", () => {
    it("is a problem: for a route that does not exist, a body that is not JSON, and a media type the API does not read", async () => {
      assert.deepEqual(await answerOf(await fetch(`${api.url}/nowhere`)), {
        status: 404,
        type: PROBLEM_TYPE,
        body: { type: "/problems/error", title: "Request not answered", status: 404, detail: "Cannot GET /nowhere", code: "error" },
      });
      const malformed = await problemOf(await post("{"));
      assert.deepEqual([malformed.status, malformed.type, malformed.body.code], [400, PROBLEM_TYPE, "invalid_request"]);
      const unread = await problemOf(await post("cover the profile", "text/yaml"));
      assert.deepEqual([unread.status, unread.type, unread.body.status, unread.body.code], [415, PROBLEM_TYPE, 415, "error"]);
    });

    it("says nothing of an error the API does not expect, which it logs", async () => {
      const log = new CapturedLogger();
      const broken = await sessionsApi({
        operations: { sessions: () => Promise.reject(new Error("EACCES: permission denied, open '/srv/secret'")) },
        logger: log,
      });
      try {
        assert.deepEqual(
          await problemOf(await fetch(`${broken.url}/sessions`)),
          problem(500, "error", "The API failed to answer the request; the log of the instance has the error."),
        );
        const logged = log.lines.filter((line) => line.startsWith("error "));
        assert.equal(logged.length, 1);
        assert.match(
          String(logged[0]),
          /^error A request failed on an error the API does not expect\. Error: EACCES: permission denied, open '\/srv\/secret'\n\s+at /,
        );
      } finally {
        await broken.close();
      }
    });

    it("logs what was raised as it is when it is no error", async () => {
      const log = new CapturedLogger();
      const broken = await sessionsApi({ operations: { project: () => Promise.reject("lost") }, logger: log });
      try {
        assert.equal((await fetch(`${broken.url}/project`)).status, 500);
        assert.ok(log.lines.includes("error A request failed on an error the API does not expect. lost Api"), log.lines.join("\n"));
      } finally {
        await broken.close();
      }
    });
  });

  describe("the stream of the events of a session", () => {
    it("is a stream of server-sent events: how long to wait before reconnecting, every event in order under its identifier, then its end once the session ended", async () => {
      const { id } = await kept();
      await tell(id, "Three.");
      await store.complete(id, RESULT);
      const stream = await EventStream.open(`${api.url}/sessions/${id}/events`);
      assert.equal(stream.response.status, 200);
      assert.match(String(stream.response.headers.get("content-type")), /^text\/event-stream/);
      assert.equal(await stream.block(), "id: 0\nretry: 3000");
      const messages = [await stream.next(), await stream.next(), await stream.next(), await stream.next()];
      assert.deepEqual(
        messages.map((message) => message?.id),
        ["1", "2", "3", "4"],
      );
      assert.deepEqual({ ...messages[0]?.event, at: "" }, { id: 1, at: "", type: "user_message", text: "cover the profile" });
      assert.deepEqual({ ...messages[1]?.event, at: "" }, { id: 2, at: "", type: "state_changed", state: "running" });
      assert.deepEqual({ ...messages[2]?.event, at: "" }, { id: 3, at: "", type: "note", phase: "plan", text: "Three." });
      assert.deepEqual({ ...messages[3]?.event, at: "" }, { id: 4, at: "", type: "state_changed", state: "completed" });
      assert.equal(await stream.next(), undefined);
    });

    it("gives a client that reconnects only the events after the last one it got, named by the header or in the address, where the header wins", async () => {
      const { id } = await kept();
      await tell(id, "Three.");
      await store.complete(id, RESULT);
      const url = `${api.url}/sessions/${id}/events`;
      const first = await EventStream.open(url);
      const [, , last] = await first.take(3);
      await first.close();
      const resumed = await EventStream.open(url, String(last?.id));
      assert.equal(await resumed.block(), "id: 3\nretry: 3000");
      assert.deepEqual((await resumed.next())?.id, "4");
      assert.equal(await resumed.next(), undefined);
      const fresh = await EventStream.open(`${url}?after=2`);
      assert.deepEqual((await fresh.next())?.id, "3");
      await fresh.close();
      const both = await EventStream.open(`${url}?after=1`, "3");
      assert.deepEqual((await both.next())?.id, "4");
      await both.close();
    });

    it("ends at once, without an event, for a client that already got the end of the session", async () => {
      const { id } = await kept();
      await store.interrupt(id);
      const stream = await EventStream.open(`${api.url}/sessions/${id}/events?after=3`);
      assert.equal(await stream.block(), "id: 3\nretry: 3000");
      assert.equal(await stream.block(), undefined);
    });

    it("answers 400 with a problem for an identifier of event that is none, in the header or in the address", async () => {
      const { id } = await kept();
      const url = `${api.url}/sessions/${id}/events`;
      assert.deepEqual(
        await problemOf(await fetch(`${url}?after=two`)),
        problem(400, "invalid_request", "after must be the identifier of an event: a whole number."),
      );
      assert.deepEqual(
        await problemOf(await fetch(`${url}?after=1&after=2`)),
        problem(400, "invalid_request", "after must be the identifier of an event: a whole number."),
      );
      assert.deepEqual(
        await problemOf(await fetch(url, { headers: { "last-event-id": "two" } })),
        problem(400, "invalid_request", "Last-Event-ID must be the identifier of an event: a whole number."),
      );
    });

    it("carries what a session gains while it is followed, and ends when the API closes", async () => {
      const waiting = await opened(STOPPED_AT_ONCE);
      const { id } = await kept("followed while it goes on");
      const stream = await EventStream.open(`${api.url}/sessions/${id}/events?after=2`);
      assert.equal((await say(id, JSON.stringify({ text: "not that page" }))).status, 202);
      const [said] = await stream.take(1);
      assert.deepEqual({ ...said, at: "" }, { id: 3, at: "", type: "user_message", text: "not that page", number: 1 });
      await ended(waiting.id);
      await api.close();
      assert.equal(await stream.next(), undefined);
    });

    it("sends a comment at each heartbeat while the session has nothing to say", async () => {
      const silent = await sessionsApi({
        operations: { ...doubled(), events: async () => ({ subscribe: () => () => undefined }) },
        pace: { heartbeatMs: 20, retryMs: 1500 },
      });
      try {
        const stream = await EventStream.open(`${silent.url}/sessions/s1/events`);
        try {
          assert.deepEqual([await stream.block(), await stream.block(), await stream.block()], ["id: 0\nretry: 1500", ": heartbeat", ": heartbeat"]);
        } finally {
          await stream.close();
        }
      } finally {
        await silent.close();
      }
    });

    it("ends, with a warning in the log, when its events can no longer be read, and the API keeps answering", async () => {
      const log = new CapturedLogger();
      const failure = new Error("The database is unreachable: connection refused");
      const events = async () => ({ subscribe: (listener: EventListener) => (listener.failed(failure), () => undefined) });
      const failing = await sessionsApi({ operations: { ...doubled(), events }, logger: log });
      try {
        const stream = await EventStream.open(`${failing.url}/sessions/s1/events`);
        assert.equal(stream.response.status, 200);
        assert.equal(await stream.next(), undefined);
        assert.ok(
          log.lines.includes("warn The events of the session s1 can no longer be read: The database is unreachable: connection refused Sessions"),
          log.lines.join("\n"),
        );
        assert.equal((await fetch(`${failing.url}/sessions`)).status, 200);
      } finally {
        await failing.close();
      }
    });

    it("stops following the session when the client leaves", async () => {
      let followed = 0;
      const events = async () => ({
        subscribe: (listener: EventListener) => {
          followed++;
          listener.event({ id: 1, at: at(1), type: "user_message", text: "cover the profile" });
          return () => followed--;
        },
      });
      const left = await sessionsApi({ operations: { ...doubled(), events } });
      try {
        const stream = await EventStream.open(`${left.url}/sessions/s1/events`);
        await stream.take(1);
        assert.equal(followed, 1);
        await stream.close();
        for (let waited = 0; waited < 1000 && followed > 0; waited += 10) await pause(10);
        assert.equal(followed, 0);
      } finally {
        await left.close();
      }
    });
  });

  describe("the opening of a session", () => {
    it("answers 201 with the session, which runs at once, and where to read it; a session opened meanwhile waits its turn, then runs", async () => {
      const { repository, api: own } = await chained();
      const door = repository.designDoor();
      const response = await post(WHOLE_CHAIN, "application/json", own);
      const location = String(response.headers.get("location"));
      const { status, type, body } = await answerOf(response);
      const session = body as Session;
      assert.deepEqual([status, type, session.state, location], [201, JSON_TYPE, "running", `sessions/${session.id}`]);
      assert.match(session.id, /^session-\d{4}-\d{2}-\d{2}T[\d-]+Z-[0-9a-f]{8}$/);
      assert.deepEqual([session.request, session.environment], ["Test the listing of the orders.", "local"]);
      // Held at the door, the session tells nothing more: what the location answers is what the store holds.
      await door.reached;
      assert.deepEqual((await answerOf(await fetch(new URL(location, response.url)))).body, await store.session(session.id));
      const waiting = await opened(STOPPED_AT_ONCE, own);
      assert.equal(waiting.state, "queued");
      assert.equal((await store.session(waiting.id))?.state, "queued", "one session at a time");
      door.open();
      assert.equal((await ended(session.id, own)).result?.outcome, "passed");
      const next = await ended(waiting.id, own);
      assert.ok(next.state === "interrupted" && next.lastEventAt >= String((await store.session(session.id))?.lastEventAt));
    });

    it("runs the session with the engine: its stream tells what the agents do as they do it, a message sent meanwhile reaches one of them, and the session ends completed", async () => {
      const { repository, api: own } = await chained();
      const door = repository.designDoor();
      const session = await opened(WHOLE_CHAIN, own);
      const stream = await EventStream.open(`${own.url}/sessions/${session.id}/events`);
      const told: SessionEvent[] = await stream.take(2);
      await door.reached;
      assert.deepEqual(await answerOf(await say(session.id, JSON.stringify({ text: "Only what a customer sees." }), own)), {
        status: 202,
        type: JSON_TYPE,
        body: { number: 1 } satisfies MessageReceipt,
      });
      door.open();
      for (let message = await stream.next(); message !== undefined; message = await stream.next()) told.push(message.event);
      assert.deepEqual(
        told.map((event) => event.id),
        told.map((_, index) => index + 1),
      );
      assert.deepEqual(told, await store.eventsAfter(session.id, 0));
      assert.deepEqual(
        told.flatMap((event) => (event.type === "message_delivered" ? [[event.message, event.agent]] : [])),
        [[1, "planner"]],
      );
      for (const phase of ["configuration", "card", "plan", "write", "execution", "summary"])
        assert.ok(
          told.some((event) => event.type === "phase_started" && event.phase === phase),
          phase,
        );
      assert.deepEqual(told.at(-1)?.type === "state_changed" && told.at(-1), { ...told.at(-1), state: "completed" });
      const resumed = await EventStream.open(`${own.url}/sessions/${session.id}/events`, String(told.length - 1));
      assert.deepEqual((await resumed.next())?.event, told.at(-1));
      assert.equal(await resumed.next(), undefined);
      const completed = await ended(session.id, own);
      assert.deepEqual([completed.state, completed.result?.outcome, completed.result?.tests.length], ["completed", "passed", 3]);
      assert.deepEqual(await sessions.database.kysely.selectFrom("session_messages").select(["number", "delivered_to"]).execute(), [
        { number: 1, delivered_to: "planner" },
      ]);
    });

    it("is refused with 503 by an API that was started without a test repository, which says what to set and serves what the database holds", async () => {
      const { id } = await store.ask({ request: "asked of another host" }, GONE);
      const reading = await sessionsApi({ database: sessions.url });
      try {
        assert.deepEqual(
          await problemOf(await post(STOPPED_AT_ONCE, "application/json", reading)),
          problem(
            503,
            "unavailable",
            "The API was started without a test repository, and opens no session: set OQAS_REPOSITORY to the absolute path of a folder that holds oqas.json, and start the API again.",
          ),
        );
        const listed = (await answerOf(await fetch(`${reading.url}/sessions`))).body as SessionList;
        assert.deepEqual(
          listed.items.map((session) => [session.id, session.state]),
          [[id, "queued"]],
        );
      } finally {
        await reading.close();
      }
    });

    for (const [body, detail] of [
      ["{}", "request must be a text that is not empty and does not start with --."],
      ['{"request":"--help"}', "request must be a text that is not empty and does not start with --."],
      [JSON.stringify({ request: "x".repeat(4001) }), "request must not be longer than 4000 characters."],
      ['{"request":"cover","environment":3}', "environment must be a text that is not empty and does not start with -- when it is given."],
      ['{"request":"cover","mode":"fast"}', "mode is not a field of a request to open a session."],
      ['["cover"]', "The body must be a JSON object."],
    ] as const) {
      it(`answers 400 with a problem that names what is at fault in ${body.slice(0, 40)}, and asks for no session`, async () => {
        assert.deepEqual(await problemOf(await post(body)), problem(400, "invalid_request", detail));
        assert.deepEqual(await store.sessions(), []);
      });
    }
  });

  describe("an API that starts", () => {
    it("interrupts the sessions an earlier process left running, which it logs, and runs those that waited", async () => {
      await api.close();
      const left = await kept("left running");
      const waiting = await store.ask({ request: "cover the profile", environment: "nowhere" }, GONE);
      await store.release(GONE);
      api = await hosted(quiet);
      assert.equal((await store.session(left.id))?.state, "interrupted");
      assert.equal((await ended(waiting.id)).state, "interrupted");
      assert.ok(
        (await store.eventsAfter(waiting.id, 0)).some((event) => event.type === "phase_started"),
        "the session that waited ran",
      );
      assert.ok(logger.lines.includes("warn 1 session was left running by a process that stopped, and interrupted. Sessions"), logger.lines.join("\n"));
    });
  });

  describe("the interruption of a session", () => {
    it("is answered 202, and ends soon a session that runs: its stream tells it interrupted", async () => {
      const { repository, api: own } = await chained();
      const door = repository.designDoor();
      const session = await opened(WHOLE_CHAIN, own);
      await door.reached;
      const stream = await EventStream.open(`${own.url}/sessions/${session.id}/events`);
      const response = await interrupt(session.id, own);
      assert.deepEqual([response.status, await response.text()], [202, ""]);
      door.open();
      let last: SessionEvent | undefined;
      for (let message = await stream.next(); message !== undefined; message = await stream.next()) last = message.event;
      assert.deepEqual(last?.type === "state_changed" && last.state, "interrupted");
      const interrupted = await ended(session.id, own);
      assert.deepEqual([interrupted.state, interrupted.result], ["interrupted", undefined]);
      assert.ok(repository.model.requests.length < chain().length, "the run stopped instead of going to its end");
    });

    it("interrupts at once a session that waits, which never runs", async () => {
      const { repository, api: own } = await chained();
      const door = repository.designDoor();
      const running = await opened(WHOLE_CHAIN, own);
      const waiting = await opened(STOPPED_AT_ONCE, own);
      await door.reached;
      assert.equal((await interrupt(waiting.id, own)).status, 202);
      assert.equal((await store.session(waiting.id))?.state, "interrupted");
      await interrupt(running.id, own);
      door.open();
      await ended(running.id, own);
      assert.deepEqual(
        (await store.eventsAfter(waiting.id, 0)).map((event) => event.type),
        ["user_message", "state_changed"],
      );
    });

    it("is refused with 409 by a session that has ended, completed or interrupted", async () => {
      const completed = await kept();
      await store.complete(completed.id, RESULT);
      const interrupted = await ended((await opened(STOPPED_AT_ONCE)).id);
      for (const { id } of [completed, interrupted]) {
        assert.deepEqual(
          await problemOf(await interrupt(id)),
          problem(409, "session_ended", `The session ${id} no longer goes on. It takes no message and no interruption: open another session to go on.`),
        );
      }
    });
  });

  describe("a message sent to a session that goes on", () => {
    it("is answered 202 with its number in the session, from 1, and waits in the database for an agent", async () => {
      const { id } = await kept();
      for (const [text, number] of [
        ["not that page", 1],
        ["the other one", 2],
      ] as const) {
        assert.deepEqual(await answerOf(await say(id, JSON.stringify({ text }))), { status: 202, type: JSON_TYPE, body: { number } satisfies MessageReceipt });
      }
      assert.deepEqual(
        (await store.pendingMessages(id)).map(({ number, text }) => [number, text]),
        [
          [1, "not that page"],
          [2, "the other one"],
        ],
      );
    });

    it("is taken by a session that still waits", async () => {
      const { id } = await store.ask({ request: "cover the profile" }, GONE);
      assert.deepEqual((await answerOf(await say(id, '{"text":"not that page"}'))).body, { number: 1 });
      assert.equal((await store.session(id))?.state, "queued");
    });

    it("keeps a number of its own when several are sent at once", async () => {
      const { id } = await kept();
      const answers = await Promise.all(Array.from({ length: 12 }, (_, rank) => say(id, JSON.stringify({ text: `message ${rank}` })).then(answerOf)));
      assert.deepEqual(
        answers.map(({ body }) => (body as MessageReceipt).number).sort((a, b) => a - b),
        answers.map((_, rank) => rank + 1),
      );
      assert.equal((await store.pendingMessages(id)).length, 12);
    });

    for (const [body, detail] of [
      ["{}", "text must be a text that is not empty."],
      ['{"text":"  "}', "text must be a text that is not empty."],
      [JSON.stringify({ text: "x".repeat(4001) }), "text must not be longer than 4000 characters."],
      ['{"text":"not that page","to":"writer"}', "to is not a field of a message to a session."],
      ['["not that page"]', "The body must be a JSON object."],
    ] as const) {
      it(`is answered 400 with a problem that names what is at fault in ${body.slice(0, 40)}, and is not taken`, async () => {
        const { id } = await kept();
        assert.deepEqual(await problemOf(await say(id, body)), problem(400, "invalid_request", detail));
        assert.deepEqual(await store.pendingMessages(id), []);
      });
    }

    it("is answered 409 with a problem by a session that is completed, and by one that is interrupted", async () => {
      const completed = await kept();
      await store.complete(completed.id, RESULT);
      const interrupted = await kept();
      await store.interrupt(interrupted.id);
      assert.deepEqual(await answerOf(await say(completed.id, JSON.stringify({ text: "not that page" }))), {
        status: 409,
        type: PROBLEM_TYPE,
        body: {
          type: "/problems/session-ended",
          title: "Session ended",
          status: 409,
          detail: `The session ${completed.id} no longer goes on. It takes no message and no interruption: open another session to go on.`,
          code: "session_ended",
        },
      });
      assert.deepEqual(
        await problemOf(await say(interrupted.id, JSON.stringify({ text: "not that page" }))),
        problem(
          409,
          "session_ended",
          `The session ${interrupted.id} no longer goes on. It takes no message and no interruption: open another session to go on.`,
        ),
      );
      assert.deepEqual([await store.pendingMessages(completed.id), await store.pendingMessages(interrupted.id)], [[], []]);
    });
  });

  describe("an API among the other processes that reach its database", () => {
    /** The paces of an API a test does not wait on: a beat and a reading every few milliseconds. */
    const QUICK = { beatMs: 15, silentAfterMs: 15_000, followMs: 15 };

    /** Starts an API at the paces of the tests, on a test repository of its own whose model answers the whole chain. */
    async function quick(): Promise<{ repository: TestRepository; api: TestApi }> {
      await api.close();
      const repository = await TestRepository.create(chain());
      const own = await sessionsApi({ database: sessions.url, repository: repository.root, environment: { ...repository.environment, pace: QUICK }, logger });
      started.push(repository, own);
      return { repository, api: own };
    }

    it("serves a session another process runs: its stream follows what that process tells, a message and an interruption wait for it in the database", async () => {
      const { api: own } = await quick();
      const elsewhere = await kept();
      const stream = await EventStream.open(`${own.url}/sessions/${elsewhere.id}/events`);
      assert.deepEqual(
        (await stream.take(2)).map((event) => event.type),
        ["user_message", "state_changed"],
      );
      await tell(elsewhere.id, "Told by the process that runs it.");
      assert.deepEqual(
        (await stream.take(1)).map((event) => event.type === "note" && event.text),
        ["Told by the process that runs it."],
      );
      assert.deepEqual((await answerOf(await say(elsewhere.id, '{"text":"not that page"}', own))).body, { number: 1 });
      assert.equal((await interrupt(elsewhere.id, own)).status, 202);
      assert.equal((await store.session(elsewhere.id))?.state, "running", "the process that runs it interrupts it");
      assert.deepEqual(await store.interruptionRequests(GONE), [elsewhere.id]);
      assert.deepEqual(
        (await store.pendingMessages(elsewhere.id)).map(({ number }) => number),
        [1],
      );
      await store.interrupt(elsewhere.id);
      let last: SessionEvent | undefined;
      for (let message = await stream.next(); message !== undefined; message = await stream.next()) last = message.event;
      assert.deepEqual(last?.type === "state_changed" && last.state, "interrupted");
    });

    it("obeys what another process asks of a session it runs: a message reaches its agents, an interruption ends it soon", async () => {
      const { repository, api: own } = await quick();
      const door = repository.designDoor();
      const session = await opened(WHOLE_CHAIN, own);
      await door.reached;
      await store.say(session.id, "Only what a customer sees.");
      await store.requestInterruption(session.id, QUICK.silentAfterMs);
      // The API beats many times meanwhile: it holds the message and the interruption by now.
      await pause(QUICK.beatMs * 10);
      door.open();
      const interrupted = await ended(session.id, own);
      assert.deepEqual([interrupted.state, interrupted.result], ["interrupted", undefined]);
      assert.ok(repository.model.requests.length < chain().length, "the run stopped instead of going to its end");
    });

    it("leaves the sessions of a process that beats to it when it starts: it interrupts none, and takes none over", async () => {
      await api.close();
      const running = await kept("run elsewhere");
      const waiting = await store.ask({ request: "asked elsewhere", environment: "nowhere" }, GONE);
      api = await sessionsApi({ database: sessions.url, repository: quiet.root, environment: { ...quiet.environment, pace: QUICK }, logger });
      await pause(QUICK.beatMs * 10);
      assert.deepEqual([(await store.session(running.id))?.state, (await store.session(waiting.id))?.state], ["running", "queued"]);
      assert.deepEqual(
        logger.lines.filter((line) => line.startsWith("warn ")),
        [],
      );
      // Once that process withdrew its beats, the API sees to what it left at its next beat.
      await store.release(GONE);
      assert.equal((await ended(running.id)).state, "interrupted");
      assert.equal((await ended(waiting.id)).state, "interrupted");
      assert.ok(
        (await store.eventsAfter(waiting.id, 0)).some((event) => event.type === "phase_started"),
        "the session that waited ran here",
      );
    });
  });

  describe("an API that stops while a session runs", () => {
    it("asks the session to stop, and closes once it is told interrupted: nothing is left running in the database", async () => {
      const { repository, api: own } = await chained();
      const door = repository.designDoor();
      const session = await opened(WHOLE_CHAIN, own);
      await door.reached;
      const closed = own.close();
      door.open();
      await closed;
      assert.equal((await store.session(session.id))?.state, "interrupted");
      assert.deepEqual(
        logger.lines.filter((line) => line.startsWith("warn ")),
        [],
      );
    });

    it("says so in its log when the session did not end in time, and closes all the same", async () => {
      await api.close();
      const repository = await TestRepository.create(chain());
      const door = repository.designDoor();
      const own = await sessionsApi({
        database: sessions.url,
        repository: repository.root,
        environment: { ...repository.environment, stopWithinMs: 20 },
        logger,
      });
      started.push(repository);
      const session = await opened(WHOLE_CHAIN, own);
      await door.reached;
      await own.close();
      assert.ok(
        logger.lines.includes(
          "warn The session under way did not end in time: it stays running in the database until a process that hosts sessions interrupts it. Sessions",
        ),
        logger.lines.join("\n"),
      );
      assert.equal((await store.session(session.id))?.state, "running");
      // The run ends by itself, and no longer insists on a database the API closed.
      door.open();
      await eventually(() => logger.lines.includes(`log The session ${session.id} is over. Sessions`));
      assert.ok(
        logger.lines.includes(`warn The session ${session.id} is left as the store holds it: its host stops, and what its run still told is dropped. Sessions`),
        logger.lines.join("\n"),
      );
    });
  });

  // Only a server can be out of reach, then back: the file of a SQLite database is there, or the API does not start.
  if (engine.name === "postgres") {
    describe("an API whose database is a server that cannot be reached", () => {
      it("starts all the same, reports itself not ready, and answers 503 on every route of the project and of the sessions, without a word of its database", async () => {
        const log = new CapturedLogger();
        const port = await closedPort();
        const alone = await startApi(
          {
            OQAS_HOST: "127.0.0.1",
            OQAS_PORT: String(port),
            OQAS_DATABASE_URL: `postgres://oqas:witness-7a1c@127.0.0.1:${await closedPort()}/oqas`,
            OQAS_REPOSITORY: quiet.root,
          },
          { logger: log },
        );
        const to = { url: `http://127.0.0.1:${port}`, close: () => alone.close() };
        try {
          assert.equal((await fetch(`${to.url}/health`)).status, 200);
          assert.deepEqual(await answerOf(await fetch(`${to.url}/health/ready`)), {
            status: 503,
            type: JSON_TYPE,
            body: { status: "not_ready", checks: { database: "unreachable" } },
          });
          const refusals = [
            await fetch(`${to.url}/project`),
            await fetch(`${to.url}/sessions`),
            await fetch(`${to.url}/sessions/s1`),
            await fetch(`${to.url}/sessions/s1/events`),
            await post(JSON.stringify({ request: "cover the profile" }), "application/json", to),
            await say("s1", JSON.stringify({ text: "not that page" }), to),
            await interrupt("s1", to),
          ];
          for (const refusal of refusals) {
            assert.deepEqual(await answerOf(refusal), {
              status: 503,
              type: PROBLEM_TYPE,
              body: { type: "/problems/unavailable", title: "Sessions unavailable", status: 503, detail: UNAVAILABLE, code: "unavailable" },
            });
          }
          assert.deepEqual(
            log.lines.filter((line) => line.startsWith("error ")),
            [],
          );
          assert.ok(
            log.lines.some((line) => line.startsWith("warn The sessions are not started, and will be when one is next opened: The database is unreachable: ")),
          );
          assert.ok(!log.lines.join("\n").includes("witness-7a1c"));
        } finally {
          await to.close();
        }
      });

      it("serves its sessions again once the database answers, and opens one, without being started again", async () => {
        const { id } = await kept();
        await refuseConnections(sessions.url);
        try {
          assert.deepEqual(await problemOf(await fetch(`${api.url}/sessions`)), problem(503, "unavailable", UNAVAILABLE));
          assert.deepEqual(await problemOf(await post(STOPPED_AT_ONCE)), problem(503, "unavailable", UNAVAILABLE));
        } finally {
          await acceptConnections(sessions.url);
        }
        const listed = (await answerOf(await fetch(`${api.url}/sessions`))).body as SessionList;
        assert.deepEqual(
          listed.items.map((session) => session.id),
          [id],
        );
        assert.equal((await ended((await opened(STOPPED_AT_ONCE)).id)).state, "interrupted");
      });

      it("wakes the streams of its events in its own memory: no connection listens to the database", async () => {
        const { id } = await kept("followed while it goes on");
        const stream = await EventStream.open(`${api.url}/sessions/${id}/events?after=2`);
        assert.equal((await say(id, JSON.stringify({ text: "not that page" }))).status, 202);
        await stream.take(1);
        assert.equal(await listeningConnections(sessions.url), 0);
        await stream.close();
      });
    });
  }
}
