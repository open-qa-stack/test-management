import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { CONFIG_FILE_NAME, SessionEndedError, SessionStateError, UnknownSessionError } from "@open-qa-stack/domain";
import type { SessionEvent, SessionOpening } from "@open-qa-stack/domain/sessions";
import { chain, ended, git, planned, read } from "@open-qa-stack/testing/test-repository";
import { afterEach, describe, it } from "vitest";
import { KeptMemories } from "@open-qa-stack/testing";
import { Configuration, NoRepositoryError, Sessions } from "../src/index.ts";
import { eventually } from "./support/eventually.ts";
import { designDoor, ENV, Hosted } from "./support/hosted.ts";
import { MemoryConfigurationStore } from "./support/memory-configuration-store.ts";
import { MemoryDocumentStore } from "./support/memory-document-store.ts";
import { MemoryExecutionStore } from "./support/memory-execution-store.ts";
import { MemorySessionStore } from "./support/memory-session-store.ts";
import { RecordingLogger } from "./support/recording-logger.ts";
import { comparable, toldByTheEngine } from "./support/told-by-the-engine.ts";

const REQUEST = "Test the listing of the orders.";

/** How many replies of the scripted chain a first run in a test repository asks the model for. */
const FIRST_RUN_REPLIES = 18;

/**
 * The replies of a second run in the same test repository: the cards and the index are up to date, so the
 * model is only checked, then asked for a plan, whose scenarios the tests of the first run already cover.
 */
const secondRun = () => [{ body: { data: [] } }, read(), planned, ended, ended];

/** A session whose run the configuration stops at once: it names an environment the test repository does not declare. */
const STOPPED_AT_ONCE = { request: REQUEST, environment: "nowhere" };

/** What names a process that hosted sessions on the store of a test, and stopped. */
const GONE = "host-gone";

/** What an event says, as its type then what tells it from the others of its type. */
const said = (event: SessionEvent): unknown[] => [event.type, "text" in event ? event.text : "state" in event ? event.state : "phase" in event && event.phase];

let hosted: Hosted;
afterEach(() => hosted.close());

