import assert from "node:assert/strict";
import { cleanup, render } from "ink-testing-library";
import { createElement } from "react";
import { afterEach, describe, it } from "vitest";
import { SessionEndedError, UnknownSessionError } from "@open-qa-stack/domain";
import type { Model, ModelConnectionCheck, Session } from "@open-qa-stack/domain/sessions";
import { Conversation, type ConversationModel, type ConversationProps, type Leaving } from "../../src/solo/conversation/conversation.ts";
import { FakeSessions } from "./fake-sessions.ts";
import { COMPLETED, CONTEXT, FAILED, NOW, numbered, RUNNING, THREAD, completion } from "./fixtures.ts";
import { UNICODE, until } from "./screen.ts";

const ENTER = "\r";
const TAB = "\t";
const ESC = "\u001B";
const CTRL_C = "\u0003";
const UP = "\u001B[A";
const DOWN = "\u001B[B";

afterEach(() => cleanup());

/** A model served on the machine that answers and lists no model: it says nothing when the conversation opens. */
const QUIET_MODEL: ConversationModel = {
  inForce: () => Promise.resolve({ mode: "provider-key", provider: "openai", baseUrl: "http://localhost:1234/v1", model: "local" }),
  check: () => Promise.resolve({ state: "connected" }),
  save: () => Promise.resolve(),
};

/** A conversation on screen, and what a test does with it. */
interface Stage {
  readonly sessions: FakeSessions;
  /** The ports the web console was asked on. */
  readonly served: number[];
  /** How the person left, once they did. */
  readonly left: Leaving[];
  /** The screen as a person reads it. */
  readonly screen: () => string;
  /** Presses keys, then waits for a text to be on the screen. */
  readonly press: (keys: string, seen: string | RegExp) => Promise<void>;
  /** Waits for a text to be on the screen. */
  readonly sees: (seen: string | RegExp) => Promise<void>;
}

/**
 * Opens a conversation on operations that have nothing behind.
 *
 * @param held - The sessions the instance holds.
 * @param props - What the conversation is given besides.
 * @returns The stage.
 */
async function staged(held: readonly Session[] = [FAILED], props: Partial<ConversationProps> = {}): Promise<Stage> {
  const sessions = new FakeSessions(held);
  const served: number[] = [];
  const left: Leaving[] = [];
  const { lastFrame, stdin } = render(
    createElement(Conversation, {
      sessions,
      context: CONTEXT,
      latest: held,
      theme: UNICODE,
      now: () => NOW,
      serve: async (port) => {
        served.push(port);
        return "http://127.0.0.1:6727";
      },
      reasonOf: (error) => `Told: ${(error as Error).message}`,
      onLeave: (leaving) => left.push(leaving),
      model: QUIET_MODEL,
      ...props,
    }),
  );
  const screen = (): string => String(lastFrame());
  const sees = (seen: string | RegExp): Promise<void> =>
    until(() => (typeof seen === "string" ? screen().includes(seen) : seen.test(screen())), `${String(seen)}\n${screen()}`);
  const press = async (keys: string, seen: string | RegExp): Promise<void> => {
    // What opens over the input hears the keys once it is drawn: a key waits for the screen to settle.
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write(keys);
    await sees(seen);
  };
  await sees("What do we test?");
  return { sessions, served, left, screen, sees, press };
}

/** Opens a session from the start of a conversation, by typing what to test. */
async function opening(stage: Stage, session: Session = RUNNING): Promise<void> {
  stage.sessions.next = session;
  await stage.press("Test the search of a customer.", "› Test the search of a customer.");
  await stage.press(ENTER, `Session ${session.id}`);
  await until(() => stage.sessions.followed.has(session.id), "the session is followed");
}

