import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
import { afterEach, describe, it } from "vitest";
import type { Session, SessionEvent } from "@open-qa-stack/domain/sessions";
import { Interruptions } from "../src/solo/interruptions.ts";
import { chain, sessionOf, Terminal, type Ran } from "./support/terminal.ts";

const BRIEF = ["--environment", "local", "--brief", "Test the listing of the orders."];

/** A session whose run the configuration stops at once. */
const STOPPED_AT_ONCE = ["--environment", "nowhere", "--brief", "Test the returns."];

/** The JSON Lines a command printed, read. */
const lines = <Line>(ran: Ran): Line[] =>
  ran.out
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Line);

let terminal: Terminal;
afterEach(() => terminal.close());

/** Opens a session in the terminal, which a test holds before its design, and gives its identifier with its end. */
async function held(): Promise<{ id: string; ended: Promise<Ran>; open: () => void; interrupt: () => void }> {
  const door = terminal.designDoor();
  let named: (id: string) => void = () => undefined;
  const id = new Promise<string>((resolve) => (named = resolve));
  let interrupt = (): void => undefined;
  const ended = terminal.oqas(BRIEF, {
    heard: (text) => {
      if (text.startsWith("Session ")) named(sessionOf(text));
    },
    io: {
      onInterrupt: (listener) => {
        interrupt = listener;
        return () => (interrupt = () => assert.fail("the command no longer listens"));
      },
    },
  });
  await door.reached;
  return { id: await id, ended, open: door.open, interrupt: () => interrupt() };
}

describe("oqas sessions", () => {
  it("lists the sessions of the test repository, the latest first, as lines or as JSON Lines, and nothing when there is none", async () => {
    terminal = await Terminal.open(chain());
    assert.deepEqual(await terminal.oqas(["sessions"]), { code: 0, out: "", err: "" });
    const first = sessionOf((await terminal.oqas(BRIEF)).err);
    const second = sessionOf((await terminal.oqas(STOPPED_AT_ONCE)).err);
    const listed = await terminal.oqas(["sessions"]);
    assert.equal(listed.code, 0);
    const [latest, earliest] = listed.out.split("\n");
    assert.match(String(latest), new RegExp(`^${second}  interrupted  \\S+Z  Test the returns\\.$`));
    assert.match(String(earliest), new RegExp(`^${first}  completed, passed  \\S+Z  Test the listing of the orders\\.$`));
    const sessions = lines<Session>(await terminal.oqas(["sessions", "--output", "json"]));
    assert.deepEqual(
      sessions.map(({ id, state, request, environment, result }) => [id, state, request, environment, result?.outcome]),
      [
        [second, "interrupted", "Test the returns.", "nowhere", undefined],
        [first, "completed", "Test the listing of the orders.", "local", "passed"],
      ],
    );
  });
});