describe("a session that is opened", () => {
  it("runs at once when no other does, and ends completed with its result and the events the engine tells every host", async () => {
    hosted = await Hosted.create(chain());
    await hosted.sessions.start();
    assert.deepEqual(await hosted.sessions.project(), { name: basename(hosted.root), applications: [{ id: "shop", name: "Shop" }] });
    const opened = await hosted.sessions.open({ request: REQUEST, environment: "local" });
    assert.equal(opened.state, "running");
    assert.deepEqual(await hosted.sessions.session(opened.id), opened);
    const session = await hosted.ended(opened.id);
    assert.equal(session.state, "completed");
    const { result } = session;
    assert.ok(result !== undefined);
    assert.equal(result.outcome, "passed");
    assert.match(String(result.branch), /^oqas\/design-/);
    assert.deepEqual(
      result.tests.map(({ verdict }) => verdict),
      ["passed", "passed", "passed"],
    );
    assert.ok(result.modelRequests > 0 && result.durationMs > 0, JSON.stringify(result));

    const events = await hosted.events(opened.id);
    assert.deepEqual(
      events.map((event) => event.id),
      events.map((_, index) => index + 1),
    );
    assert.deepEqual(events[0], { id: 1, at: opened.openedAt, type: "user_message", text: REQUEST });
    assert.deepEqual(
      [said(events[1] as SessionEvent), said(events.at(-1) as SessionEvent)],
      [
        ["state_changed", "running"],
        ["state_changed", "completed"],
      ],
    );
    const told = await toldByTheEngine(chain(), REQUEST);
    assert.deepEqual(
      events.slice(2, -1).map((event) => comparable(event, hosted.root)),
      told.events.filter((event) => event.type !== "user_message").map((event) => comparable(event, told.root)),
    );
    assert.equal(events.filter((event) => event.type === "user_message").length, 1, "what the person asked is told once, by the store");
    await eventually(() => assert.deepEqual(hosted.logger.lines, [`log The session ${opened.id} starts.`, `log The session ${opened.id} is over.`]));
    assert.deepEqual(await hosted.sessions.sessions(), [session]);
  });

  it("waits while another runs, starts when that one ended, and is given then what the person said while it waited", async () => {
    hosted = await Hosted.create([...chain().slice(0, FIRST_RUN_REPLIES), ...secondRun()]);
    const first = await hosted.sessions.open({ request: REQUEST, environment: "local" });
    const second = await hosted.sessions.open({ request: "Test the orders again.", environment: "local" });
    assert.deepEqual([first.state, second.state], ["running", "queued"]);
    assert.deepEqual(await hosted.sessions.say(second.id, { text: "The orders are the only domain." }), { number: 1 });
    const [firstEnded, secondEnded] = [await hosted.ended(first.id), await hosted.ended(second.id)];
    assert.deepEqual([firstEnded.state, firstEnded.result?.outcome], ["completed", "passed"]);
    // The tests the first session wrote already cover what the second one plans: it writes none, and ends without a verdict.
    assert.deepEqual([secondEnded.state, secondEnded.result?.tests], ["completed", []]);
    const events = await hosted.events(second.id);
    const started = events.find((event) => event.type === "state_changed");
    assert.ok(started !== undefined && started.at >= firstEnded.lastEventAt, "one session at a time");
    assert.deepEqual(
      events.flatMap((event) => (event.type === "message_delivered" ? [[event.message, event.agent]] : [])),
      [[1, "planner"]],
    );
    assert.deepEqual(await hosted.store.pendingMessages(second.id), []);
    await eventually(() =>
      assert.deepEqual(hosted.logger.lines, [
        `log The session ${first.id} starts.`,
        `log The session ${first.id} is over.`,
        `log The session ${second.id} starts.`,
        `log The session ${second.id} is over.`,
      ]),
    );
  });

  it("is interrupted, and tells why, when its run stops before it has a result: the entries of a run the configuration stopped are told as they were written", async () => {
    hosted = await Hosted.create([]);
    const opened = await hosted.sessions.open(STOPPED_AT_ONCE);
    const session = await hosted.ended(opened.id);
    assert.deepEqual([session.state, session.result], ["interrupted", undefined]);
    assert.deepEqual((await hosted.events(opened.id)).map(said), [
      ["user_message", REQUEST],
      ["state_changed", "running"],
      ["phase_started", "configuration"],
      ["refusal", "The environment nowhere is not declared; the configuration declares local, staging."],
      ["state_changed", "interrupted"],
    ]);
  });

  it("keeps its run to its scope, and is interrupted with why when the scope names what the configuration does not declare", async () => {
    hosted = await Hosted.create([]);
    const opened = await hosted.sessions.open({ request: REQUEST, environment: "local", scope: { applications: ["billing"], levels: ["end-to-end"] } });
    assert.deepEqual(opened.scope, { applications: ["billing"], levels: ["end-to-end"] });
    const session = await hosted.ended(opened.id);
    assert.equal(session.state, "interrupted");
    assert.deepEqual((await hosted.events(opened.id)).filter((event) => event.type === "refusal").map(said), [
      ["refusal", "The application billing is not declared: the configuration declares shop."],
      ["refusal", "The level end-to-end is not asked for: the configuration asks for functional."],
    ]);
  });

  it("gives the domains of its scope to the design, which designs nothing for a domain the knowledge does not have", async () => {
    hosted = await Hosted.create(chain());
    const opened = await hosted.sessions.open({ request: REQUEST, environment: "local", scope: { domains: ["billing"] } });
    await hosted.ended(opened.id);
    const events = await hosted.events(opened.id);
    assert.deepEqual(
      events.flatMap((event) => (event.type === "scope_resolved" ? [event.domains] : [])),
      [["billing"]],
      "the thread tells the domains of the scope",
    );
    assert.match(JSON.stringify(events), /No test was designed: the knowledge has no domain billing; its domains are orders\./);
  });

  it("runs with what the machine gives when its host gives no more than a store and a test repository, whatever it leaves unsaid", async () => {
    hosted = await Hosted.create([]);
    const store = new MemorySessionStore();
    // A session the store holds without a request nor an environment, asked by a process that stopped since.
    const unsaid = await store.ask({} as SessionOpening, GONE);
    await store.release(GONE);
    const sessions = new Sessions({
      memory: new KeptMemories(),
      store,
      configuration: new Configuration(new MemoryConfigurationStore(), hosted.root),
      documents: new MemoryDocumentStore(),
      executions: new MemoryExecutionStore(),
      repository: hosted.root,
      takesOver: true,
      env: ENV,
      logger: new RecordingLogger(),
    });
    await sessions.start();
    await eventually(async () => assert.equal((await sessions.session(unsaid.id)).state, "interrupted"));
    assert.deepEqual((await store.eventsAfter(unsaid.id, 2)).map(said), [
      ["state_changed", "running"],
      ["phase_started", "configuration"],
      ["refusal", "Several environments are declared (local, staging); name one with --environment."],
      ["state_changed", "interrupted"],
    ]);
    assert.equal(await sessions.stop(10_000), true);
  });

  it("is refused by a host that has no test repository, which serves what its store keeps", async () => {
    const store = new MemorySessionStore();
    const kept = await store.ask({ request: REQUEST }, GONE);
    await store.release(GONE);
    hosted = await Hosted.create([]);
    const reading = new Sessions({
      memory: new KeptMemories(),
      store,
      configuration: new Configuration(new MemoryConfigurationStore(), undefined),
      documents: new MemoryDocumentStore(),
      executions: new MemoryExecutionStore(),
      repository: undefined,
      takesOver: true,
      env: ENV,
      logger: new RecordingLogger(),
    });
    await reading.start();
    await assert.rejects(
      reading.open({ request: REQUEST }),
      (error) => error instanceof NoRepositoryError && /was given no test repository/.test(error.message),
    );
    await assert.rejects(reading.remap(), NoRepositoryError, "no knowledge is mapped again without a test repository");
    assert.deepEqual(await reading.project(), { applications: [] });
    assert.deepEqual(await reading.sessions(), [kept], "a session that waits is left to a host that can run it");
    assert.equal(await reading.stop(10), true);
  });
});