describe("the conversation", () => {
  it("opens a session with what the person types, in the environment of the conversation, and follows its thread live", async () => {
    const stage = await staged();
    await opening(stage, { ...RUNNING, state: "queued" });
    assert.deepEqual(stage.sessions.openings, [{ request: "Test the search of a customer.", environment: "local" }]);
    await stage.sees("queued");
    stage.sessions.tell(RUNNING.id, numbered(THREAD));
    await stage.sees("⠋ Ran the test");
    assert.match(
      stage.screen(),
      /running · Writing a test · search · Writer · 0 s\n›  Say something to the agents\n {2}Enter send · \/ commands · Ctrl-C stop$/,
    );
    assert.match(stage.screen(), /◆ Planner\n {2}thinks: I should open the application first\./);
  });

  it("opens a session against the only environment declared when it was given none", async () => {
    const { environment: _none, ...context } = CONTEXT;
    const stage = await staged([], { context });
    assert.match(stage.screen(), /environment the only one declared · database SQLite/);
    await opening(stage);
    assert.deepEqual(stage.sessions.openings, [{ request: "Test the search of a customer." }]);
  });

  it("says what the person types to the agents of the session that goes on, shows it with its number, then the agent it was delivered to", async () => {
    const stage = await staged();
    await opening(stage);
    stage.sessions.tell(RUNNING.id, numbered(THREAD.slice(0, 16)));
    await stage.sees("Plan accepted by the harness");
    await stage.press("Leave the archived customers out.", "› Leave the archived customers out.");
    await stage.press(ENTER, "›  Say something to the agents");
    assert.deepEqual(stage.sessions.said, [[RUNNING.id, "Leave the archived customers out."]]);
    stage.sessions.tell(RUNNING.id, numbered(THREAD.slice(16, 17), 17));
    await stage.sees("› You · message 1\n  Leave the archived customers out.\n  waiting for an agent");
    stage.sessions.tell(RUNNING.id, numbered([{ type: "message_delivered", message: 1, agent: "writer" }], 18));
    await stage.sees("  Leave the archived customers out.\n  delivered to the writer");
  });

  it("closes the thread on what the session came to, goes on with it on what the person types next, and opens another after /new", async () => {
    const stage = await staged();
    await opening(stage);
    stage.sessions.tell(RUNNING.id, numbered([...THREAD, completion(COMPLETED)]));
    stage.sessions.end(COMPLETED);
    await stage.sees("Session completed · tests passed");
    await stage.sees("›  What do the agents do next?");
    assert.match(
      stage.screen(),
      /✓ passed {2}opens a customer\n\nSession completed · tests passed\n1 min 12 s · 17 model requests · 2 of 2 tests passed · branch oqas\/design-20261113T144405Z\n/,
    );
    assert.match(stage.screen(), /Enter go on · \/new another session · Ctrl-C quit/);
    await stage.press("Fix the failing test.", "› Fix the failing test.");
    await stage.press(ENTER, "›  Say something to the agents");
    assert.deepEqual(stage.sessions.resumed, [[RUNNING.id, "Fix the failing test."]]);
    await until(() => stage.sessions.after.length === 2, "the new turn is followed");
    assert.deepEqual(stage.sessions.after, [0, THREAD.length + 1], "the new turn is followed after the thread of the one before");
    const turn = numbered(
      [
        { type: "user_message", text: "Fix the failing test." },
        { type: "state_changed", state: "queued" },
        { type: "state_changed", state: "running" },
      ],
      THREAD.length + 2,
    );
    stage.sessions.tell(RUNNING.id, turn);
    await stage.sees(/› You\n {2}Fix the failing test\./);
    stage.sessions.end({ ...RUNNING, state: "interrupted" });
    await stage.sees("›  What do the agents do next?");
    const next: Session = { ...RUNNING, id: "session-2026-11-13T15-00-00-000Z-11112222" };
    stage.sessions.next = next;
    await stage.press("/new", "› /new");
    await stage.press(ENTER, "›  What do we test?");
    await stage.press("Test the returns.", "› Test the returns.");
    await stage.press(ENTER, `Session ${next.id}`);
    assert.equal(stage.sessions.openings.length, 2);
  });

  it("tells why the session on screen could not be resumed, and follows nothing new", async () => {
    const stage = await staged();
    await opening(stage);
    stage.sessions.end(COMPLETED);
    await stage.sees("›  What do the agents do next?");
    stage.sessions.failing.set("resume", new SessionEndedError(RUNNING.id));
    await stage.press("Go on.", "› Go on.");
    await stage.press(ENTER, `Told: The session ${RUNNING.id} no longer goes on.`);
    assert.deepEqual(stage.sessions.after, [0]);
  });

  it("times the session that goes on by the clock", async () => {
    let now = NOW;
    const stage = await staged([FAILED], { now: () => now });
    await opening(stage);
    await stage.sees("running · 0 s");
    now += 42_000;
    await stage.sees("running · 42 s");
  });
});

