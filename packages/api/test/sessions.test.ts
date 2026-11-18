import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, type MessageEvent, NotFoundException } from "@nestjs/common";
import type { HttpAdapterHost } from "@nestjs/core";
import type { Problem, ProblemCode, Project, Session, SessionEvent, SessionOpening } from "@open-qa-stack/shared/sessions";
import { lastValueFrom, type Observable, of, Subject, toArray } from "rxjs";
import { expectedProblem } from "../src/problems/expected-problem.ts";
import { problemOf } from "../src/problems/problem-kinds.ts";
import { eventIdOf } from "../src/sessions/event-id.ts";
import { NoSessionSource } from "../src/sessions/no-session-source.ts";
import { ProjectController } from "../src/sessions/project.controller.ts";
import { SessionError } from "../src/sessions/session-error.ts";
import { MAX_REQUEST_LENGTH, sessionOpeningOf } from "../src/sessions/session-opening.ts";
import { SessionOpeningPipe } from "../src/sessions/session-opening.pipe.ts";
import { SessionSource } from "../src/sessions/session-source.ts";
import { SessionsController } from "../src/sessions/sessions.controller.ts";
import { SessionsService } from "../src/sessions/sessions.service.ts";
import { StreamPace } from "../src/sessions/stream-pace.ts";

const PROJECT: Project = { name: "shop-tests", applications: [{ id: "shop", name: "Shop" }] };
const SESSION: Session = { id: "s 1", openedAt: "2026-11-14T09:00:00.000Z", lastEventAt: "2026-11-14T09:00:01.000Z", state: "running" };
const ASKED: SessionEvent = { id: 1, at: "2026-11-14T09:00:00.000Z", type: "user_message", text: "cover the profile" };
const ENDED: SessionEvent = { id: 2, at: "2026-11-14T09:00:01.000Z", type: "state_changed", state: "completed" };
const EVENTS: SessionEvent[] = [ASKED, ENDED];

/** A source that holds one session, and remembers what it was asked. */
class OneSession extends SessionSource {
  readonly asked: unknown[] = [];

  override async project(): Promise<Project> {
    return PROJECT;
  }

  override async sessions(): Promise<Session[]> {
    return [SESSION];
  }

  override async session(id: string): Promise<Session | undefined> {
    return id === SESSION.id ? SESSION : undefined;
  }

  override events(id: string, after: number): Observable<SessionEvent> {
    this.asked.push([id, after]);
    return of(...EVENTS);
  }

  override async open(opening: SessionOpening): Promise<Session> {
    this.asked.push(opening);
    return SESSION;
  }
}

/** The failure a refused request carries. */
function refusalOf(action: () => unknown): SessionError {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof SessionError);
    return error;
  }
  return assert.fail("the request was not refused");
}

/** A controller of the sessions of a source, with the headers it sets on its answers. */
function controllerOf(source: SessionSource, pace = new StreamPace()): { controller: SessionsController; headers: unknown[][] } {
  const headers: unknown[][] = [];
  const adapterHost = { httpAdapter: { setHeader: (...args: unknown[]) => headers.push(args) } } as unknown as HttpAdapterHost;
  return { controller: new SessionsController(new SessionsService(source), pace, adapterHost), headers };
}

describe("a request to open a session", () => {
  it("says what to test, and the environment when it names one", () => {
    assert.deepEqual(sessionOpeningOf({ request: "cover the profile" }), { request: "cover the profile" });
    assert.deepEqual(sessionOpeningOf({ request: " cover -- all ", environment: "staging" }), { request: " cover -- all ", environment: "staging" });
    assert.equal(sessionOpeningOf({ request: "x".repeat(MAX_REQUEST_LENGTH) }).request.length, 4000);
  });

  const REQUEST = "request must be a text that is not empty and does not start with --.";
  const ENVIRONMENT = "environment must be a text that is not empty and does not start with -- when it is given.";
  for (const [body, message] of [
    [undefined, "The body must be a JSON object."],
    [null, "The body must be a JSON object."],
    ["cover the profile", "The body must be a JSON object."],
    [["cover the profile"], "The body must be a JSON object."],
    [{}, REQUEST],
    [{ request: "" }, REQUEST],
    [{ request: " \n" }, REQUEST],
    [{ request: 3 }, REQUEST],
    [{ request: "--help" }, REQUEST],
    [{ request: "x".repeat(MAX_REQUEST_LENGTH + 1) }, "request must not be longer than 4000 characters."],
    [{ request: "cover", environment: "" }, ENVIRONMENT],
    [{ request: "cover", environment: null }, ENVIRONMENT],
    [{ request: "cover", environment: ["staging"] }, ENVIRONMENT],
    [{ request: "cover", environment: "--config=/etc/passwd" }, ENVIRONMENT],
    [{ request: "cover", brief: "cover" }, "brief is not a field of a request to open a session."],
  ] as const) {
    it(`is refused, naming what is at fault, when it is ${JSON.stringify(body)?.slice(0, 60)}`, () => {
      const refusal = refusalOf(() => sessionOpeningOf(body));
      assert.deepEqual([refusal.failure, refusal.message, refusal.name], ["invalid_request", message, "SessionError"]);
    });
  }

  it("is read by the pipe of the route as it is by itself", () => {
    const pipe = new SessionOpeningPipe();
    assert.deepEqual(pipe.transform({ request: "cover the profile" }), { request: "cover the profile" });
    assert.equal(refusalOf(() => pipe.transform({})).failure, "invalid_request");
  });
});

