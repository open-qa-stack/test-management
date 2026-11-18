import assert from "node:assert/strict";
import type { Project, Session } from "@open-qa-stack/domain/sessions";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import type { ConsoleAction } from "../../src/agent/console-state.ts";
import { ConsoleSync, PAUSE_MS } from "../../src/agent/console-sync.ts";
import { ApiClient } from "../../src/api/api-client.ts";
import { FakeDocument } from "../api/fake-document.ts";
import { FakeEventSource } from "../api/fake-event-source.ts";
import { BARE, VIEW } from "../configuration/configuration-fixture.ts";
import { COMPLETED, EVENTS, numbered, QUEUED, RUNNING, SESSION_ID } from "./session-fixture.ts";

const PROJECT: Project = { name: "Demo", applications: [] };

/** The event that says the session started of the fixtures. */
const TAKEN_EVENT = numbered([...EVENTS.slice(0, 2), { type: "state_changed", state: "running" }])[2]!;

/** The event that says the session of the fixtures completed. */
const COMPLETED_EVENT = numbered([...EVENTS.slice(0, 3), { type: "state_changed", state: "completed" }])[3]!;

/** What the instance does when called: it answers, or cannot be reached. */
type Answer = () => Response;

/** An answer that carries a JSON body. */
const json =
  (body: unknown, status = 200): Answer =>
  () =>
    new Response(JSON.stringify(body), { status });

/** A problem of the API, by its code. */
const problem = (code: string, status: number): Answer => json({ code, status, detail: `The API says ${code}.` }, status);

/** An instance that cannot be reached. */
const unreachable: Answer = () => {
  throw new TypeError("Failed to fetch");
};

/** An instance a test plays: what it answers to each call, which a test changes as it goes, and the calls it got. */
class PlayedApi {
  /** What it answers, by method and path. */
  public readonly answers = new Map<string, Answer>();
  /** The calls it got, by method and path, in order. */
  public readonly calls: string[] = [];
  /** The actions the state of the console was told, in order. */
  public readonly told: ConsoleAction[] = [];
  public readonly sync = new ConsoleSync(
    new ApiClient(async (input, init) => {
      const call = `${init?.method ?? "GET"} ${input}`;
      this.calls.push(call);
      return this.answers.get(call)!();
    }),
    (action) => this.told.push(action),
  );

  /**
   * Sets what the instance answers to a call from now on.
   *
   * @param call - The method and the path, such as `GET /api/sessions`.
   * @param answer - What it answers.
   */
  public answer(call: string, answer: Answer): void {
    this.answers.set(call, answer);
  }
}

/** Lets the answers of the instance reach the console. */
const settled = (): Promise<unknown> => vi.advanceTimersByTimeAsync(0);

/** Lets a pause pass, and the answers to what is asked after it reach the console. */
const paused = (): Promise<unknown> => vi.advanceTimersByTimeAsync(PAUSE_MS);