describe("the commands of the conversation", () => {
  it("are hinted as they are typed, completed by Tab, and listed by /help", async () => {
    const stage = await staged();
    await stage.press("/h", "❯ /help       List the commands and the keys");
    await stage.press(TAB, "› /help");
    await stage.press(ENTER, "Keys");
    assert.match(stage.screen(), /Commands\n\/sessions {7}Pick a session/);
    assert.match(stage.screen(), /›  What do we test\?\n {2}Enter open a session/);
  });

  it("tell what is no command, until the next key", async () => {
    const stage = await staged();
    await stage.press("/resume", "› /resume");
    await stage.press(ENTER, "Unknown command /resume; /help lists the commands.");
    await stage.press("/", "❯ /sessions");
    assert.doesNotMatch(stage.screen(), /Unknown command/);
  });

  it("/sessions lists the sessions to pick one with the arrows, and follows the one picked; Esc closes the list", async () => {
    const stage = await staged([RUNNING, FAILED]);
    await stage.press("/sessions", "› /sessions");
    await stage.press(ENTER, "Reopen a session\n❯ 0a1b2c3d  running");
    await stage.press(ESC, "›  What do we test?");
    await stage.press("/sessions", "› /sessions");
    await stage.press(ENTER, "❯ 0a1b2c3d  running");
    await stage.press(DOWN, "❯ 9f8e7d6c  a test failed");
    await stage.press(UP, "❯ 0a1b2c3d  running");
    await stage.press(ENTER, `Session ${RUNNING.id}`);
    await until(() => stage.sessions.followed.has(RUNNING.id), "the session picked is followed");
    stage.sessions.tell(RUNNING.id, numbered(THREAD.slice(0, 4)));
    await stage.sees("The configuration is valid");
    // A session another process runs is spoken to, and Ctrl-C leaves it to that process.
    assert.match(stage.screen(), /›  Say something to the agents\n {2}Enter send · \/ commands · Ctrl-C quit$/);
    assert.deepEqual(stage.sessions.openings, []);
  });

  it("/new goes back to the start, where the latest sessions are listed again, and leaves the thread that was followed", async () => {
    const stage = await staged();
    await opening(stage);
    await stage.press("/new", "› /new");
    await stage.press(ENTER, /Latest sessions\n {2}0a1b2c3d {2}running {2}Test the search of a customer\.\n {2}9f8e7d6c[^\n]*\n\n›  What do we test\?/);
    assert.deepEqual(stage.sessions.left, [RUNNING.id]);
  });

  it("/stop asks before it stops the session on screen: Esc keeps it going, Enter asks it to stop", async () => {
    const stage = await staged();
    await opening(stage);
    await stage.press("/stop", "› /stop");
    await stage.press(ENTER, `Stop the session ${RUNNING.id}?`);
    await stage.press(ESC, "›  Say something to the agents");
    assert.deepEqual(stage.sessions.interrupted, []);
    await stage.press("/stop", "› /stop");
    await stage.press(ENTER, "Enter stop it · Esc keep it going");
    await stage.press(ENTER, "The session is asked to stop: its agents stop as soon as they hand over.");
    assert.deepEqual(stage.sessions.interrupted, [RUNNING.id]);
    stage.sessions.end({ ...RUNNING, state: "interrupted" });
    await stage.sees("Session interrupted");
    assert.doesNotMatch(stage.screen(), /is asked to stop/);
  });

  it("/ui serves the web console, on the port it is given, and writes its address", async () => {
    const stage = await staged();
    await stage.press("/ui 0", "› /ui 0");
    await stage.press(ENTER, "The web console is served at http://127.0.0.1:6727 until you leave.");
    await stage.press("/ui", "› /ui");
    await stage.press(ENTER, /until you leave\.[\s\S]*until you leave\./);
    assert.deepEqual(stage.served, [0, 6727]);
  });

  it("/quit leaves, with the sessions this process opened", async () => {
    const stage = await staged();
    await opening(stage);
    await stage.press("/quit", "› /quit");
    await stage.press(ENTER, "Say something to the agents");
    await until(() => stage.left.length === 1, "the person left");
    assert.deepEqual(stage.left, [{ atOnce: false, hosted: [RUNNING.id] }]);
  });
});

describe("Ctrl-C in the conversation", () => {
  it("clears what is typed, says to press again where it stops nothing, then leaves at once", async () => {
    const stage = await staged();
    await stage.press("Test the", "› Test the");
    await stage.press(CTRL_C, "›  What do we test?");
    assert.deepEqual(stage.left, []);
    await stage.press(CTRL_C, "Press Ctrl-C again to quit.");
    await stage.press("T", "› T");
    assert.doesNotMatch(stage.screen(), /Press Ctrl-C again/);
    await stage.press(CTRL_C, "›  What do we test?");
    await stage.press(CTRL_C, "Press Ctrl-C again to quit.");
    await stage.press(CTRL_C, "");
    await until(() => stage.left.length === 1, "the person left");
    assert.deepEqual(stage.left, [{ atOnce: true, hosted: [] }]);
  });

  it("asks the session this process runs to stop, as it does for oqas --brief, and leaves without waiting for it when pressed again", async () => {
    const stage = await staged();
    await opening(stage);
    await stage.press(CTRL_C, "The session is asked to stop, and ends soon. Ctrl-C again leaves at once, without waiting for it.");
    assert.deepEqual(stage.sessions.interrupted, [RUNNING.id]);
    await stage.press(CTRL_C, "");
    await until(() => stage.left.length === 1, "the person left");
    assert.deepEqual(stage.left, [{ atOnce: true, hosted: [RUNNING.id] }]);
    assert.deepEqual(stage.sessions.interrupted, [RUNNING.id]);
  });

  it("closes what stands over the input", async () => {
    const stage = await staged();
    await stage.press("/sessions", "› /sessions");
    await stage.press(ENTER, "Reopen a session");
    await stage.press(CTRL_C, "›  What do we test?");
    assert.deepEqual(stage.left, []);
  });
});