describe("the identifier of the last event a client got", () => {
  it("is the number it wrote, and nothing when it sent none", () => {
    assert.deepEqual([eventIdOf("after", "12"), eventIdOf("after", "0"), eventIdOf("after", undefined)], [12, 0, undefined]);
  });

  for (const value of ["", "abc", "-1", "1e3", "1.5", " 2", "1234567890123456", ["1", "2"], null]) {
    it(`is refused, naming where it was sent, when it is ${JSON.stringify(value)}`, () => {
      const refusal = refusalOf(() => eventIdOf("Last-Event-ID", value));
      assert.deepEqual([refusal.failure, refusal.message], ["invalid_request", "Last-Event-ID must be the identifier of an event: a whole number."]);
    });
  }
});

describe("an instance without a source of sessions", () => {
  const source = new NoSessionSource();

  it("has a project without name nor application, no session, and no event", async () => {
    assert.deepEqual(await source.project(), { applications: [] });
    assert.deepEqual(await source.sessions(), []);
    assert.equal(await source.session(), undefined);
    assert.deepEqual(await lastValueFrom(source.events().pipe(toArray())), []);
  });

  it("cannot open a session, and says how to give it a source", async () => {
    await assert.rejects(source.open(), (error) => {
      assert.ok(error instanceof SessionError);
      assert.equal(error.failure, "unavailable");
      assert.match(error.message, /^No source of sessions is configured: set OQAS_SOLO_REPOSITORY /);
      return true;
    });
  });
});

describe("a problem", () => {
  for (const [code, status, type, title] of [
    ["unknown_session", 404, "/problems/unknown-session", "Unknown session"],
    ["invalid_request", 400, "/problems/invalid-request", "Invalid request"],
    ["session_running", 409, "/problems/session-running", "A session is running"],
    ["unavailable", 503, "/problems/unavailable", "Sessions cannot be opened"],
    ["not_opened", 502, "/problems/not-opened", "Session not opened"],
    ["opening_timed_out", 503, "/problems/opening-timed-out", "Opening timed out"],
    ["error", 500, "/problems/error", "Request not answered"],
  ] as const satisfies readonly (readonly [ProblemCode, number, string, string])[]) {
    it(`of the code ${code} has the status ${status}, and a type and a title of its own`, () => {
      assert.deepEqual(problemOf(code, "Why."), { type, title, status, detail: "Why.", code } satisfies Problem);
    });
  }

  it("bears the status it is given rather than that of its code", () => {
    assert.equal(problemOf("error", "Why.", 415).status, 415);
  });

  it("is read from an error of the sessions, with its failure as the code and its message as the detail", () => {
    assert.deepEqual(expectedProblem(new SessionError("session_running", "Wait.")), problemOf("session_running", "Wait."));
  });

  it("is read from a refusal of the framework or of the HTTP server: an invalid request when the status is 400, an error of that status otherwise", () => {
    assert.deepEqual(expectedProblem(new BadRequestException("Not JSON.")), problemOf("invalid_request", "Not JSON."));
    assert.deepEqual(expectedProblem(new NotFoundException("Cannot GET /nowhere")), problemOf("error", "Cannot GET /nowhere", 404));
    assert.deepEqual(expectedProblem({ statusCode: 400, message: "Not JSON." }), problemOf("invalid_request", "Not JSON."));
    assert.deepEqual(expectedProblem(Object.assign(new Error("Too large."), { statusCode: 413 })), problemOf("error", "Too large.", 413));
  });

  it("is not read from anything else: an error without a client status, or what is no error", () => {
    for (const error of [
      new Error("lost"),
      { statusCode: 500, message: "lost" },
      { statusCode: 399, message: "lost" },
      { statusCode: "404", message: "lost" },
    ]) {
      assert.equal(expectedProblem(error), undefined);
    }
    for (const error of [{ statusCode: 404 }, "lost", null, undefined, ["lost"]]) assert.equal(expectedProblem(error), undefined);
  });
});

