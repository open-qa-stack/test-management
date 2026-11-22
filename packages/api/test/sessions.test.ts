import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, Logger, type MessageEvent, NotFoundException } from "@nestjs/common";
import type { HttpAdapterHost } from "@nestjs/core";
import { LaunchRefusedError, SessionEndedError, SessionStateError, UnknownSessionError } from "@open-qa-stack/domain";
import type { MessageReceipt, Problem, ProblemCode, Project, Session, SessionEvent, SessionMessage, SessionOpening } from "@open-qa-stack/domain/sessions";
import { type EventListener, NoRepositoryError, type SessionEventStream, type Sessions } from "@open-qa-stack/engine";
import { DatabaseUnavailableError } from "@open-qa-stack/store";
import { lastValueFrom, toArray } from "rxjs";
import { ApiConfiguration } from "../src/config/api-configuration.ts";
import { environmentSettings } from "../src/config/environment-settings.ts";
import { expectedProblem } from "../src/problems/expected-problem.ts";
import { problemOf } from "../src/problems/problem-kinds.ts";
import { eventIdOf } from "../src/sessions/event-id.ts";
import { launchRequestOf, MAX_LAUNCH_PATHS } from "../src/sessions/launch-request.ts";
import { LaunchRequestPipe } from "../src/sessions/launch-request.pipe.ts";
import { LaunchesController } from "../src/sessions/launches.controller.ts";
import { EventStreams } from "../src/sessions/event-streams.ts";
import { ProjectController } from "../src/sessions/project.controller.ts";
import { RunEnvironment } from "../src/sessions/run-environment.ts";
import { SessionError } from "../src/sessions/session-error.ts";
import { MAX_REQUEST_LENGTH, MAX_SCOPE_ITEMS, sessionOpeningOf } from "../src/sessions/session-opening.ts";
import { MAX_MESSAGE_LENGTH, sessionMessageOf } from "../src/sessions/session-message.ts";
import { SessionMessagePipe } from "../src/sessions/session-message.pipe.ts";
import { SessionOpeningPipe } from "../src/sessions/session-opening.pipe.ts";
import { SessionsController } from "../src/sessions/sessions.controller.ts";
import { SessionsLifecycle } from "../src/sessions/sessions-lifecycle.ts";
import { StreamPace } from "../src/sessions/stream-pace.ts";
import { CapturedLogger } from "./support/captured-logger.ts";

/** The variables of an API that is configured, and never started. */
const CONFIGURATION = { OQAS_PORT: "8080", OQAS_DATABASE_URL: "postgres://oqas@127.0.0.1:1/oqas" };
const PROJECT: Project = { name: "shop-tests", applications: [{ id: "shop", name: "Shop" }] };
const SESSION: Session = { id: "s 1", openedAt: "2026-11-14T09:00:00.000Z", lastEventAt: "2026-11-14T09:00:01.000Z", state: "running" };
const ASKED: SessionEvent = { id: 1, at: "2026-11-14T09:00:00.000Z", type: "user_message", text: "cover the profile" };
const ENDED: SessionEvent = { id: 2, at: "2026-11-14T09:00:01.000Z", type: "state_changed", state: "completed" };

/** Events a test tells one by one to whoever follows them, as the operations give the events of a session. */
class ToldEvents {
  /** Who follows the events now. */
  readonly listeners = new Set<EventListener>();

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** The events as the operations type them. */
  get stream(): SessionEventStream {
    return this as unknown as SessionEventStream;
  }

  /** Tells events, then their end when asked. */
  tell(events: readonly SessionEvent[], end = false): void {
    for (const listener of this.listeners) {
      for (const event of events) listener.event(event);
      if (end) listener.ended();
    }
  }
}

/** The operations on one session, which remember what they were asked: a double of those of the engine. */
class OneSession {
  readonly asked: unknown[] = [];
  /** The events the operations give to follow; those of a session that ended, by default. */
  told: ToldEvents | undefined;

  project = async (): Promise<Project> => PROJECT;
  sessions = async (): Promise<Session[]> => [SESSION];
  session = async (): Promise<Session> => SESSION;