describe("what fails in the conversation", () => {
  it("is told in the thread, in the words of the command, and the conversation goes on: a session that cannot be opened, said to, stopped or listed", async () => {
    const stage = await staged();
    stage.sessions.failing.set("open", new Error("The database is locked."));
    await stage.press("Test the returns.", "› Test the returns.");
    await stage.press(ENTER, "✗ Told: The database is locked.");
    await opening(stage);
    stage.sessions.failing.set("say", new SessionEndedError(RUNNING.id));
    await stage.press("Go on.", "› Go on.");
    await stage.press(ENTER, `✗ Told: The session ${RUNNING.id} no longer goes on.`);
    stage.sessions.failing.set("interrupt", new Error("Not stopped."));
    await stage.press(CTRL_C, "✗ Told: Not stopped.");
    stage.sessions.failing.set("interrupt", new Error("Still not stopped."));
    await stage.press("/stop", "› /stop");
    await stage.press(ENTER, "Stop the session");
    await stage.press(ENTER, "✗ Told: Still not stopped.");
    stage.sessions.failing.set("sessions", new Error("Not listed."));
    await stage.press("/sessions", "› /sessions");
    await stage.press(ENTER, "✗ Told: Not listed.");
    stage.sessions.failing.set("sessions", new Error("Not listed either."));
    await stage.press("/new", "› /new");
    await stage.press(ENTER, "✗ Told: Not listed either.");
  });

  it("is told when the web console cannot be served", async () => {
    const stage = await staged([], {
      serve: async () => {
        throw new Error("The port 6727 of 127.0.0.1 is taken.");
      },
    });
    await stage.press("/ui", "› /ui");
    await stage.press(ENTER, "✗ Told: The port 6727 of 127.0.0.1 is taken.");
  });

  it("is told when the thread of a session can no longer be read: it cannot be followed, its events fail, or what it came to cannot be read", async () => {
    const stage = await staged([RUNNING, FAILED]);
    stage.sessions.failing.set("events", new UnknownSessionError(RUNNING.id));
    await stage.press("/sessions", "› /sessions");
    await stage.press(ENTER, "Reopen a session");
    await stage.press(ENTER, /✗ Told: [^\n]*0a1b2c3d/);
    await stage.press("/sessions", "› /sessions");
    await stage.press(ENTER, "Reopen a session");
    await stage.press(DOWN, "❯ 9f8e7d6c");
    await stage.press(ENTER, `Session ${FAILED.id}`);
    await until(() => stage.sessions.followed.has(FAILED.id), "the session is followed");
    stage.sessions.followed.get(FAILED.id)!.failed(new Error("The store does not answer."));
    await stage.sees("✗ Told: The store does not answer.");
    stage.sessions.tell(FAILED.id, numbered(THREAD.slice(0, 1)));
    stage.sessions.failing.set("session", new Error("Not read."));
    stage.sessions.followed.get(FAILED.id)!.ended();
    await stage.sees("✗ Told: Not read.");
    assert.match(stage.screen(), /› You\n {2}Test the search of a customer\./);
  });
});