describe("what keeps the console in step with its instance", () => {
  let api = new PlayedApi();

  beforeEach(() => {
    api = new PlayedApi();
    FakeEventSource.opened.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("document", new FakeDocument());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("reading the project", () => {
    it("reads it once: it is not asked again after the API described it", async () => {
      api.answer("GET /api/project", json(PROJECT));
      api.sync.project();
      await vi.advanceTimersByTimeAsync(10 * PAUSE_MS);
      assert.deepEqual(api.told, [{ type: "project", project: PROJECT }]);
      assert.deepEqual(api.calls, ["GET /api/project"]);
    });

    it("asks again while the API fails, saying the instance unreachable only when it is", async () => {
      api.answer("GET /api/project", problem("error", 500));
      const stop = api.sync.project();
      await settled();
      assert.deepEqual(api.told, []);
      api.answer("GET /api/project", unreachable);
      await paused();
      assert.deepEqual(api.told, [{ type: "unreachable" }]);
      api.answer("GET /api/project", json(PROJECT));
      await paused();
      assert.deepEqual(api.told.at(-1), { type: "project", project: PROJECT });
      assert.equal(api.calls.length, 3);
      stop();
    });
  });

  describe("reading the language of the configuration", () => {
    it("reads it once, English when the configuration names none or there is none", async () => {
      api.answer("GET /api/configuration", json(VIEW));
      api.sync.language();
      await vi.advanceTimersByTimeAsync(10 * PAUSE_MS);
      assert.deepEqual(api.told, [{ type: "language", language: "fr" }]);
      assert.deepEqual(api.calls, ["GET /api/configuration"]);
      api.answer("GET /api/configuration", json({ file: "missing" }));
      api.sync.language();
      await settled();
      assert.deepEqual(api.told.at(-1), { type: "language", language: "en" });
    });

    it("is read again with the project once the configuration was saved", async () => {
      api.answer("GET /api/project", json(PROJECT));
      api.answer("GET /api/configuration", json(VIEW));
      const stop = api.sync.configured();
      await settled();
      assert.deepEqual(api.told, [
        { type: "project", project: PROJECT },
        { type: "language", language: "fr" },
      ]);
      stop();
    });

    it("asks again while the API fails, saying the instance unreachable only when it is", async () => {
      api.answer("GET /api/configuration", unreachable);
      const stop = api.sync.language();
      await settled();
      assert.deepEqual(api.told, [{ type: "unreachable" }]);
      api.answer("GET /api/configuration", json({ ...VIEW, revision: { ...VIEW.revision!, document: BARE } }));
      await paused();
      assert.deepEqual(api.told.at(-1), { type: "language", language: "en" });
      stop();
    });
  });

  describe("listing the sessions", () => {
    it("lists them again and again, each list under the rank it was asked at", async () => {
      api.answer("GET /api/sessions", json({ items: [RUNNING] }));
      const stop = api.sync.sessions();
      await settled();
      api.answer("GET /api/sessions", json({ items: [COMPLETED] }));
      await paused();
      assert.deepEqual(api.told, [
        { type: "sessions", sessions: [RUNNING], askedAt: 1 },
        { type: "sessions", sessions: [COMPLETED], askedAt: 2 },
      ]);
      stop();
      await vi.advanceTimersByTimeAsync(10 * PAUSE_MS);
      assert.equal(api.calls.length, 2);
    });

    it("says why the API could not list them when it answered so, and the instance unreachable when it did not answer", async () => {
      api.answer("GET /api/sessions", problem("error", 500));
      const stop = api.sync.sessions();
      await settled();
      assert.deepEqual(api.told, [{ type: "unlisted", message: "The API says error." }]);
      api.answer("GET /api/sessions", unreachable);
      await paused();
      assert.deepEqual(api.told.slice(1), [{ type: "unreachable" }]);
      stop();
    });
  });

  describe("opening a session", () => {
    it("says it is opening, then opened, ranked after the list asked before the API answered and before the next, and hands the session over", async () => {
      api.answer("GET /api/sessions", json({ items: [] }));
      api.answer("POST /api/sessions", json(RUNNING, 201));
      const stop = api.sync.sessions();
      const opened: Session[] = [];
      api.sync.open("tester la recherche d'un client", (session) => opened.push(session));
      assert.deepEqual(api.told, [{ type: "opening" }]);
      await settled();
      // The list asked first is answered last: its rank tells the state it was asked before the session opened.
      assert.deepEqual(api.told.slice(1), [
        { type: "opened", session: RUNNING, answeredAt: 2 },
        { type: "sessions", sessions: [], askedAt: 1 },
      ]);
      assert.deepEqual(opened, [RUNNING]);
      await paused();
      assert.deepEqual(api.told.at(-1), { type: "sessions", sessions: [], askedAt: 3 });
      stop();
    });

    it("says why the API refused, in the words of the console, and hands nothing over", async () => {
      api.answer("POST /api/sessions", problem("session_running", 409));
      const opened: Session[] = [];
      api.sync.open("tester", (session) => opened.push(session));
      await settled();
      assert.deepEqual(api.told, [
        { type: "opening" },
        { type: "refused", message: "La session est de nouveau en cours : envoyez-lui votre message comme à une session qui travaille." },
      ]);
      assert.deepEqual(opened, []);
    });
  });

  describe("stopping a session", () => {
    const INTERRUPTION = `POST /api/sessions/${SESSION_ID}/interruption`;

    it("says it is asking, posts the interruption, then says the API took it and tells who asked", async () => {
      let taken = 0;
      api.answer(INTERRUPTION, () => new Response(null, { status: 202 }));
      api.sync.interrupt(SESSION_ID, () => (taken += 1));
      assert.deepEqual(api.told, [{ type: "stopping", id: SESSION_ID }]);
      await settled();
      assert.deepEqual(api.calls, [INTERRUPTION]);
      assert.deepEqual(api.told.slice(1), [{ type: "stop_asked", id: SESSION_ID }]);
      assert.equal(taken, 1);
    });

    it("says why the API refused, in the words of the console, and tells nobody the request was taken", async () => {
      const taken = (): void => assert.fail("the request was not taken");
      api.answer(INTERRUPTION, problem("session_ended", 409));
      api.sync.interrupt(SESSION_ID, taken);
      await settled();
      api.answer(INTERRUPTION, unreachable);
      api.sync.interrupt(SESSION_ID, taken);
      await settled();
      assert.deepEqual(api.told, [
        { type: "stopping", id: SESSION_ID },
        {
          type: "unstopped",
          id: SESSION_ID,
          message: "La session vient de se terminer : il n’y a plus rien à arrêter, et votre message, envoyé de nouveau, la poursuit.",
        },
        { type: "stopping", id: SESSION_ID },
        { type: "unstopped", id: SESSION_ID, message: "L’instance ne répond pas." },
      ]);
    });
  });

  describe("sending a message to a session", () => {
    const MESSAGES = `POST /api/sessions/${SESSION_ID}/messages`;

    it("says it is sending, posts what the person said, then says the API took it", async () => {
      api.answer(MESSAGES, json({ number: 1 }, 202));
      api.sync.say(SESSION_ID, "sans le profil");
      assert.deepEqual(api.told, [{ type: "saying", id: SESSION_ID }]);
      await settled();
      assert.deepEqual(api.calls, [MESSAGES]);
      assert.deepEqual(api.told.slice(1), [{ type: "said", id: SESSION_ID }]);
    });

    it("says why the API refused, in the words of the console: the session just ended, or the instance does not answer", async () => {
      api.answer(MESSAGES, problem("session_ended", 409));
      api.sync.say(SESSION_ID, "sans le profil");
      await settled();
      api.answer(MESSAGES, unreachable);
      api.sync.say(SESSION_ID, "sans le profil");
      await settled();
      assert.deepEqual(api.told, [
        { type: "saying", id: SESSION_ID },
        {
          type: "unsaid",
          id: SESSION_ID,
          message: "La session vient de se terminer : il n’y a plus rien à arrêter, et votre message, envoyé de nouveau, la poursuit.",
        },
        { type: "saying", id: SESSION_ID },
        { type: "unsaid", id: SESSION_ID, message: "L’instance ne répond pas." },
      ]);
    });
  });

  describe("resuming a session that ended", () => {
    const RESUMPTION = `POST /api/sessions/${SESSION_ID}/resumption`;
    const SESSION = `GET /api/sessions/${SESSION_ID}`;

    it("says it is sending, posts what the person said, says the API took it, tells the session, and follows its stream again after the last event", async () => {
      api.answer(SESSION, json(COMPLETED));
      const leave = api.sync.follow(SESSION_ID);
      FakeEventSource.last.receive(COMPLETED_EVENT);
      await settled();
      api.answer(RESUMPTION, json(QUEUED, 202));
      api.sync.resume(SESSION_ID, "corriger le test en échec");
      assert.deepEqual(api.told.at(-1), { type: "saying", id: SESSION_ID });
      await settled();
      assert.deepEqual(api.calls.at(-1), RESUMPTION);
      assert.deepEqual(api.told.slice(-2), [
        { type: "said", id: SESSION_ID },
        { type: "session", session: QUEUED },
      ]);
      assert.equal(FakeEventSource.opened.length, 2);
      assert.equal(FakeEventSource.last.url, `/api/sessions/${SESSION_ID}/events?after=${COMPLETED_EVENT.id}`);
      leave();
    });

    it("follows the stream again when the session it ended on is read going on, and only the session it follows", async () => {
      api.answer(SESSION, json(RUNNING));
      const leave = api.sync.follow(SESSION_ID);
      await settled();
      FakeEventSource.last.receive(COMPLETED_EVENT);
      await vi.advanceTimersByTimeAsync(10 * PAUSE_MS);
      assert.equal(FakeEventSource.opened.length, 2, "the end it was told was one the session went on from");
      api.answer(`POST /api/sessions/other/resumption`, json({ ...RUNNING, id: "other" }, 202));
      api.answer(SESSION, json(COMPLETED));
      FakeEventSource.last.receive(COMPLETED_EVENT);
      await vi.advanceTimersByTimeAsync(10 * PAUSE_MS);
      api.sync.resume("other", "ailleurs");
      await settled();
      assert.equal(FakeEventSource.opened.length, 2);
      leave();
    });

    it("says why the API refused, and reads again a session somebody resumed first, which it then follows", async () => {
      api.answer(SESSION, json(COMPLETED));
      const leave = api.sync.follow(SESSION_ID);
      FakeEventSource.last.receive(COMPLETED_EVENT);
      await settled();
      api.answer(RESUMPTION, problem("session_running", 409));
      api.answer(SESSION, json(RUNNING));
      api.sync.resume(SESSION_ID, "corriger le test en échec");
      await settled();
      assert.deepEqual(api.told.slice(-2), [
        {
          type: "unsaid",
          id: SESSION_ID,
          message: "La session est de nouveau en cours : envoyez-lui votre message comme à une session qui travaille.",
        },
        { type: "session", session: RUNNING },
      ]);
      assert.equal(FakeEventSource.opened.length, 2);
      api.answer(RESUMPTION, unreachable);
      api.answer(SESSION, unreachable);
      FakeEventSource.last.receive(COMPLETED_EVENT);
      await settled();
      api.sync.resume(SESSION_ID, "corriger le test en échec");
      await settled();
      assert.deepEqual(api.told.at(-1), { type: "unsaid", id: SESSION_ID, message: "L’instance ne répond pas." });
      api.answer(RESUMPTION, problem("session_running", 409));
      api.sync.resume(SESSION_ID, "corriger le test en échec");
      await settled();
      assert.deepEqual(api.told.at(-1), { type: "unreachable" });
      leave();
    });
  });

  describe("following a session", () => {
    const SESSION = `GET /api/sessions/${SESSION_ID}`;

    it("follows its stream and reads the session itself, once, whatever the list holds", async () => {
      api.answer(SESSION, json(RUNNING));
      const leave = api.sync.follow(SESSION_ID);
      assert.deepEqual(api.told, [{ type: "followed", id: SESSION_ID }]);
      FakeEventSource.last.onopen?.();
      FakeEventSource.last.receive(EVENTS[0]!);
      await vi.advanceTimersByTimeAsync(10 * PAUSE_MS);
      assert.deepEqual(api.told.slice(1), [
        { type: "stream", id: SESSION_ID, state: "open" },
        { type: "session", session: RUNNING },
        { type: "events", id: SESSION_ID, events: [EVENTS[0]] },
      ]);
      assert.deepEqual(api.calls, [SESSION]);
      leave();
    });

    it("reads the session again when its stream says it started, and goes on following it", async () => {
      api.answer(SESSION, json(QUEUED));
      const leave = api.sync.follow(SESSION_ID);
      await settled();
      api.answer(SESSION, json(RUNNING));
      FakeEventSource.last.receive(TAKEN_EVENT);
      await vi.advanceTimersByTimeAsync(10 * PAUSE_MS);
      assert.deepEqual(api.told.slice(1), [
        { type: "session", session: QUEUED },
        { type: "events", id: SESSION_ID, events: [TAKEN_EVENT] },
        { type: "session", session: RUNNING },
      ]);
      assert.deepEqual(api.calls, [SESSION, SESSION]);
      assert.equal(FakeEventSource.last.closed, false);
      leave();
    });

    it("reads the session again once its stream ended, to learn what it came to", async () => {
      api.answer(SESSION, json(RUNNING));
      api.sync.follow(SESSION_ID);
      await settled();
      api.answer(SESSION, json(COMPLETED));
      FakeEventSource.last.receive(COMPLETED_EVENT);
      await vi.advanceTimersByTimeAsync(10 * PAUSE_MS);
      assert.deepEqual(api.told.slice(2), [
        { type: "events", id: SESSION_ID, events: [COMPLETED_EVENT] },
        { type: "stream", id: SESSION_ID, state: "ended" },
        { type: "session", session: COMPLETED },
      ]);
      assert.deepEqual(api.calls, [SESSION, SESSION]);
    });

    it("drops the first reading when the stream ended before it answered", async () => {
      api.answer(SESSION, json(COMPLETED));
      api.sync.follow(SESSION_ID);
      FakeEventSource.last.receive(COMPLETED_EVENT);
      await vi.advanceTimersByTimeAsync(10 * PAUSE_MS);
      assert.deepEqual(
        api.told.filter(({ type }) => type === "session"),
        [{ type: "session", session: COMPLETED }],
      );
    });

    it("asks for the session again while the API fails to tell it, saying the instance unreachable only when it is", async () => {
      api.answer(SESSION, problem("error", 500));
      const leave = api.sync.follow(SESSION_ID);
      await settled();
      api.answer(SESSION, unreachable);
      await paused();
      assert.deepEqual(api.told.slice(1), [{ type: "unreachable" }]);
      api.answer(SESSION, json(RUNNING));
      await paused();
      assert.deepEqual(api.told.at(-1), { type: "session", session: RUNNING });
      leave();
    });

    it("says the session missing when the instance keeps none of that name, and stops asking and following it", async () => {
      api.answer(SESSION, problem("unknown_session", 404));
      const leave = api.sync.follow(SESSION_ID);
      await vi.advanceTimersByTimeAsync(10 * PAUSE_MS);
      assert.deepEqual(api.told.slice(1), [{ type: "missing", id: SESSION_ID }]);
      assert.deepEqual(api.calls, [SESSION]);
      assert.equal(FakeEventSource.last.closed, true);
      assert.equal(vi.getTimerCount(), 0);
      leave();
    });

    it("leaves the session: its stream closed, nothing more asked nor told but that it left", async () => {
      api.answer(SESSION, json(RUNNING));
      const leave = api.sync.follow(SESSION_ID);
      leave();
      await vi.advanceTimersByTimeAsync(10 * PAUSE_MS);
      assert.deepEqual(api.told, [{ type: "followed", id: SESSION_ID }, { type: "left" }]);
      assert.equal(FakeEventSource.last.closed, true);
      assert.equal(vi.getTimerCount(), 0);
    });
  });
});