describe("oqas show", () => {
  it("prints a session named by the end of its identifier and its thread so far, with what the agents did when asked, or its thread as JSON Lines", async () => {
    terminal = await Terminal.open(chain());
    const run = await terminal.oqas(BRIEF);
    const id = sessionOf(run.err);
    const shown = await terminal.oqas(["show", id.slice(-8)]);
    assert.deepEqual([shown.code, shown.err], [0, ""]);
    // What the command that ran the session wrote, on one output: what it came to, then its thread.
    assert.equal(shown.out, run.out + run.err.slice(run.err.indexOf("\n") + 1));
    const followed = await terminal.oqas(["show", id, "--follow"]);
    assert.match(followed.out, /^\d\d:\d\d:\d\d planner -> propose_plan\(/m);
    const events = lines<SessionEvent>(await terminal.oqas(["show", id, "--output", "json"]));
    assert.deepEqual(
      events.map((event) => event.id),
      events.map((_, index) => index + 1),
    );
    assert.deepEqual(events.at(-1)?.type, "state_changed");
    assert.ok(events.some((event) => event.type === "action_finished"));
  });
});

describe("oqas attach", () => {
  it("follows a session that ended as the command that opened it did, and exits with the code of its run", async () => {
    terminal = await Terminal.open(chain());
    const run = await terminal.oqas(BRIEF);
    const stopped = await terminal.oqas(STOPPED_AT_ONCE);
    for (const opened of [run, stopped]) {
      const attached = await terminal.oqas(["attach", sessionOf(opened.err)]);
      assert.deepEqual(attached, { code: opened.code, out: opened.out, err: opened.err.slice(opened.err.indexOf("\n") + 1) });
    }
    assert.deepEqual([run.code, stopped.code], [0, 3]);
  });

  it("follows a session another command runs to its end, as JSON Lines when asked", async () => {
    terminal = await Terminal.open(chain());
    const running = await held();
    const attached = terminal.oqas(["attach", running.id, "--output", "json"]);
    running.open();
    const [opened, followed] = await Promise.all([running.ended, attached]);
    assert.deepEqual([opened.code, followed.code, followed.err], [0, 0, ""]);
    assert.deepEqual(lines<SessionEvent>(followed), await terminal.thread(running.id));
  });
});

describe("oqas say", () => {
  it("says something to a session another command runs: the store numbers it, and the agent at work receives it", async () => {
    terminal = await Terminal.open(chain());
    const running = await held();
    assert.deepEqual(await terminal.oqas(["say", running.id, "Only what a customer sees."]), {
      code: 0,
      out: `Message 1 is taken by the session ${running.id}.\n`,
      err: "",
    });
    assert.deepEqual(await terminal.oqas(["say", running.id, "And the returns.", "--output", "json"]), { code: 0, out: '{"number":2}\n', err: "" });
    // The command that runs the session reads what it was sent at its next beat.
    await terminal.met(running.id);
    running.open();
    assert.equal((await running.ended).code, 0);
    const thread = await terminal.thread(running.id);
    assert.deepEqual(
      thread.flatMap((event) => (event.type === "user_message" && event.number !== undefined ? [[event.number, event.text]] : [])),
      [
        [1, "Only what a customer sees."],
        [2, "And the returns."],
      ],
    );
    assert.deepEqual(
      thread.flatMap((event) => (event.type === "message_delivered" ? [event.message] : [])),
      [1, 2],
    );
    assert.ok(
      terminal.server.requests.some((request) => (JSON.stringify(request.body) ?? "").includes('<person-message number=\\"1\\">Only what a customer sees.')),
    );
  });

  it("resumes a session that ended with what it says, runs its new turn in this command, prints its thread from the message on, and exits with its code", async () => {
    terminal = await Terminal.open([]);
    const id = sessionOf((await terminal.oqas(STOPPED_AT_ONCE)).err);
    const before = (await terminal.thread(id)).length;
    const resumed = await terminal.oqas(["say", id, "Go on.", "--output", "json"]);
    assert.deepEqual([resumed.code, resumed.err], [3, `Session ${id}\n`]);
    const told = lines<SessionEvent>(resumed);
    assert.deepEqual(told, (await terminal.thread(id)).slice(before));
    assert.deepEqual(
      told.slice(0, 3).map((event) => (event.type === "user_message" ? event.text : event.type === "state_changed" ? event.state : event.type)),
      ["Go on.", "queued", "running"],
    );
    const text = await terminal.oqas(["say", id.slice(-8), "Once more."]);
    assert.equal(text.code, 3);
    assert.match(text.out, new RegExp(`^Session ${id}: interrupted`));
    assert.match(text.err, /Once more\./);
    assert.doesNotMatch(text.err, /Go on\./, "the thread of the turns before is not printed again");
  });

  it("is refused with 3 by a name no session bears, and by one several share; stop is refused by a session that ended", async () => {
    terminal = await Terminal.open([]);
    const first = sessionOf((await terminal.oqas(STOPPED_AT_ONCE)).err);
    const second = sessionOf((await terminal.oqas(STOPPED_AT_ONCE)).err);
    assert.deepEqual(await terminal.oqas(["say", "session-0000", "Go on."]), { code: 3, out: "", err: "No session session-0000; oqas sessions lists them.\n" });
    assert.deepEqual(await terminal.oqas(["stop", first]), { code: 3, out: "", err: `The session ${first} no longer goes on.\n` });
    assert.deepEqual(await terminal.oqas(["show", "session-0000"]), { code: 3, out: "", err: "No session session-0000; oqas sessions lists them.\n" });
    assert.deepEqual(await terminal.oqas(["attach", "session-"]), {
      code: 3,
      out: "",
      err: `session- names 2 sessions: ${second}, ${first}. Give more of the identifier.\n`,
    });
  });
});

describe("oqas stop", () => {
  it("asks a session another command runs to stop: that command interrupts it, soon, and exits with 5", async () => {
    terminal = await Terminal.open(chain());
    const running = await held();
    assert.deepEqual(await terminal.oqas(["stop", running.id]), {
      code: 0,
      out: `The session ${running.id} is asked to stop: the process that runs it interrupts it.\n`,
      err: "",
    });
    await terminal.met(running.id);
    running.open();
    const opened = await running.ended;
    assert.equal(opened.code, 5);
    assert.equal(opened.out, `Session ${running.id}: interrupted.\n`);
    assert.ok(terminal.server.requests.length < chain().length, "the run stopped instead of going to its end");
  });

  it("interrupts at once a session no process runs any more, and gives it as JSON when asked", async () => {
    terminal = await Terminal.open(chain());
    const running = await held();
    // The person leaves the command that runs the session without waiting for it: Ctrl-C, twice.
    running.interrupt();
    running.interrupt();
    const left = await running.ended;
    assert.equal(left.code, 5);
    assert.match(left.err, /^The session is asked to stop, and ends soon\. Ctrl-C again leaves at once, without waiting for it\.$/m);
    assert.equal(left.out, "");
    const stopped = lines<Session>(await terminal.oqas(["stop", running.id, "--output", "json"]));
    assert.deepEqual(
      stopped.map(({ id, state }) => [id, state]),
      [[running.id, "interrupted"]],
    );
    running.open();
    const again = await held();
    again.interrupt();
    again.interrupt();
    await again.ended;
    assert.deepEqual(await terminal.oqas(["stop", again.id]), { code: 0, out: `The session ${again.id} is interrupted.\n`, err: "" });
    again.open();
  });
});

describe("Ctrl-C in the terminal of oqas --brief", () => {
  it("asks the session to stop, once: the command follows it to its end, which comes soon, and exits with 5", async () => {
    terminal = await Terminal.open(chain());
    const running = await held();
    running.interrupt();
    running.open();
    const opened = await running.ended;
    assert.equal(opened.code, 5);
    assert.match(opened.err, /^\d\d:\d\d:\d\d session interrupted$/m);
    assert.equal(opened.out, `Session ${running.id}: interrupted.\n`);
    assert.throws(() => running.interrupt(), /the command no longer listens/);
  });

  it("tells the person when the session could not be asked to stop, and listens to no one when it was given no terminal to listen to", async () => {
    let err = "";
    const stderr = { write: (text: string) => (err += text) };
    let press = (): void => undefined;
    const wording = { asked: "The session is asked to stop, and ends soon.", failed: "The session was not asked to stop" };
    const interruptions = new Interruptions(
      { stderr, onInterrupt: (listener) => ((press = listener), () => undefined) },
      () => Promise.reject(new Error("The session s1 no longer goes on.")),
      wording,
    );
    press();
    await pause(0);
    assert.match(err, /\nThe session was not asked to stop: The session s1 no longer goes on\.\n$/);
    interruptions.end();
    new Interruptions({ stderr }, () => assert.fail("nobody asks"), wording).end();
  });
});