describe("the thread the conversation follows", () => {
  it("is left when another comes on screen, and never followed when the person left it before its events were given", async () => {
    let release = (): void => undefined;
    const stage = await staged([RUNNING, FAILED]);
    stage.sessions.gate = new Promise((resolve) => (release = resolve));
    await stage.press("/sessions", "› /sessions");
    await stage.press(ENTER, "Reopen a session");
    await stage.press(ENTER, `Session ${RUNNING.id}`);
    await stage.press("/new", "› /new");
    await stage.press(ENTER, /Latest sessions[\s\S]*Latest sessions/);
    release();
    stage.sessions.gate = undefined;
    await stage.press("/sessions", "› /sessions");
    await stage.press(ENTER, "Reopen a session");
    await stage.press(DOWN, "❯ 9f8e7d6c");
    await stage.press(ENTER, `Session ${FAILED.id}`);
    await until(() => stage.sessions.followed.has(FAILED.id), "the second session is followed");
    assert.deepEqual([...stage.sessions.followed.keys()], [FAILED.id]);
    await stage.press("/sessions", "› /sessions");
    await stage.press(ENTER, "Reopen a session");
    await stage.press(ENTER, /Session session-2026-11-13[\s\S]*Session session-2026-11-12[\s\S]*Session session-2026-11-13/);
    await until(() => stage.sessions.followed.has(RUNNING.id), "the first session is followed again");
    assert.deepEqual(stage.sessions.left, [FAILED.id]);
  });
});

describe("the model in the conversation", () => {
  const SERVER: Model = { mode: "provider-key", provider: "openai", baseUrl: "http://localhost:1234/v1", model: "local" };

  /** A model whose connection answers as told, and which records what it is given. */
  const modelled = (check: ModelConnectionCheck, saved: Model[] = [], inForce: () => Promise<Model> = () => Promise.resolve(SERVER)): ConversationModel => ({
    inForce,
    check: () => Promise.resolve(check),
    save: (model) => {
      saved.push(model);
      return Promise.resolve();
    },
  });

  it("says when the conversation opens that the model does not answer, or is not offered, and how to set it", async () => {
    const silent = await staged([], { model: modelled({ state: "signed-out" }) });
    await silent.sees("The model does not answer. No GitHub account is signed in");
    await silent.sees("/model to set it.");
    cleanup();
    const absent = await staged([], { model: modelled({ state: "connected", models: [{ id: "other", name: "other", reasoningEfforts: [] }] }) });
    await absent.sees("The model local is not among those");
    cleanup();
    const refused = await staged([], { model: modelled({ state: "key-refused", status: 401 }) });
    await refused.sees("The provider refused the key");
    cleanup();
    const none = await staged([], { model: modelled({ state: "no-models", account: "octo" }) });
    await none.sees("The GitHub account octo is signed in");
    cleanup();
    const offered = await staged([], { model: modelled({ state: "connected", models: [{ id: "local", name: "local", reasoningEfforts: [] }] }) });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.doesNotMatch(offered.screen(), /does not answer|not among/);
  });

  it("opens the setting of the model with /model, records the connection chosen, and says so", async () => {
    const saved: Model[] = [];
    const stage = await staged([], { model: modelled({ state: "connected", models: [{ id: "local", name: "local", reasoningEfforts: [] }] }, saved) });
    await stage.press("/model", "› /model");
    await stage.press(ENTER, "How does the tool reach the model?");
    assert.doesNotMatch(stage.screen(), /What do we test\?/);
    await stage.press(ENTER, "Address of the server");
    await stage.press(ENTER, "Variable that holds the key");
    await stage.press(ENTER, "Choose the model:");
    await stage.press(ENTER, "The model local is set");
    assert.deepEqual(saved, [SERVER]);
    await stage.sees("What do we test?");
  });

  it("leaves the setting with Esc or Ctrl-C, saying nothing changed, and tells what stops it", async () => {
    const stage = await staged([], { model: modelled({ state: "connected" }) });
    await stage.press("/model", "› /model");
    await stage.press(ENTER, "How does the tool reach the model?");
    await stage.press(ESC, "Nothing changed.");
    await stage.press("/model", "› /model");
    await stage.press(ENTER, "How does the tool reach the model?");
    await stage.press(CTRL_C, "What do we test?");
    assert.deepEqual(stage.left, []);
    cleanup();
    let reads = 0;
    const failing = await staged([], {
      model: {
        inForce: () => (++reads === 1 ? Promise.resolve(SERVER) : Promise.reject(new Error("unreadable"))),
        check: () => Promise.resolve({ state: "connected" }),
        save: () => Promise.reject(new Error("refused")),
      },
    });
    await failing.press("/model", "› /model");
    await failing.press(ENTER, "Told: unreadable");
    cleanup();
    const refusing = await staged([], { model: { ...modelled({ state: "connected" }), save: () => Promise.reject(new Error("refused")) } });
    await refusing.press("/model", "› /model");
    await refusing.press(ENTER, "How does the tool reach the model?");
    await refusing.press(ENTER, "Address of the server");
    await refusing.press(ENTER, "Variable that holds the key");
    await refusing.press(ENTER, "type the name of the model");
    await refusing.press(ENTER, "Told: refused");
  });
});
