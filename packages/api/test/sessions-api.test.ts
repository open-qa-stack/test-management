import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, it } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import type { MessageReceipt, Problem, Session, SessionEvent, SessionList } from "@open-qa-stack/shared/sessions";
import { closedPort } from "@open-qa-stack/testing";
import { Observable } from "rxjs";
import { NoSessionSource } from "../src/sessions/no-session-source.ts";
import { SoloSessionSource } from "../src/solo/solo-session-source.ts";
import { startApi } from "../src/start-api.ts";
import { CapturedLogger } from "./support/captured-logger.ts";
import { EventStream } from "./support/event-stream.ts";
import { fakeOqas } from "./support/fake-oqas.ts";
import { at, deliveredNow, entry, traced } from "./support/run-lines.ts";
import { sessionsApi, type TestApi } from "./support/sessions-api.ts";
import { FIRST, SECOND, stampOf, TestRepository } from "./support/test-repository.ts";

const JSON_TYPE = "application/json; charset=utf-8";
const PROBLEM_TYPE = "application/problem+json; charset=utf-8";

const noted = (seconds: number, text: string) => entry(seconds, "configuration", "info", text);

/** A repository with a run that ended and a run that still writes. */
function repositoryOfTwoRuns(): TestRepository {
  const repository = new TestRepository({ applications: [{ id: "shop", name: "Shop" }] });
  repository.journal(FIRST, noted(1, "One."));
  repository.trace("design-local", stampOf(FIRST), traced(2, "plan", "agent", { type: "text", text: "Two." }));
  repository.end(FIRST, { brief: "cover the profile", environment: "local", exitCode: 0, durationMs: 2000, steps: [{ modelRequests: 3 }], tests: [] });
  repository.journal(SECOND, noted(3601, "One of the second."));
  return repository;
}