describe("the service of the sessions", () => {
  it("gives the project, the sessions and a session as their source does", async () => {
    const service = new SessionsService(new OneSession());
    assert.equal(await service.project(), PROJECT);
    assert.deepEqual(await service.sessions(), [SESSION]);
    assert.equal(await service.session(SESSION.id), SESSION);
  });

  it("refuses a session its source does not hold, for itself and for its events", async () => {
    const service = new SessionsService(new OneSession());
    for (const asked of [service.session("s2"), service.events("s2", 0)]) {
      await assert.rejects(asked, (error) => {
        assert.ok(error instanceof SessionError);
        assert.deepEqual([error.failure, error.message], ["unknown_session", "No session s2."]);
        return true;
      });
    }
  });

  it("follows the events of its source after the one it is given, to their end", async () => {
    const source = new OneSession();
    const service = new SessionsService(source);
    assert.deepEqual(await lastValueFrom((await service.events(SESSION.id, 12)).pipe(toArray())), EVENTS);
    assert.deepEqual(source.asked, [[SESSION.id, 12]]);
  });

  it("ends the streams of events still open when its module is destroyed, and at once those opened afterwards", async () => {
    const events = new Subject<SessionEvent>();
    const source = new OneSession();
    source.events = () => events;
    const service = new SessionsService(source);
    const told = lastValueFrom((await service.events(SESSION.id, 0)).pipe(toArray()));
    events.next(ASKED);
    service.onModuleDestroy();
    assert.deepEqual(await told, [ASKED]);
    assert.equal(events.observed, false);
    assert.deepEqual(await lastValueFrom((await service.events(SESSION.id, 0)).pipe(toArray())), []);
    assert.equal(events.observed, false);
  });

  it("opens the session its source opens", async () => {
    const source = new OneSession();
    assert.equal(await new SessionsService(source).open({ request: "cover the profile" }), SESSION);
    assert.deepEqual(source.asked, [{ request: "cover the profile" }]);
  });
});

describe("the controllers of the project and of the sessions", () => {
  it("return what the service returns, the sessions as the items of a list", async () => {
    const source = new OneSession();
    assert.equal(await new ProjectController(new SessionsService(source)).project(), PROJECT);
    const { controller } = controllerOf(source);
    assert.deepEqual(await controller.list(), { items: [SESSION] });
    assert.equal(await controller.one(SESSION.id), SESSION);
  });

  it("answer the session opened, and where to read it: a reference relative to the address of the request", async () => {
    const { controller, headers } = controllerOf(new OneSession());
    const response = {};
    assert.equal(await controller.open({ request: "cover the profile" }, response), SESSION);
    assert.deepEqual(headers, [[response, "Location", "sessions/s%201"]]);
    assert.equal(headers[0]?.[0], response);
  });

  it("open a stream on the identifier it resumes after and the time to wait before reconnecting, send each event under its identifier, then end", async () => {
    const { controller } = controllerOf(new OneSession());
    const messages = await lastValueFrom((await controller.events(SESSION.id, undefined, undefined)).pipe(toArray()));
    assert.deepEqual(messages, [
      { id: "0", retry: 3000 },
      { id: "1", data: ASKED },
      { id: "2", data: ENDED },
    ] satisfies MessageEvent[]);
  });

  it("resume a stream after the event the header names, after the one the address names without it, and refuse what is no identifier", async () => {
    const source = new OneSession();
    const { controller } = controllerOf(source);
    const first = async (lastEventId: unknown, after: unknown) =>
      (await lastValueFrom((await controller.events(SESSION.id, lastEventId, after)).pipe(toArray())))[0];
    assert.deepEqual(await first("7", "3"), { id: "7", retry: 3000 });
    assert.deepEqual(await first(undefined, "3"), { id: "3", retry: 3000 });
    assert.deepEqual(await first("7", "not an identifier"), { id: "7", retry: 3000 });
    assert.deepEqual(
      source.asked,
      [7, 3, 7].map((after) => [SESSION.id, after]),
    );
    for (const [lastEventId, after] of [
      ["x", undefined],
      ["x", "3"],
      [undefined, "x"],
    ]) {
      await assert.rejects(controller.events(SESSION.id, lastEventId, after), (error) => error instanceof SessionError && error.failure === "invalid_request");
    }
    assert.equal(source.asked.length, 3);
  });

  it("send a comment at each heartbeat while a stream has nothing to say, and none once it ended", async () => {
    const events = new Subject<SessionEvent>();
    const source = new OneSession();
    source.events = () => events;
    const { controller } = controllerOf(source, { heartbeatMs: 5, retryMs: 100 });
    const messages: MessageEvent[] = [];
    const ended = new Promise<void>(
      (resolve) =>
        void controller
          .events(SESSION.id, undefined, undefined)
          .then((stream) => stream.subscribe({ next: (message) => messages.push(message), complete: resolve })),
    );
    for (let waited = 0; waited < 1000 && messages.length < 3; waited += 5) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(messages.slice(0, 3), [{ id: "0", retry: 100 }, { comment: "heartbeat" }, { comment: "heartbeat" }]);
    events.next(ENDED);
    events.complete();
    await ended;
    const sent = messages.length;
    assert.deepEqual(messages.at(-1), { id: "2", data: ENDED });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(messages.length, sent);
  });
});