describe("a message a person says to a session", () => {
  it("is written to the store, then reaches the agent at work once, and stands for the agents that follow", async () => {
    const door = designDoor();
    hosted = await Hosted.create(chain(), { before: door.hold });
    const opened = await hosted.sessions.open({ request: REQUEST, environment: "local" });
    await door.reached;
    assert.deepEqual(await hosted.sessions.say(opened.id, { text: "Only what a customer sees." }), { number: 1 });
    door.open();
    assert.equal((await hosted.ended(opened.id)).state, "completed");
    const events = await hosted.events(opened.id);
    assert.deepEqual(
      events.flatMap((event) => (event.type === "user_message" ? [[event.number, event.text]] : [])),
      [
        [undefined, REQUEST],
        [1, "Only what a customer sees."],
      ],
    );
    assert.deepEqual(
      events.flatMap((event) => (event.type === "message_delivered" ? [[event.message, event.agent]] : [])),
      [[1, "planner"]],
    );
    assert.equal(
      hosted.store.answered.get("pendingMessages"),
      1,
      "the message went from the registry to the inbox: the store was read once, when the execution started",
    );
    assert.deepEqual(await hosted.store.pendingMessages(opened.id), []);
    const recalled = hosted.server.requests.filter((request) =>
      (JSON.stringify(request.body) ?? "").includes(
        'said this earlier in the run, and it still holds:\\n<person-message number=\\"1\\">Only what a customer sees.',
      ),
    );
    assert.ok(recalled.length >= 3, `the session of each scenario is recalled the message: ${recalled.length}`);
  });

  it("is refused by a session that ended, and by one that does not exist", async () => {
    hosted = await Hosted.create([]);
    const opened = await hosted.sessions.open(STOPPED_AT_ONCE);
    await hosted.ended(opened.id);
    await assert.rejects(hosted.sessions.say(opened.id, { text: "Too late." }), (error) => error instanceof SessionEndedError);
    await assert.rejects(hosted.sessions.say("unknown", { text: "To no one." }), (error) => error instanceof UnknownSessionError);
    await assert.rejects(hosted.sessions.session("unknown"), (error) => error instanceof UnknownSessionError);
    await assert.rejects(hosted.sessions.events("unknown", 0), (error) => error instanceof UnknownSessionError);
  });
});

