import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  accepts,
  ASKED_STATE,
  isTerminal,
  MessageNotPendingError,
  nextState,
  refusalOf,
  SESSION_LIFE,
  SessionEndedError,
  SessionStateError,
  UnknownSessionError,
  type SessionCommand,
} from "../src/index.ts";
import type { SessionState } from "../src/sessions/index.ts";

const STATES: readonly SessionState[] = ["queued", "running", "completed", "interrupted"];
const COMMANDS: readonly SessionCommand[] = ["start", "append", "say", "resume", "deliver", "complete", "interrupt", "beat", "takeOver", "abandon"];
/** The commands that tell the work of a session, which runs. */
const OF_THE_WORK = ["append", "deliver", "complete"] as const;
/** The commands a session that goes on takes, whether it waits or runs. */
const OPEN = ["say", "interrupt"] as const;

/** The state each command leaves a session in, by the state it finds it in; `undefined` where the session does not take it. */
function transitions(command: SessionCommand): (SessionState | undefined)[] {
  return STATES.map((state) => nextState(command, state));
}

describe("the life of a session", () => {
  it("starts queued", () => {
    assert.equal(ASKED_STATE, "queued");
  });

  it("states every command, and no other", () => {
    assert.deepEqual(Object.keys(SESSION_LIFE).sort(), [...COMMANDS].sort());
  });

  it("goes on while the session is queued or running, and has ended otherwise, in a state nobody knows included", () => {
    assert.deepEqual(STATES.map(isTerminal), [false, false, true, true]);
    assert.equal(isTerminal("archived"), true);
  });

  it("lets the host start a session that waits, and no other: it runs from then on", () => {
    assert.deepEqual(transitions("start"), ["running", undefined, undefined, undefined]);
  });

  it("lets a person say something to a session that goes on, one that still waits included, which changes no state", () => {
    assert.deepEqual(transitions("say"), ["queued", "running", undefined, undefined]);
  });

  it("takes the events and the deliveries of a session that runs alone, which change no state", () => {
    for (const command of ["append", "deliver"] as const) assert.deepEqual(transitions(command), [undefined, "running", undefined, undefined], command);
  });

  it("completes a session that runs alone, and interrupts one that goes on, one that still waits included", () => {
    assert.deepEqual(transitions("complete"), [undefined, "completed", undefined, undefined]);
    assert.deepEqual(transitions("interrupt"), ["interrupted", "interrupted", undefined, undefined]);
  });

  it("abandons a session that runs alone: one that waits is left to wait", () => {
    assert.deepEqual(transitions("abandon"), [undefined, "interrupted", undefined, undefined]);
  });

  it("takes the beat of its host as long as it goes on, and is taken over by another only while it waits, neither of which changes its state", () => {
    assert.deepEqual(transitions("beat"), ["queued", "running", undefined, undefined]);
    assert.deepEqual(transitions("takeOver"), ["queued", undefined, undefined, undefined]);
  });

  it("lets a person resume a session that ended, and no other: it waits again for a new turn", () => {
    assert.deepEqual(transitions("resume"), [undefined, undefined, "queued", "queued"]);
    assert.equal(accepts("resume", "archived"), false);
  });

  it("leaves an end by a resumption alone: no other command is for a session that ended, and none leaves it in an end", () => {
    for (const command of COMMANDS.filter((named) => named !== "resume")) {
      assert.deepEqual([accepts(command, "completed"), accepts(command, "interrupted"), accepts(command, "archived")], [false, false, false], command);
      for (const state of STATES) assert.notEqual(isTerminal(state) ? nextState(command, state) : undefined, state, `${command} of ${state}`);
    }
  });
});

describe("a command that is refused", () => {
  it("names no session, or one that ended", () => {
    for (const command of ["start", ...OF_THE_WORK, ...OPEN] as const) {
      assert.equal(refusalOf(command, undefined), "unknown_session", command);
      for (const state of ["completed", "interrupted", "archived"]) assert.equal(refusalOf(command, state), "session_ended", `${command} of ${state}`);
    }
  });

  it("tells the work of a session that still waits, or starts one that runs already", () => {
    for (const command of OF_THE_WORK) assert.deepEqual([refusalOf(command, "queued"), refusalOf(command, "running")], ["wrong_state", undefined], command);
    assert.deepEqual([refusalOf("start", "queued"), refusalOf("start", "running")], [undefined, "wrong_state"]);
  });

  it("is never one a person or whoever stops a session sends to a session that goes on", () => {
    for (const command of OPEN) for (const state of ["queued", "running"]) assert.equal(refusalOf(command, state), undefined, `${command} of ${state}`);
  });

  it("resumes a session that goes on, which takes a message instead, or one in an end nobody knows", () => {
    assert.deepEqual(
      [undefined, "queued", "running", "completed", "interrupted", "archived"].map((state) => refusalOf("resume", state)),
      ["unknown_session", "wrong_state", "wrong_state", undefined, undefined, "session_ended"],
    );
  });

  it("is raised as an error that names the session, with the state or the message it is about", () => {
    const errors = [
      new UnknownSessionError("s1"),
      new SessionEndedError("s1"),
      new SessionStateError("s1", "append", "queued"),
      new MessageNotPendingError("s1", 3),
    ];
    assert.deepEqual(
      errors.map(({ name, message }) => [name, message]),
      [
        ["UnknownSessionError", "No session s1."],
        ["SessionEndedError", "The session s1 no longer goes on."],
        ["SessionStateError", "The session s1 takes no append while it is queued."],
        ["MessageNotPendingError", "The session s1 holds no pending message 3."],
      ],
    );
  });
});