  async events(id: string, after: number): Promise<SessionEventStream> {
    this.asked.push([id, after]);
    if (this.told !== undefined) return this.told.stream;
    return {
      subscribe: (listener: EventListener) => (listener.event(ASKED), listener.event(ENDED), listener.ended(), () => undefined),
    } as unknown as SessionEventStream;
  }

  async open(opening: SessionOpening): Promise<Session> {
    this.asked.push(opening);
    return SESSION;
  }

  async say(id: string, message: SessionMessage): Promise<MessageReceipt> {
    this.asked.push([id, message]);
    return { number: 3 };
  }

  async interrupt(id: string): Promise<void> {
    this.asked.push(["interrupt", id]);
  }

  /** The double as the operations it stands for. */
  get operations(): Sessions {
    return this as unknown as Sessions;
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

/** A controller over the operations on one session, with the headers it sets on its answers. */
function controllerOf(source: OneSession, pace = new StreamPace()): { controller: SessionsController; streams: EventStreams; headers: unknown[][] } {
  const headers: unknown[][] = [];
  const adapterHost = { httpAdapter: { setHeader: (...args: unknown[]) => headers.push(args) } } as unknown as HttpAdapterHost;
  const streams = new EventStreams();
  return { controller: new SessionsController(source.operations, streams, pace, adapterHost), streams, headers };
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

  it("keeps the work to a scope when it names one: each list once, an empty one left out", () => {
    assert.deepEqual(
      sessionOpeningOf({
        request: "cover",
        scope: { applications: ["policy-management", "policy-management"], domains: ["insurance-quotes"], levels: ["functional"] },
      }),
      { request: "cover", scope: { applications: ["policy-management"], domains: ["insurance-quotes"], levels: ["functional"] } },
    );
    assert.deepEqual(sessionOpeningOf({ request: "cover", environment: "local", scope: { applications: [], levels: [] } }), {
      request: "cover",
      environment: "local",
      scope: {},
    });
  });

  for (const [scope, message] of [
    ["all", "The body must be a JSON object."],
    [{ teams: ["a"] }, "teams is not a field of a scope."],
    [{ applications: "policies" }, `scope.applications must be a list of at most ${MAX_SCOPE_ITEMS} identifiers.`],
    [{ domains: ["Insurance Quotes"] }, `scope.domains must be a list of at most ${MAX_SCOPE_ITEMS} identifiers.`],
    [
      { domains: Array.from({ length: MAX_SCOPE_ITEMS + 1 }, (_, index) => `d${index}`) },
      `scope.domains must be a list of at most ${MAX_SCOPE_ITEMS} identifiers.`,
    ],
    [
      { levels: ["unit"] },
      `scope.levels must be a list of at most ${MAX_SCOPE_ITEMS} levels among smoke, functional, business, cross-application, end-to-end.`,
    ],
  ] as const) {
    it(`is refused, naming what is at fault, when its scope is ${JSON.stringify(scope).slice(0, 60)}`, () => {
      const refusal = refusalOf(() => sessionOpeningOf({ request: "cover", scope }));
      assert.deepEqual([refusal.failure, refusal.message], ["invalid_request", message]);
    });
  }

  it("is read by the pipe of the route as it is by itself", () => {
    const pipe = new SessionOpeningPipe();
    assert.deepEqual(pipe.transform({ request: "cover the profile" }), { request: "cover the profile" });
    assert.equal(refusalOf(() => pipe.transform({})).failure, "invalid_request");
  });
});

describe("a request to launch tests", () => {
  it("names the files of tests and the environment, each when it is given", () => {
    assert.deepEqual(launchRequestOf({}), {});
    assert.deepEqual(launchRequestOf({ paths: ["apps/shop/tests/search.spec.ts", "a b/c.spec.ts"], environment: "local" }), {
      paths: ["apps/shop/tests/search.spec.ts", "a b/c.spec.ts"],
      environment: "local",
    });
    assert.equal(launchRequestOf({ paths: Array.from({ length: MAX_LAUNCH_PATHS }, (_, index) => `t${index}.spec.ts`) }).paths?.length, MAX_LAUNCH_PATHS);
  });

  const PATHS = `paths must be a list of at most ${MAX_LAUNCH_PATHS} files of tests, relative to the test repository and inside it; leave it out to launch every test.`;
  const ENVIRONMENT = "environment must be a text that is not empty and does not start with -- when it is given.";
  for (const [body, message] of [
    [null, "The body must be a JSON object."],
    [{ paths: "a.spec.ts" }, PATHS],
    [{ paths: [3] }, PATHS],
    [{ paths: [""] }, PATHS],
    [{ paths: ["--grep=x"] }, PATHS],
    [{ paths: ["/etc/passwd"] }, PATHS],
    [{ paths: ["\\server\\a.spec.ts"] }, PATHS],
    [{ paths: ["C:a.spec.ts"] }, PATHS],
    [{ paths: ["../a.spec.ts"] }, PATHS],
    [{ paths: ["apps/../../a.spec.ts"] }, PATHS],
    [{ paths: ["apps/.."] }, PATHS],
    [{ paths: Array.from({ length: MAX_LAUNCH_PATHS + 1 }, () => "a.spec.ts") }, PATHS],
    [{ environment: "" }, ENVIRONMENT],
    [{ environment: 3 }, ENVIRONMENT],
    [{ environment: "--x" }, ENVIRONMENT],
    [{ request: "cover" }, "request is not a field of a request to launch tests."],
  ] as const) {
    it(`is refused, naming what is at fault, when it is ${JSON.stringify(body)?.slice(0, 60)}`, () => {
      const refusal = refusalOf(() => launchRequestOf(body));
      assert.deepEqual([refusal.failure, refusal.message], ["invalid_request", message]);
    });
  }

  it("is read by the pipe of the route as it is by itself, and the controller answers what the operations answer", async () => {
    const pipe = new LaunchRequestPipe();
    assert.deepEqual(pipe.transform({ environment: "local" }), { environment: "local" });
    assert.equal(refusalOf(() => pipe.transform({ paths: 1 })).failure, "invalid_request");
    const launch = { startedAt: "2026-11-20T10:00:00.000Z", environment: "local", paths: [] };
    const asked: unknown[] = [];
    const controller = new LaunchesController({
      launch: (request: unknown) => (asked.push(request), Promise.resolve(launch)),
      launches: () => Promise.resolve({ running: launch }),
    } as unknown as Sessions);
    assert.deepEqual(await controller.launches(), { running: launch });
    return controller.launch({ environment: "local" }).then((started) => {
      assert.equal(started, launch);
      assert.deepEqual(asked, [{ environment: "local" }]);
    });
  });

  it("is told launch_refused, with what to do, when it cannot be launched now", () => {
    assert.deepEqual(expectedProblem(new LaunchRefusedError("A session runs its tests: launch these once it ended.")), {
      ...problemOf("launch_refused", "A session runs its tests: launch these once it ended."),
      status: 409,
    });
  });
});

describe("a message sent to a session", () => {
  it("says what the person says, as it was written", () => {
    assert.deepEqual(sessionMessageOf({ text: " --not that page\nthe other " }), { text: " --not that page\nthe other " });
    assert.equal(sessionMessageOf({ text: "x".repeat(MAX_MESSAGE_LENGTH) }).text.length, 4000);
  });

  const TEXT = "text must be a text that is not empty.";
  for (const [body, message] of [
    [undefined, "The body must be a JSON object."],
    ["not that page", "The body must be a JSON object."],
    [["not that page"], "The body must be a JSON object."],
    [{}, TEXT],
    [{ text: "" }, TEXT],
    [{ text: " \n" }, TEXT],
    [{ text: 3 }, TEXT],
    [{ text: ["not that page"] }, TEXT],
    [{ text: "x".repeat(MAX_MESSAGE_LENGTH + 1) }, "text must not be longer than 4000 characters."],
    [{ text: "not that page", agent: "writer" }, "agent is not a field of a message to a session."],
  ] as const) {
    it(`is refused, naming what is at fault, when it is ${JSON.stringify(body)?.slice(0, 60)}`, () => {
      const refusal = refusalOf(() => sessionMessageOf(body));
      assert.deepEqual([refusal.failure, refusal.message], ["invalid_request", message]);
    });
  }

  it("is read by the pipe of the route as it is by itself", () => {
    const pipe = new SessionMessagePipe();
    assert.deepEqual(pipe.transform({ text: "not that page" }), { text: "not that page" });
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

describe("a problem", () => {
  for (const [code, status, type, title] of [
    ["unknown_session", 404, "/problems/unknown-session", "Unknown session"],
    ["invalid_request", 400, "/problems/invalid-request", "Invalid request"],
    ["session_running", 409, "/problems/session-running", "A session is running"],
    ["session_ended", 409, "/problems/session-ended", "Session ended"],
    ["unavailable", 503, "/problems/unavailable", "Sessions unavailable"],
    ["not_opened", 502, "/problems/not-opened", "Session not opened"],
    ["opening_timed_out", 503, "/problems/opening-timed-out", "Opening timed out"],
    ["stale_revision", 409, "/problems/stale-revision", "Stale revision"],
    ["invalid_configuration", 422, "/problems/invalid-configuration", "Invalid configuration"],
    ["no_configuration", 404, "/problems/no-configuration", "No configuration"],
    ["unknown_document_source", 404, "/problems/unknown-document-source", "Unknown source of documents"],
    ["unknown_document", 404, "/problems/unknown-document", "Unknown document"],
    ["invalid_documents", 422, "/problems/invalid-documents", "Invalid documents"],
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

  it("is read from a refusal of the operations: a session that does not exist, one that ended, one that goes on and is resumed, and no test repository to run one in, with what to set", () => {
    assert.deepEqual(expectedProblem(new UnknownSessionError("s2")), problemOf("unknown_session", "No session s2."));
    assert.deepEqual(
      expectedProblem(new SessionStateError("s1", "resume", "running")),
      problemOf("session_running", "The session s1 takes no resume while it is running. It goes on: send it a message instead."),
    );
    assert.deepEqual(
      expectedProblem(new SessionEndedError("s1")),
      problemOf("session_ended", "The session s1 no longer goes on. It takes no message and no interruption: resume it with a message to go on."),
    );
    assert.deepEqual(
      expectedProblem(new NoRepositoryError()),
      problemOf(
        "unavailable",
        "The API was started without a test repository: it opens no session and changes no configuration. Set OQAS_REPOSITORY to the absolute path of a folder, and start the API again.",
      ),
    );
  });

  it("is read from a database that cannot be reached as sessions that are unavailable, without what the database said", () => {
    assert.deepEqual(
      expectedProblem(new DatabaseUnavailableError("connect ECONNREFUSED 10.0.0.7:5432")),
      problemOf("unavailable", "The database of the instance cannot be reached, and its sessions with it: try again once the instance reports itself ready."),
    );
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

describe("the controllers of the project and of the sessions", () => {
  it("return what the operations return, the sessions as the items of a list", async () => {
    const source = new OneSession();
    assert.equal(await new ProjectController(source.operations).project(), PROJECT);
    const { controller } = controllerOf(source);
    assert.deepEqual(await controller.list(), { items: [SESSION] });
    assert.equal(await controller.one(SESSION.id), SESSION);
  });

  it("answer the session opened, and where to read it: a reference relative to the address of the request", async () => {
    const source = new OneSession();
    const { controller, headers } = controllerOf(source);
    const response = {};
    assert.equal(await controller.open({ request: "cover the profile" }, response), SESSION);
    assert.deepEqual(headers, [[response, "Location", "sessions/s%201"]]);
    assert.equal(headers[0]?.[0], response);
    assert.deepEqual(source.asked, [{ request: "cover the profile" }]);
  });

  it("say a message to a session and answer its receipt, and interrupt a session", async () => {
    const source = new OneSession();
    const { controller } = controllerOf(source);
    assert.deepEqual(await controller.send(SESSION.id, { text: "not that page" }), { number: 3 });
    assert.equal(await controller.interrupt(SESSION.id), undefined);
    assert.deepEqual(source.asked, [
      [SESSION.id, { text: "not that page" }],
      ["interrupt", SESSION.id],
    ]);
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
    const source = new OneSession();
    source.told = new ToldEvents();
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
    source.told.tell([ENDED], true);
    await ended;
    const sent = messages.length;
    assert.deepEqual(messages.at(-1), { id: "2", data: ENDED });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(messages.length, sent);
  });
});

describe("the events of a session, as the server streams them", () => {
  it("are those the operations give, read while they are subscribed to, and left when the client leaves", () => {
    const told = new ToldEvents();
    const seen: SessionEvent[] = [];
    const subscription = new EventStreams().of("s1", told.stream).subscribe((event) => seen.push(event));
    told.tell([ASKED]);
    assert.deepEqual([seen, told.listeners.size], [[ASKED], 1]);
    subscription.unsubscribe();
    assert.equal(told.listeners.size, 0);
  });

  it("end the streams still open when the module is destroyed, and at once those opened afterwards", async () => {
    const told = new ToldEvents();
    const streams = new EventStreams();
    const followed = lastValueFrom(streams.of("s1", told.stream).pipe(toArray()));
    told.tell([ASKED]);
    streams.onModuleDestroy();
    assert.deepEqual(await followed, [ASKED]);
    assert.equal(told.listeners.size, 0);
    assert.deepEqual(await lastValueFrom(streams.of("s1", told.stream).pipe(toArray())), []);
    assert.equal(told.listeners.size, 0);
  });

  it("end, with a warning in the log, when they can no longer be read, an error or not", async () => {
    const logger = new CapturedLogger();
    Logger.overrideLogger(logger);
    try {
      for (const failure of [new Error("The database is unreachable."), "lost"]) {
        const failing = {
          subscribe: (listener: EventListener) => (listener.event(ASKED), listener.failed(failure), () => undefined),
        } as unknown as SessionEventStream;
        assert.deepEqual(await lastValueFrom(new EventStreams().of("s1", failing).pipe(toArray())), [ASKED]);
      }
    } finally {
      Logger.overrideLogger(false);
    }
    assert.deepEqual(
      logger.lines.map((line) => line.replace(/ Sessions$/, "")),
      [
        "warn The events of the session s1 can no longer be read: The database is unreachable.",
        "warn The events of the session s1 can no longer be read: lost",
      ],
    );
  });
});

describe("the operations on sessions, started and stopped with the API", () => {
  /** The lifecycle over operations that start and stop as a test says, with what it logged. */
  async function lived(start: () => Promise<void>, stopped: boolean): Promise<{ lines: string[]; within: number[] }> {
    const logger = new CapturedLogger();
    const within: number[] = [];
    const operations = { start, stop: async (withinMs: number) => (within.push(withinMs), stopped) } as unknown as Sessions;
    Logger.overrideLogger(logger);
    try {
      const lifecycle = new SessionsLifecycle(operations, new RunEnvironment(ApiConfiguration.read(CONFIGURATION)));
      await lifecycle.onApplicationBootstrap();
      await lifecycle.onModuleDestroy();
    } finally {
      Logger.overrideLogger(false);
    }
    return { lines: logger.lines.map((line) => line.replace(/ Sessions$/, "")), within };
  }

  it("start with it, and are given ten seconds to stop with it, without a word when both went well", async () => {
    assert.deepEqual(await lived(async () => undefined, true), { lines: [], within: [10_000] });
  });

  it("do not stop the startup when they cannot start, nor the stop when the session under way did not end in time: both are logged", async () => {
    const failed = await lived(() => Promise.reject(new Error("The database is unreachable.")), false);
    assert.deepEqual(failed.lines, [
      "warn The sessions are not started, and will be when one is next opened: The database is unreachable.",
      "warn The session under way did not end in time: it stays running in the database until a process that hosts sessions interrupts it.",
    ]);
    assert.deepEqual((await lived(() => Promise.reject("lost"), true)).lines, ["warn The sessions are not started, and will be when one is next opened: lost"]);
  });

  it("run their sessions with what the API was started with: the environment it read its configuration from, or what a host settled for it", () => {
    const read = environmentSettings(CONFIGURATION);
    assert.deepEqual(new RunEnvironment(ApiConfiguration.of(read)).runs, { env: CONFIGURATION, mapsKnowledge: true });
    const runs = { env: { SHOP_DB_URL: "witness" }, pace: { beatMs: 5, silentAfterMs: 50, followMs: 5 } };
    assert.equal(new RunEnvironment(ApiConfiguration.of({ ...read, runs })).runs, runs);
  });
});