describe("a session a person resumes once it ended", () => {
  it("runs a new turn on what the person says, told what the turn before did, on the branch of its tests, and ends with the result of that turn", async () => {
    hosted = await Hosted.create([...chain().slice(0, FIRST_RUN_REPLIES), ...secondRun()]);
    const opened = await hosted.sessions.open({ request: REQUEST, environment: "local" });
    const first = await hosted.ended(opened.id);
    const branch = first.result?.branch;
    assert.match(String(branch), /^oqas\/design-/);
    const before = (await hosted.events(opened.id)).length;
    const resumed = await hosted.sessions.resume(opened.id, { text: "Add a scenario for the export." });
    assert.deepEqual([resumed.state, resumed.result], ["running", undefined]);
    const second = await hosted.ended(opened.id);
    // The tests of the first turn already cover what the second one plans: it writes none, and its result names the branch it went on with.
    assert.deepEqual([second.state, second.result?.tests, second.result?.branch], ["completed", [], branch]);
    assert.deepEqual(
      git(hosted.root, "branch", "--format=%(refname:short)")
        .split("\n")
        .filter((name) => name.startsWith("oqas/")),
      [branch],
    );
    const events = await hosted.events(opened.id);
    assert.deepEqual(events.slice(before, before + 3).map(said), [
      ["user_message", "Add a scenario for the export."],
      ["state_changed", "queued"],
      ["state_changed", "running"],
    ]);
    assert.equal(events.filter((event) => event.type === "user_message").length, 2, "what is asked of a turn is told once, by the store");
    const asked = hosted.server.requests.filter((request) =>
      (JSON.stringify(request.body) ?? "").includes("What the person asks of this turn:\\nAdd a scenario for the export."),
    );
    assert.ok(asked.length > 0, "the planner of the turn is asked what the person says now");
    assert.match(JSON.stringify(asked[0]!.body), /What the session was asked first:\\nTest the listing of the orders\.[^"]*passed/);
    await eventually(() => assert.equal(hosted.logger.lines.filter((line) => line === `log The session ${opened.id} is over.`).length, 2));
  });

  it("waits its turn behind a session that runs, and is refused by one that goes on, by one that does not exist, and by a host without a test repository", async () => {
    const door = designDoor();
    hosted = await Hosted.create(chain(), { before: door.hold });
    const stopped = await hosted.sessions.open(STOPPED_AT_ONCE);
    await hosted.ended(stopped.id);
    const running = await hosted.sessions.open({ request: REQUEST, environment: "local" });
    await door.reached;
    await assert.rejects(hosted.sessions.resume(running.id, { text: "More." }), (error) => error instanceof SessionStateError);
    await assert.rejects(hosted.sessions.resume("unknown", { text: "Go on." }), (error) => error instanceof UnknownSessionError);
    assert.equal((await hosted.sessions.resume(stopped.id, { text: "Go on." })).state, "queued");
    door.open();
    await hosted.ended(running.id);
    const again = await hosted.ended(stopped.id);
    assert.equal(again.state, "interrupted");
    assert.ok(
      (await hosted.events(stopped.id)).findLast((event) => event.type === "state_changed" && event.state === "running")!.at >=
        (await hosted.store.session(running.id))!.lastEventAt,
      "one turn at a time",
    );

    const store = new MemorySessionStore();
    const kept = await store.ask({ request: REQUEST }, GONE);
    await store.interrupt(kept.id);
    const reading = new Sessions({
      memory: new KeptMemories(),
      store,
      configuration: new Configuration(new MemoryConfigurationStore(), undefined),
      documents: new MemoryDocumentStore(),
      executions: new MemoryExecutionStore(),
      repository: undefined,
      takesOver: true,
      env: ENV,
      logger: new RecordingLogger(),
    });
    await assert.rejects(reading.resume(kept.id, { text: "Go on." }), (error) => error instanceof NoRepositoryError);
    assert.equal(await reading.stop(10), true);
  });
});

describe("a session that is interrupted", () => {
  it("ends interrupted soon when it runs: its agents refuse to go on in the middle of a call to the model, and the next session starts", async () => {
    // The first call of the cartography is answered after a time no test waits for.
    const replies = chain().map((reply, index) => (index === 1 ? { ...reply, delayMs: 60_000 } : reply));
    hosted = await Hosted.create(replies);
    const opened = await hosted.sessions.open({ request: REQUEST, environment: "local" });
    const next = await hosted.sessions.open(STOPPED_AT_ONCE);
    await eventually(() => assert.equal(hosted.server.requests.length, 2));
    const asked = Date.now();
    await hosted.sessions.interrupt(opened.id);
    const session = await hosted.ended(opened.id);
    assert.ok(Date.now() - asked < 10_000, `the session ended ${Date.now() - asked} ms after it was interrupted`);
    assert.deepEqual([session.state, session.result], ["interrupted", undefined]);
    const events = await hosted.events(opened.id);
    assert.deepEqual(events.at(-1), { id: events.length, at: session.lastEventAt, type: "state_changed", state: "interrupted" });
    assert.ok(
      events.some((event) => event.type === "refusal" && event.text === "The cartography stopped: the run was asked to stop."),
      JSON.stringify(events.map(said)),
    );
    assert.equal((await hosted.ended(next.id)).state, "interrupted");
    assert.ok(
      (await hosted.events(next.id)).some((event) => event.type === "phase_started"),
      "the session that waited ran in its turn",
    );
  });

  it("is interrupted at once when it waits, and never starts", async () => {
    const door = designDoor();
    hosted = await Hosted.create(chain(), { before: door.hold });
    const running = await hosted.sessions.open({ request: REQUEST, environment: "local" });
    const waiting = await hosted.sessions.open(STOPPED_AT_ONCE);
    const last = await hosted.sessions.open(STOPPED_AT_ONCE);
    await door.reached;
    await hosted.sessions.interrupt(waiting.id);
    assert.deepEqual((await hosted.events(waiting.id)).map(said), [
      ["user_message", REQUEST],
      ["state_changed", "interrupted"],
    ]);
    await assert.rejects(hosted.sessions.interrupt(waiting.id), (error) => error instanceof SessionEndedError);
    await assert.rejects(hosted.sessions.interrupt("unknown"), (error) => error instanceof UnknownSessionError);
    door.open();
    assert.equal((await hosted.ended(running.id)).state, "completed");
    await hosted.ended(last.id);
    assert.equal((await hosted.events(waiting.id)).length, 2, "the session interrupted while it waited was never started");
    assert.ok(!hosted.logger.lines.includes(`log The session ${waiting.id} starts.`));
  });
});

describe("a failure around the run of a session", () => {
  it("leaves the session interrupted with a refusal that says why, and the next session runs", async () => {
    hosted = await Hosted.create([]);
    let failed = false;
    hosted.store.before = (command) => {
      if (command !== "pendingMessages" || failed) return;
      failed = true;
      throw new Error("The store lost its messages.");
    };
    const first = await hosted.sessions.open(STOPPED_AT_ONCE);
    const second = await hosted.sessions.open(STOPPED_AT_ONCE);
    assert.equal((await hosted.ended(first.id)).state, "interrupted");
    assert.deepEqual((await hosted.events(first.id)).map(said), [
      ["user_message", REQUEST],
      ["state_changed", "running"],
      ["refusal", "The session stopped on a failure, and is interrupted: The store lost its messages."],
      ["state_changed", "interrupted"],
    ]);
    assert.equal((await hosted.ended(second.id)).state, "interrupted");
    assert.ok(
      (await hosted.events(second.id)).some((event) => event.type === "phase_started"),
      "the next session ran",
    );
    assert.ok(hosted.logger.lines.includes(`warn The session ${first.id} stopped on a failure: The store lost its messages.`));
  });

  it("is told as it was raised when it is no error", async () => {
    hosted = await Hosted.create([]);
    hosted.store.before = (command) => {
      if (command === "pendingMessages") throw "no messages";
    };
    const opened = await hosted.sessions.open(STOPPED_AT_ONCE);
    await hosted.ended(opened.id);
    assert.deepEqual((await hosted.events(opened.id)).map(said).at(-2), ["refusal", "The session stopped on a failure, and is interrupted: no messages"]);
  });

  it("is reported when the store refuses to start a session, which is passed over for the next", async () => {
    const door = designDoor();
    hosted = await Hosted.create(chain(), { before: door.hold });
    const running = await hosted.sessions.open({ request: REQUEST, environment: "local" });
    const refused = await hosted.sessions.open(STOPPED_AT_ONCE);
    const next = await hosted.sessions.open(STOPPED_AT_ONCE);
    hosted.store.before = (command, id) => {
      if (command === "start" && id === refused.id) throw new Error("The database is unreachable.");
    };
    await door.reached;
    door.open();
    assert.equal((await hosted.ended(running.id)).state, "completed");
    assert.equal((await hosted.ended(next.id)).state, "interrupted");
    assert.equal((await hosted.sessions.session(refused.id)).state, "queued", "the session stays as the store keeps it");
    assert.ok(hosted.logger.lines.includes(`warn The session ${refused.id} does not start: The database is unreachable.`));
  });

  it("stops the run of a session the store ended under it: the run has no one left to tell", async () => {
    const door = designDoor();
    hosted = await Hosted.create(chain(), { before: door.hold });
    const opened = await hosted.sessions.open({ request: REQUEST, environment: "local" });
    const next = await hosted.sessions.open(STOPPED_AT_ONCE);
    await door.reached;
    // Another process on the same store, which allows a host no silence at all, takes the session for one that was left.
    await pause(2);
    assert.deepEqual(await hosted.store.abandonSilent(1), [opened.id]);
    const events = await hosted.events(opened.id);
    door.open();
    await hosted.ended(next.id);
    assert.deepEqual(await hosted.events(opened.id), events, "nothing more is written to the session");
    assert.ok(
      hosted.logger.lines.some((line) => line.startsWith(`warn The session ${opened.id} takes nothing more, and what its run still tells is dropped: `)),
    );
    assert.ok(hosted.server.requests.length < FIRST_RUN_REPLIES, "the run stopped instead of going to its end");
  });
});

describe("a host that starts", () => {
  it("interrupts the sessions a process that stopped left running, then runs those that waited, in the order they were asked for", async () => {
    hosted = await Hosted.create([]);
    const left = await hosted.store.ask({ request: "left running" }, GONE);
    await hosted.store.start(left.id, GONE);
    const first = await hosted.store.ask(STOPPED_AT_ONCE, GONE);
    const second = await hosted.store.ask(STOPPED_AT_ONCE, GONE);
    await hosted.store.release(GONE);
    await hosted.sessions.start();
    await hosted.sessions.start();
    assert.equal(hosted.store.answered.get("abandonSilent"), 1, "the startup is done once");
    assert.equal((await hosted.sessions.session(left.id)).state, "interrupted");
    assert.deepEqual((await hosted.events(left.id)).map(said).at(-1), ["state_changed", "interrupted"]);
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

  it("starts again when its store did not answer the first time: opening a session does it", async () => {
    hosted = await Hosted.create([]);
    for (const request of ["left running", "left running too"]) await hosted.store.start((await hosted.store.ask({ request }, GONE)).id, GONE);
    await hosted.store.release(GONE);
    let down = true;
    hosted.store.before = (command) => {
      if (command === "abandonSilent" && down) throw new Error("The database is unreachable.");
    };
    await assert.rejects(hosted.sessions.start(), { message: "The database is unreachable." });
    await assert.rejects(hosted.sessions.open(STOPPED_AT_ONCE), { message: "The database is unreachable." });
    assert.equal((await hosted.sessions.sessions()).length, 2, "a session that cannot be put in order is not asked for");
    down = false;
    const opened = await hosted.sessions.open(STOPPED_AT_ONCE);
    assert.equal((await hosted.ended(opened.id)).state, "interrupted");
    assert.equal(hosted.logger.lines[0], "warn 2 sessions were left running by a process that stopped, and interrupted.");
  });
});

describe("the configuration of a host that starts", () => {
  it("is brought in step with the file of the test repository, whose applications name the project", async () => {
    hosted = await Hosted.create([]);
    await hosted.sessions.start();
    assert.deepEqual(
      (await hosted.configuration.revisions()).map(({ number, origin }) => `${number} ${origin}`),
      ["1 file"],
    );
    assert.deepEqual(await hosted.sessions.project(), { name: basename(hosted.root), applications: [{ id: "shop", name: "Shop" }] });
    // A change of the configuration names its applications in the project at once.
    const configuration = new Configuration(hosted.configuration, hosted.root);
    const { revision } = await configuration.view();
    await configuration.save({ ...revision!.document, applications: [{ ...revision!.document.applications[0]!, name: "Boutique" }] }, revision!.number);
    assert.deepEqual((await hosted.sessions.project()).applications, [{ id: "shop", name: "Boutique" }]);
  });

  it("keeps the revision in force to name the project when the file changed and is no valid configuration, and names none without one", async () => {
    hosted = await Hosted.create([]);
    await new Configuration(hosted.configuration, hosted.root).synchronise();
    writeFileSync(join(hosted.root, CONFIG_FILE_NAME), "{");
    await hosted.sessions.start();
    assert.deepEqual(hosted.logger.lines, []);
    assert.deepEqual((await hosted.sessions.project()).applications, [{ id: "shop", name: "Shop" }]);
    const bare = await Hosted.create([], { store: new MemorySessionStore() });
    try {
      writeFileSync(join(bare.root, CONFIG_FILE_NAME), "{");
      await bare.sessions.start();
      assert.deepEqual((await bare.sessions.project()).applications, []);
    } finally {
      await bare.close();
    }
  });

  it("stops the startup when the store of the configuration does not answer", async () => {
    hosted = await Hosted.create([]);
    hosted.configuration.before = () => Promise.reject(new Error("The database is unreachable."));
    await assert.rejects(hosted.sessions.start(), { message: "The database is unreachable." });
  });
});

describe("a host that stops", () => {
  it("asks the session that runs to stop, waits until it is told interrupted, and starts no other", async () => {
    const door = designDoor();
    hosted = await Hosted.create(chain(), { before: door.hold });
    const running = await hosted.sessions.open({ request: REQUEST, environment: "local" });
    const waiting = await hosted.sessions.open(STOPPED_AT_ONCE);
    await door.reached;
    const stopped = hosted.sessions.stop(10_000);
    door.open();
    assert.equal(await stopped, true);
    const session = await hosted.sessions.session(running.id);
    assert.deepEqual([session.state, session.result], ["interrupted", undefined]);
    assert.ok(
      (await hosted.events(running.id)).some((event) => event.type === "phase_started" && event.phase === "index"),
      "what the run told before it was stopped is written",
    );
    assert.equal((await hosted.sessions.session(waiting.id)).state, "queued");
    const later = await hosted.sessions.open(STOPPED_AT_ONCE);
    await pause(20);
    assert.equal((await hosted.sessions.session(later.id)).state, "queued", "a session asked of a host that stops waits for one that starts");
  });

  it("says so when the session that runs did not end in time, and leaves it to the host that starts next", async () => {
    const door = designDoor();
    hosted = await Hosted.create(chain(), { before: door.hold });
    const running = await hosted.sessions.open({ request: REQUEST, environment: "local" });
    await door.reached;
    assert.equal(await hosted.sessions.stop(20), false);
    assert.equal((await hosted.sessions.session(running.id)).state, "running");
    // The host closes its store without waiting: the run ends by itself, and what it still tells is given up.
    hosted.store.before = (command) => {
      if (command === "append" || command === "interrupt") throw new Error("The store is closed.");
    };
    door.open();
    const left = `warn The session ${running.id} is left as the store holds it: its host stops, and what its run still told is dropped.`;
    await eventually(() => assert.ok(hosted.logger.lines.includes(left)));
    await eventually(() => assert.ok(hosted.logger.lines.includes(`log The session ${running.id} is over.`)));
    assert.equal((await hosted.sessions.session(running.id)).state, "running");
  });

  it("has nothing to wait for when no session runs", async () => {
    hosted = await Hosted.create([]);
    assert.equal(await hosted.sessions.stop(10_000), true);
  });
});

describe("the events of a session, followed through the operations", () => {
  it("are those the store holds after the rank given, then each one the session gains, to its end", async () => {
    const door = designDoor();
    hosted = await Hosted.create(chain(), { before: door.hold });
    const opened = await hosted.sessions.open({ request: REQUEST, environment: "local" });
    await door.reached;
    const seen: SessionEvent[] = [];
    let ended = false;
    (await hosted.sessions.events(opened.id, 2)).subscribe({ event: (event) => seen.push(event), ended: () => (ended = true), failed: assert.fail });
    await eventually(() => assert.ok(seen.length > 0));
    assert.equal(seen[0]?.id, 3);
    await hosted.sessions.say(opened.id, { text: "Only what a customer sees." });
    await eventually(() => assert.equal(seen.at(-1)?.type, "user_message"));
    assert.equal(ended, false);
    door.open();
    const session = await hosted.ended(opened.id);
    await eventually(() => assert.equal(ended, true));
    assert.deepEqual(seen, (await hosted.events(opened.id)).slice(2));
    assert.deepEqual(seen.at(-1), { id: seen.length + 2, at: session.lastEventAt, type: "state_changed", state: "completed", result: session.result });
  });
});

describe("the execution of the tests of a session", () => {
  it("is kept once the session ran its tests, each test named by its file and its titles, with the version it ran at", async () => {
    hosted = await Hosted.create(chain());
    await hosted.sessions.start();
    const opened = await hosted.sessions.open({ request: REQUEST, environment: "local" });
    const session = await hosted.ended(opened.id);
    const [execution, ...others] = hosted.executions.all();
    assert.ok(execution !== undefined);
    assert.deepEqual(others, []);
    assert.deepEqual([execution.origin, execution.environment, execution.sessionId], ["design", "local", session.id]);
    assert.match(execution.report, /^\.oqas\/runs\/run-.+\/report\.json$/);
    assert.match(String(execution.commit), /^[0-9a-f]{40}$/);
    // The double of the runner names each file from the root of the test repository: what the digests are taken of is tested on the recorder.
    assert.deepEqual(
      execution.results.map(({ title, project, verdict }) => [title, project, verdict]),
      session.result?.tests.map(() => ["the test", "shop", "passed"]),
    );
  });

  it("refused by its store, is told to the session as a refusal, and leaves the session completed with its result", async () => {
    hosted = await Hosted.create(chain());
    hosted.executions.refusal = new Error("The database does not answer.");
    await hosted.sessions.start();
    const opened = await hosted.sessions.open({ request: REQUEST, environment: "local" });
    const session = await hosted.ended(opened.id);
    assert.deepEqual([session.state, session.result?.outcome], ["completed", "passed"]);
    assert.ok(
      (await hosted.events(opened.id)).some(
        (event) => event.type === "refusal" && event.text === "The execution of its tests could not be kept: The database does not answer.",
      ),
    );
    assert.deepEqual(hosted.executions.all(), []);
    assert.ok(
      hosted.logger.lines.some((line) => line.startsWith("warn The execution of the tests of the session")),
      JSON.stringify(hosted.logger.lines),
    );
  });

  it("refused by its store with what is no error, tells what it was refused with", async () => {
    hosted = await Hosted.create(chain());
    hosted.executions.refusal = "the disk is full";
    await hosted.sessions.start();
    const opened = await hosted.sessions.open({ request: REQUEST, environment: "local" });
    await hosted.ended(opened.id);
    assert.ok(
      (await hosted.events(opened.id)).some(
        (event) => event.type === "refusal" && event.text === "The execution of its tests could not be kept: the disk is full",
      ),
    );
  });
});