/** Runs a test against an API that serves the runs of a repository, then closes the API. */
async function withApi(repository: TestRepository, test: (api: TestApi, logger: CapturedLogger) => Promise<void>, command = fakeOqas("starts")): Promise<void> {
  const logger = new CapturedLogger();
  const source = new SoloSessionSource({ repository: repository.root, command, pollMs: 10, settleMs: 0, openWaitMs: 5000 });
  const api = await sessionsApi(source, logger);
  try {
    await test(api, logger);
  } finally {
    await api.close();
  }
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
function post(api: TestApi, body: string, type = "application/json"): Promise<Response> {
  return fetch(`${api.url}/sessions`, { method: "POST", headers: { "content-type": type }, body });
}

/** Sends a message to a session. */
function say(api: TestApi, id: string, body: string): Promise<Response> {
  return fetch(`${api.url}/sessions/${id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body });
}

/** A source without session whose listing fails on an error that names a file of the machine. */
function brokenSource(): NoSessionSource {
  const source = new NoSessionSource();
  source.sessions = () => Promise.reject(new Error("EACCES: permission denied, open '/srv/secret'"));
  return source;
}

describe("the routes of the project and of the sessions", () => {
  it("give the project of the instance, which no cache may keep", async () => {
    const repository = repositoryOfTwoRuns();
    await withApi(repository, async (api) => {
      const response = await fetch(`${api.url}/project`);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await answerOf(response), {
        status: 200,
        type: JSON_TYPE,
        body: { name: basename(repository.root), applications: [{ id: "shop", name: "Shop" }] },
      });
    });
  });

  it("list the sessions as the items of a list, the latest first, and give one by its identifier, which no cache may keep", async () => {
    await withApi(repositoryOfTwoRuns(), async (api) => {
      const listed = await fetch(`${api.url}/sessions`);
      assert.equal(listed.headers.get("cache-control"), "no-store");
      const { status, body } = await answerOf(listed);
      assert.equal(status, 200);
      assert.deepEqual(Object.keys(body as SessionList), ["items"]);
      const sessions = (body as SessionList).items;
      assert.deepEqual(
        sessions.map(({ id, state, request }) => [id, state, request]),
        [
          [SECOND, "running", undefined],
          [FIRST, "completed", "cover the profile"],
        ],
      );
      assert.deepEqual(sessions[1]?.result, { outcome: "passed", durationMs: 2000, modelRequests: 3, tests: [] });
      const one = await fetch(`${api.url}/sessions/${FIRST}`);
      assert.equal(one.headers.get("cache-control"), "no-store");
      assert.deepEqual(await answerOf(one), { status: 200, type: JSON_TYPE, body: sessions[1] });
    });
  });

  it("answer 404 with a problem for a session that does not exist, and for its events", async () => {
    await withApi(repositoryOfTwoRuns(), async (api) => {
      for (const path of ["/sessions/oqas-unknown", "/sessions/oqas-unknown/events"]) {
        assert.deepEqual(await answerOf(await fetch(`${api.url}${path}`)), {
          status: 404,
          type: PROBLEM_TYPE,
          body: { type: "/problems/unknown-session", title: "Unknown session", status: 404, detail: "No session oqas-unknown.", code: "unknown_session" },
        });
      }
    });
  });
});

describe("every answer of the API that is not a success", () => {
  it("is a problem: for a route that does not exist, a body that is not JSON, and a media type the API does not read", async () => {
    await withApi(new TestRepository(), async (api) => {
      assert.deepEqual(await answerOf(await fetch(`${api.url}/nowhere`)), {
        status: 404,
        type: PROBLEM_TYPE,
        body: { type: "/problems/error", title: "Request not answered", status: 404, detail: "Cannot GET /nowhere", code: "error" },
      });
      const malformed = await problemOf(await post(api, "{"));
      assert.deepEqual([malformed.status, malformed.type, malformed.body.code], [400, PROBLEM_TYPE, "invalid_request"]);
      const unread = await problemOf(await post(api, "cover the profile", "text/yaml"));
      assert.deepEqual([unread.status, unread.type, unread.body.status, unread.body.code], [415, PROBLEM_TYPE, 415, "error"]);
    });
  });

  it("says nothing of an error the API does not expect, which it logs", async () => {
    const logger = new CapturedLogger();
    const api = await sessionsApi(brokenSource(), logger);
    try {
      assert.deepEqual(
        await problemOf(await fetch(`${api.url}/sessions`)),
        problem(500, "error", "The API failed to answer the request; the log of the instance has the error."),
      );
      const logged = logger.lines.filter((line) => line.startsWith("error "));
      assert.equal(logged.length, 1);
      assert.match(
        String(logged[0]),
        /^error A request failed on an error the API does not expect\. Error: EACCES: permission denied, open '\/srv\/secret'\n\s+at /,
      );
    } finally {
      await api.close();
    }
  });

  it("logs what was raised as it is when it is no error", async () => {
    const logger = new CapturedLogger();
    const source = new NoSessionSource();
    source.project = () => Promise.reject("lost");
    const api = await sessionsApi(source, logger);
    try {
      assert.equal((await fetch(`${api.url}/project`)).status, 500);
      assert.ok(logger.lines.includes("error A request failed on an error the API does not expect. lost Api"), logger.lines.join("\n"));
    } finally {
      await api.close();
    }
  });
});

describe("the stream of the events of a session", () => {
  it("is a stream of server-sent events: how long to wait before reconnecting, every event in order under its identifier, then its end once the session ended", async () => {
    await withApi(repositoryOfTwoRuns(), async (api) => {
      const stream = await EventStream.open(`${api.url}/sessions/${FIRST}/events`);
      assert.equal(stream.response.status, 200);
      assert.match(String(stream.response.headers.get("content-type")), /^text\/event-stream/);
      assert.equal(await stream.block(), "id: 0\nretry: 3000");
      const messages = [await stream.next(), await stream.next(), await stream.next()];
      assert.deepEqual(
        messages.map((message) => message?.id),
        ["1", "2", "3"],
      );
      assert.deepEqual(messages[0]?.event, { id: 1, at: at(1), type: "note", phase: "configuration", text: "One." });
      assert.deepEqual(messages[1]?.event, { id: 2, at: at(2), type: "agent_message", agent: "planner", text: "Two.", reasoning: false });
      assert.deepEqual([messages[2]?.event.id, messages[2]?.event.type], [3, "state_changed"]);
      assert.equal(await stream.next(), undefined);
    });
  });

  it("carries the new events as the run writes them, and ends once it told the end of the session", async () => {
    const repository = repositoryOfTwoRuns();
    await withApi(repository, async (api) => {
      const stream = await EventStream.open(`${api.url}/sessions/${SECOND}/events`);
      assert.deepEqual(
        (await stream.take(1)).map(({ id }) => id),
        [1],
      );
      repository.trace("design-local", stampOf(SECOND), traced(3602, "plan", "harness", { type: "started" }));
      repository.journal(SECOND, noted(3603, "Three of the second."));
      assert.deepEqual(
        (await stream.take(2)).map(({ id, type }) => [id, type]),
        [
          [2, "phase_started"],
          [3, "note"],
        ],
      );
      repository.end(SECOND, { exitCode: 1 });
      assert.deepEqual(await stream.take(1).then(([event]) => [event?.id, event?.type]), [4, "state_changed"]);
      assert.equal(await stream.next(), undefined);
    });
  });

  it("sends a comment at each heartbeat while the session has nothing to say", async () => {
    const source = new SoloSessionSource({ repository: repositoryOfTwoRuns().root, pollMs: 10, settleMs: 0 });
    const api = await sessionsApi(source, false, { heartbeatMs: 20, retryMs: 1500 });
    try {
      const stream = await EventStream.open(`${api.url}/sessions/${SECOND}/events`);
      try {
        assert.equal(await stream.block(), "id: 0\nretry: 1500");
        // On a busy machine a heartbeat may come before the first reading of the run does.
        let block = await stream.block();
        while (block === ": heartbeat") block = await stream.block();
        assert.match(String(block), /^id: 1\ndata: /);
        assert.deepEqual([await stream.block(), await stream.block()], [": heartbeat", ": heartbeat"]);
      } finally {
        await stream.close();
      }
    } finally {
      await api.close();
    }
  });

  it("gives a client that reconnects only the events after the last one it got, named by the header or in the address, where the header wins", async () => {
    await withApi(repositoryOfTwoRuns(), async (api) => {
      const url = `${api.url}/sessions/${FIRST}/events`;
      const first = await EventStream.open(url);
      const [, last] = await first.take(2);
      await first.close();
      const resumed = await EventStream.open(url, String(last?.id));
      assert.equal(await resumed.block(), "id: 2\nretry: 3000");
      assert.deepEqual((await resumed.next())?.id, "3");
      assert.equal(await resumed.next(), undefined);
      const fresh = await EventStream.open(`${url}?after=1`);
      assert.deepEqual((await fresh.next())?.id, "2");
      await fresh.close();
      const both = await EventStream.open(`${url}?after=1`, "2");
      assert.deepEqual((await both.next())?.id, "3");
      await both.close();
    });
  });

  it("ends at once, without an event, for a client that already got the end of the session", async () => {
    await withApi(repositoryOfTwoRuns(), async (api) => {
      const stream = await EventStream.open(`${api.url}/sessions/${FIRST}/events?after=3`);
      assert.equal(await stream.block(), "id: 3\nretry: 3000");
      assert.equal(await stream.block(), undefined);
    });
  });

  it("answers 400 with a problem for an identifier of event that is none, in the header or in the address", async () => {
    await withApi(repositoryOfTwoRuns(), async (api) => {
      const url = `${api.url}/sessions/${FIRST}/events`;
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
  });

  it("ends, with a warning in the log, when the run can no longer be read, and the API keeps answering", async () => {
    const repository = repositoryOfTwoRuns();
    await withApi(repository, async (api, logger) => {
      const stream = await EventStream.open(`${api.url}/sessions/${SECOND}/events`);
      await stream.take(1);
      repository.remove(repository.journalPath(SECOND));
      assert.equal(await stream.next(), undefined);
      assert.deepEqual(
        logger.lines.filter((line) => line.endsWith(" Sessions")),
        [`warn The events of the session ${SECOND} can no longer be read: The test repository no longer holds the run ${SECOND}. Sessions`],
      );
      assert.equal((await fetch(`${api.url}/sessions`)).status, 200);
    });
  });

  it("ends when its source fails with anything, said as it is in the log", async () => {
    const logger = new CapturedLogger();
    const source = new NoSessionSource();
    source.session = () => Promise.resolve(undefined).then(() => ({ id: "s1" }) as never);
    source.events = () => new Observable<SessionEvent>((subscriber) => subscriber.error("lost"));
    const api = await sessionsApi(source, logger);
    try {
      const stream = await EventStream.open(`${api.url}/sessions/s1/events`);
      assert.equal(stream.response.status, 200);
      assert.equal(await stream.next(), undefined);
      assert.ok(logger.lines.includes("warn The events of the session s1 can no longer be read: lost Sessions"), logger.lines.join("\n"));
    } finally {
      await api.close();
    }
  });

  it("stops reading its source when the client leaves", async () => {
    let followed = 0;
    const source = new NoSessionSource();
    source.session = () => Promise.resolve(undefined).then(() => ({ id: "s1" }) as never);
    source.events = () =>
      new Observable<SessionEvent>((subscriber) => {
        followed++;
        subscriber.next({ id: 1, at: at(1), type: "user_message", text: "cover the profile" });
        return () => followed--;
      });
    const api = await sessionsApi(source);
    try {
      const stream = await EventStream.open(`${api.url}/sessions/s1/events`);
      await stream.take(1);
      assert.equal(followed, 1);
      await stream.close();
      for (let waited = 0; waited < 1000 && followed > 0; waited += 10) await pause(10);
      assert.equal(followed, 0);
    } finally {
      await api.close();
    }
  });
});

describe("the opening of a session", () => {
  it("answers 201 with the session opened, running, and where to read it, which the instance then lists", async () => {
    const repository = new TestRepository();
    await withApi(repository, async (api) => {
      const response = await post(api, JSON.stringify({ request: "cover the profile", environment: "local" }));
      const location = String(response.headers.get("location"));
      const { status, type, body } = await answerOf(response);
      const session = body as Session;
      assert.deepEqual([status, type, session.state, location], [201, JSON_TYPE, "running", `sessions/${session.id}`]);
      assert.deepEqual((await answerOf(await fetch(new URL(location, response.url)))).body, session);
      assert.deepEqual((await answerOf(await fetch(`${api.url}/sessions`))).body, { items: [session] });
      const stream = await EventStream.open(`${api.url}/sessions/${session.id}/events`);
      try {
        const [first] = await stream.take(1);
        assert.ok(first?.type === "note" && first.text.includes('"--brief","cover the profile","--environment","local"'));
      } finally {
        await stream.close();
      }
    });
  });

  it("answers 409 with a problem while a session of the instance is running", async () => {
    await withApi(new TestRepository(), async (api) => {
      const opened = (await answerOf(await post(api, JSON.stringify({ request: "cover the profile" })))).body as Session;
      assert.deepEqual(
        await problemOf(await post(api, JSON.stringify({ request: "cover the orders" }))),
        problem(409, "session_running", `The session ${opened.id} is running: wait for its end before opening another.`),
      );
    });
  });

  for (const [body, detail] of [
    ["{}", "request must be a text that is not empty and does not start with --."],
    ['{"request":"--help"}', "request must be a text that is not empty and does not start with --."],
    [JSON.stringify({ request: "x".repeat(4001) }), "request must not be longer than 4000 characters."],
    ['{"request":"cover","environment":3}', "environment must be a text that is not empty and does not start with -- when it is given."],
    ['{"request":"cover","mode":"fast"}', "mode is not a field of a request to open a session."],
    ['["cover"]', "The body must be a JSON object."],
  ] as const) {
    it(`answers 400 with a problem that names what is at fault in ${body.slice(0, 40)}`, async () => {
      await withApi(new TestRepository(), async (api) => {
        assert.deepEqual(await problemOf(await post(api, body)), problem(400, "invalid_request", detail));
      });
    });
  }

  it("answers 502 without the error output of the command, which it logs, when the command stops before it starts a run", async () => {
    await withApi(
      new TestRepository(),
      async (api, logger) => {
        assert.deepEqual(
          await problemOf(await post(api, JSON.stringify({ request: "cover the profile" }))),
          problem(502, "not_opened", "The command stopped before opening a session; the log of the instance has its output."),
        );
        const logged = logger.lines.filter((line) => line.endsWith(" Solo"));
        assert.equal(logged.length, 1);
        assert.match(String(logged[0]), /^warn The command stopped before opening a session:\nerror line 3\n[^]*\nerror line 12 Solo$/);
      },
      fakeOqas("fails"),
    );
  });

  it("answers 503 when the run does not start in time", async () => {
    const source = new SoloSessionSource({ repository: new TestRepository().root, command: fakeOqas("hangs"), pollMs: 10, openWaitMs: 50 });
    const api = await sessionsApi(source);
    try {
      assert.deepEqual(
        await problemOf(await post(api, JSON.stringify({ request: "cover the profile" }))),
        problem(503, "opening_timed_out", "The session did not start within 50 ms; the command was stopped."),
      );
    } finally {
      await api.close();
    }
  });
});

describe("a message sent to a session that is going on", () => {
  it("is answered 202 with its number in the session, from 1, and appended to the inbox of the run", async () => {
    const repository = repositoryOfTwoRuns();
    await withApi(repository, async (api) => {
      for (const [text, number] of [
        ["not that page", 1],
        ["the other one", 2],
      ] as const) {
        assert.deepEqual(await answerOf(await say(api, SECOND, JSON.stringify({ text }))), {
          status: 202,
          type: JSON_TYPE,
          body: { number } satisfies MessageReceipt,
        });
      }
      const lines = readFileSync(repository.inboxPath(SECOND), "utf8").split("\n");
      assert.deepEqual(
        lines.slice(0, 2).map((line) => (JSON.parse(line) as { text: string }).text),
        ["not that page", "the other one"],
      );
      assert.deepEqual(lines.slice(2), [""]);
    });
  });

  it("is told by the stream of the session under its number, then its delivery to an agent once the run traces it", async () => {
    const repository = repositoryOfTwoRuns();
    await withApi(repository, async (api) => {
      const stream = await EventStream.open(`${api.url}/sessions/${SECOND}/events`);
      try {
        await stream.take(1);
        assert.equal((await say(api, SECOND, JSON.stringify({ text: "not that page" }))).status, 202);
        const [said] = await stream.take(1);
        assert.deepEqual({ ...said, at: "" }, { id: 2, at: "", type: "user_message", text: "not that page", number: 1 });
        repository.trace("design-local", stampOf(SECOND), deliveredNow("plan", 1, "not that page"));
        const [reached] = await stream.take(1);
        assert.deepEqual({ ...reached, at: "" }, { id: 3, at: "", type: "message_delivered", message: 1, agent: "planner" });
      } finally {
        await stream.close();
      }
    });
  });

  it("keeps a number of its own when several are sent at once", async () => {
    const repository = repositoryOfTwoRuns();
    await withApi(repository, async (api) => {
      const answers = await Promise.all(Array.from({ length: 12 }, (_, rank) => say(api, SECOND, JSON.stringify({ text: `message ${rank}` })).then(answerOf)));
      assert.deepEqual(
        answers.map(({ body }) => (body as MessageReceipt).number).sort((a, b) => a - b),
        answers.map((_, rank) => rank + 1),
      );
      assert.equal(readFileSync(repository.inboxPath(SECOND), "utf8").split("\n").length, 13);
    });
  });

  for (const [body, detail] of [
    ["{}", "text must be a text that is not empty."],
    ['{"text":"  "}', "text must be a text that is not empty."],
    [JSON.stringify({ text: "x".repeat(4001) }), "text must not be longer than 4000 characters."],
    ['{"text":"not that page","to":"writer"}', "to is not a field of a message to a session."],
    ['["not that page"]', "The body must be a JSON object."],
  ] as const) {
    it(`is answered 400 with a problem that names what is at fault in ${body.slice(0, 40)}`, async () => {
      const repository = repositoryOfTwoRuns();
      await withApi(repository, async (api) => {
        assert.deepEqual(await problemOf(await say(api, SECOND, body)), problem(400, "invalid_request", detail));
        assert.equal(existsSync(repository.inboxPath(SECOND)), false);
      });
    });
  }

  it("is answered 404 with a problem by a session that does not exist", async () => {
    await withApi(repositoryOfTwoRuns(), async (api) => {
      assert.deepEqual(
        await problemOf(await say(api, "oqas-unknown", JSON.stringify({ text: "not that page" }))),
        problem(404, "unknown_session", "No session oqas-unknown."),
      );
    });
  });

  it("is answered 409 with a problem by a session that is completed, and by one that is interrupted", async () => {
    const repository = repositoryOfTwoRuns();
    repository.touch(repository.journalPath(SECOND), new Date(at(3602)));
    await withApi(repository, async (api) => {
      assert.deepEqual(await answerOf(await say(api, FIRST, JSON.stringify({ text: "not that page" }))), {
        status: 409,
        type: PROBLEM_TYPE,
        body: {
          type: "/problems/session-ended",
          title: "Session ended",
          status: 409,
          detail: `The session ${FIRST} is completed and takes no message: open another session to go on.`,
          code: "session_ended",
        },
      });
      assert.deepEqual(
        await problemOf(await say(api, SECOND, JSON.stringify({ text: "not that page" }))),
        problem(409, "session_ended", `The session ${SECOND} is interrupted and takes no message: open another session to go on.`),
      );
      assert.equal(existsSync(repository.inboxPath(FIRST)) || existsSync(repository.inboxPath(SECOND)), false);
    });
  });

  it("is answered 503 with a problem by an instance without a source of sessions, which says what to configure", async () => {
    const api = await sessionsApi(new NoSessionSource());
    try {
      const refused = await problemOf(await say(api, FIRST, JSON.stringify({ text: "not that page" })));
      assert.deepEqual([refused.status, refused.type, refused.body.code], [503, PROBLEM_TYPE, "unavailable"]);
      assert.match(String(refused.body.detail), /^No source of sessions is configured: set OQAS_SOLO_REPOSITORY /);
    } finally {
      await api.close();
    }
  });
});

describe("an API started with the variables of the bridge to the command line", () => {
  /** Starts the API as the program does, with the given variables besides the required ones. */
  async function started(variables: Record<string, string>, logger: CapturedLogger | false = false): Promise<TestApi> {
    const port = await closedPort();
    const database = `postgres://oqas@127.0.0.1:${await closedPort()}/oqas`;
    const app = await startApi({ OQAS_HOST: "127.0.0.1", OQAS_PORT: String(port), OQAS_DATABASE_URL: database, ...variables }, { logger });
    return { url: `http://127.0.0.1:${port}`, close: () => app.close() };
  }

  /** What the bridge warned about in a log. */
  const warned = (logger: CapturedLogger) => logger.lines.filter((line) => line.startsWith("warn ") && line.endsWith(" Solo"));

  it("has no session, a project without a name, and cannot open a session when no repository is configured", async () => {
    const logger = new CapturedLogger();
    const api = await started({}, logger);
    try {
      assert.deepEqual((await answerOf(await fetch(`${api.url}/project`))).body, { applications: [] });
      assert.deepEqual((await answerOf(await fetch(`${api.url}/sessions`))).body, { items: [] });
      assert.equal((await fetch(`${api.url}/sessions/${FIRST}`)).status, 404);
      assert.equal((await fetch(`${api.url}/sessions/${FIRST}/events`)).status, 404);
      const refused = await problemOf(await post(api, JSON.stringify({ request: "cover the profile" })));
      assert.deepEqual([refused.status, refused.body.code], [503, "unavailable"]);
      assert.match(String(refused.body.detail), /^No source of sessions is configured: set OQAS_SOLO_REPOSITORY /);
      assert.equal((await fetch(`${api.url}/health`)).status, 200);
      assert.deepEqual(warned(logger), []);
    } finally {
      await api.close();
    }
  });

  it("keeps the body of its own for an instance that is not ready", async () => {
    const api = await started({});
    try {
      assert.deepEqual(await answerOf(await fetch(`${api.url}/health/ready`)), {
        status: 503,
        type: JSON_TYPE,
        body: { status: "not_ready", checks: { database: "unreachable" } },
      });
    } finally {
      await api.close();
    }
  });

  it("reads the sessions of the repository, and says how to let it open one when the command is not configured", async () => {
    const logger = new CapturedLogger();
    const repository = repositoryOfTwoRuns();
    const api = await started({ OQAS_SOLO_REPOSITORY: repository.root }, logger);
    try {
      assert.equal(((await answerOf(await fetch(`${api.url}/sessions`))).body as SessionList).items.length, 2);
      const stream = await EventStream.open(`${api.url}/sessions/${FIRST}/events`);
      assert.deepEqual(
        (await stream.take(2)).map(({ id }) => id),
        [1, 2],
      );
      await stream.close();
      const refused = await problemOf(await post(api, JSON.stringify({ request: "cover the profile" })));
      assert.deepEqual([refused.status, refused.body.code], [503, "unavailable"]);
      assert.match(String(refused.body.detail), /set OQAS_SOLO_COMMAND to the command that starts oqas\.$/);
      assert.deepEqual(warned(logger), []);
    } finally {
      await api.close();
    }
  });

  it("warns at startup that a repository that is no folder shows no session, and starts all the same", async () => {
    for (const repository of [join(new TestRepository().root, "absent"), join(new TestRepository().root, "oqas.json")]) {
      const logger = new CapturedLogger();
      const api = await started({ OQAS_SOLO_REPOSITORY: repository }, logger);
      try {
        assert.deepEqual(warned(logger), [`warn OQAS_SOLO_REPOSITORY names ${repository}, which is no folder: the instance shows no session. Solo`]);
        assert.deepEqual((await answerOf(await fetch(`${api.url}/sessions`))).body, { items: [] });
      } finally {
        await api.close();
      }
    }
  });

  it("warns at startup that a command set without a repository opens no session", async () => {
    const logger = new CapturedLogger();
    const api = await started({ OQAS_SOLO_COMMAND: "oqas" }, logger);
    try {
      assert.deepEqual(warned(logger), [
        "warn OQAS_SOLO_COMMAND is set without OQAS_SOLO_REPOSITORY: no session can be opened until the repository is set. Solo",
      ]);
    } finally {
      await api.close();
    }
  });

  it("ends the streams of events left open when it closes, which they do not hold back", async () => {
    const api = await started({ OQAS_SOLO_REPOSITORY: repositoryOfTwoRuns().root });
    const stream = await EventStream.open(`${api.url}/sessions/${SECOND}/events`);
    await stream.take(1);
    await api.close();
    assert.equal(await stream.next(), undefined);
  });

  it("opens sessions with the configured command, which is given the environment of the API without its secrets", async () => {
    const repository = new TestRepository();
    const [program, script] = fakeOqas("starts");
    const api = await started({ OQAS_SOLO_REPOSITORY: repository.root, OQAS_SOLO_COMMAND: `"${program}" "${script}"`, SHOP_URL: "http://127.0.0.1:3000" });
    try {
      const opened = await answerOf(await post(api, JSON.stringify({ request: "cover the profile" })));
      const session = opened.body as Session;
      assert.deepEqual([opened.status, session.state], [201, "running"]);
      const [, given] = readFileSync(repository.journalPath(session.id), "utf8").split("\n");
      const names = (JSON.parse(String(given)) as { message: string }).message.slice("environment: ".length).split(",");
      for (const name of ["OQAS_HOST", "OQAS_PORT", "OQAS_SOLO_COMMAND", "OQAS_SOLO_REPOSITORY", "SHOP_URL"]) assert.ok(names.includes(name), name);
      assert.ok(!names.includes("OQAS_DATABASE_URL"), names.join(","));
    } finally {
      await api.close();
    }
  });
});
