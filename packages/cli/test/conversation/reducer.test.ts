import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { Session } from "@open-qa-stack/domain/sessions";
import { conversationReducer } from "../../src/solo/conversation/conversation-reducer.ts";
import { initialState, PICKED_SESSIONS, RECENT_SESSIONS, type ConversationState, type Printed } from "../../src/solo/conversation/conversation-state.ts";
import { after, COMPLETED, FAILED, NOW, numbered, RUNNING, showing, THREAD, endOf } from "./fixtures.ts";

const HOME = after([]);
const LIVE = showing();

/** Sums up what a conversation wrote for good: the kind of each thing, and of each block. */
const printedOf = (state: ConversationState): string[] => state.printed.map((item) => (item.kind === "block" ? `block:${item.block.kind}` : item.kind));

/** As many sessions as asked, each with an identifier of its own. */
const sessions = (count: number): Session[] => Array.from({ length: count }, (_, index) => ({ ...FAILED, id: `session-${index}` }));

describe("the conversation as it starts", () => {
  it("has written its banner and the latest sessions, a few of them, and shows no thread", () => {
    const state = initialState(sessions(RECENT_SESSIONS + 3), NOW);
    assert.deepEqual(state.printed, [{ kind: "banner" }, { kind: "recent", sessions: sessions(RECENT_SESSIONS) }]);
    assert.deepEqual({ ...state, printed: [] }, { printed: [], hosted: [], input: "", inputEpoch: 0, armed: false, now: NOW });
  });
});

describe("what the person types", () => {
  it("is held by the input, and takes away what the key before told", () => {
    const state = after([{ type: "interrupted" }, { type: "typed", input: "Test" }]);
    assert.deepEqual([state.input, state.notice, state.armed, state.inputEpoch], ["Test", undefined, false, 0]);
  });

  it("is completed by Tab into the first command it may be, with a space when the command takes something, the cursor sent to its end", () => {
    const completed = (input: string): ConversationState => after([{ type: "typed", input }, { type: "completed" }]);
    assert.deepEqual([completed("/s").input, completed("/s").inputEpoch], ["/sessions", 1]);
    assert.equal(completed("/u").input, "/ui ");
    assert.equal(completed("/").input, "/sessions");
  });

  it("is left as it is by Tab when it starts no command", () => {
    const typed = after([{ type: "typed", input: "Test /s" }]);
    assert.equal(conversationReducer(typed, { type: "completed" }), typed);
  });
});

describe("Enter", () => {
  it("clears the input and sends its cursor home, whatever it asked, unless it asked nothing", () => {
    const typed = after([{ type: "typed", input: "Test the returns." }]);
    const opened = after([{ type: "submitted", request: { kind: "open", request: "Test the returns." } }], typed);
    assert.deepEqual([opened.input, opened.inputEpoch, opened.printed.length], ["", 1, HOME.printed.length]);
    for (const request of [{ kind: "say", session: RUNNING.id, text: "x" }, { kind: "sessions" }, { kind: "new" }, { kind: "ui", port: 0 }] as const)
      assert.equal(after([{ type: "submitted", request }], typed).input, "", request.kind);
    const nothing = after([{ type: "submitted", request: { kind: "nothing" } }], after([{ type: "typed", input: "  " }]));
    assert.deepEqual([nothing.input, nothing.inputEpoch], ["  ", 0]);
  });

  it("writes the help for /help, and leaves for /quit, waiting for the sessions this process runs", () => {
    assert.deepEqual(printedOf(after([{ type: "submitted", request: { kind: "help" } }])).at(-1), "help");
    assert.deepEqual(after([{ type: "submitted", request: { kind: "quit" } }]).leaving, { atOnce: false });
  });

  it("tells why what was typed is refused, on a line the next key takes away", () => {
    const refused = after([{ type: "submitted", request: { kind: "refused", why: "Unknown command /x; /help lists the commands." } }]);
    assert.equal(refused.notice, "Unknown command /x; /help lists the commands.");
    assert.equal(after([{ type: "typed", input: "/" }], refused).notice, undefined);
  });

  it("asks to confirm a stop, then, once confirmed, closes the question and says the session is asked to stop", () => {
    const asked = after([{ type: "submitted", request: { kind: "stop", session: RUNNING.id } }], LIVE);
    assert.deepEqual(asked.overlay, { kind: "stop", session: RUNNING.id });
    const confirmed = after([{ type: "submitted", request: { kind: "confirm-stop", session: RUNNING.id } }], asked);
    assert.deepEqual([confirmed.overlay, confirmed.notice], [undefined, "The session is asked to stop: its agents stop as soon as they hand over."]);
  });

  it("closes the picker on the session picked", () => {
    const picked = after([
      { type: "listed", sessions: [FAILED] },
      { type: "submitted", request: { kind: "pick", session: FAILED } },
    ]);
    assert.equal(picked.overlay, undefined);
  });
});

describe("the picker of a session", () => {
  it("opens on the latest sessions, the first selected, a screenful at most", () => {
    assert.deepEqual(after([{ type: "listed", sessions: sessions(PICKED_SESSIONS + 2) }]).overlay, {
      kind: "picker",
      sessions: sessions(PICKED_SESSIONS),
      selected: 0,
    });
  });

  it("says there is no session yet, and opens on nothing, when there is none", () => {
    const state = after([{ type: "listed", sessions: [] }]);
    assert.deepEqual([state.overlay, state.notice], [undefined, "No session yet: say what to test to open the first."]);
  });

  it("moves its selection with the arrows, around its ends", () => {
    const picking = after([{ type: "listed", sessions: sessions(3) }]);
    const selected = (moves: readonly (1 | -1)[]): number => {
      const { overlay } = after(
        moves.map((by) => ({ type: "moved", by }) as const),
        picking,
      );
      return overlay?.kind === "picker" ? overlay.selected : -1;
    };
    assert.deepEqual([selected([1]), selected([1, 1]), selected([1, 1, 1]), selected([-1]), selected([-1, -1])], [1, 2, 0, 2, 1]);
  });

  it("is closed by Esc, as the confirmation of a stop is; the arrows move nothing when it is not open", () => {
    assert.equal(after([{ type: "listed", sessions: [FAILED] }, { type: "dismissed" }]).overlay, undefined);
    assert.equal(after([{ type: "submitted", request: { kind: "stop", session: RUNNING.id } }, { type: "dismissed" }], LIVE).overlay, undefined);
    assert.equal(conversationReducer(HOME, { type: "moved", by: 1 }), HOME);
    const stopping = after([{ type: "submitted", request: { kind: "stop", session: RUNNING.id } }], LIVE);
    assert.equal(conversationReducer(stopping, { type: "moved", by: 1 }), stopping);
  });
});

describe("Ctrl-C", () => {
  it("closes what stands over the input, then clears the input, without arming itself", () => {
    const state = after([{ type: "typed", input: "Test" }, { type: "listed", sessions: [FAILED] }, { type: "interrupted" }]);
    assert.deepEqual([state.overlay, state.input, state.armed], [undefined, "Test", false]);
    const cleared = after([{ type: "interrupted" }], state);
    assert.deepEqual([cleared.input, cleared.inputEpoch, cleared.armed, cleared.leaving], ["", 1, false, undefined]);
  });

  it("says to press again to quit where it stops nothing, and leaves at once when pressed again", () => {
    const armed = after([{ type: "interrupted" }]);
    assert.deepEqual([armed.armed, armed.notice, armed.leaving], [true, "Press Ctrl-C again to quit.", undefined]);
    assert.deepEqual(after([{ type: "interrupted" }], armed).leaving, { atOnce: true });
  });

  it("says the session this process runs is asked to stop, and that pressing again leaves without waiting for it", () => {
    const asked = after([{ type: "interrupted" }], LIVE);
    assert.deepEqual([asked.armed, asked.notice], [true, "The session is asked to stop, and ends soon. Ctrl-C again leaves at once, without waiting for it."]);
    assert.deepEqual(after([{ type: "interrupted" }], asked).leaving, { atOnce: true });
  });

  it("is disarmed by any other key", () => {
    for (const action of [{ type: "typed", input: "x" }, { type: "dismissed" }, { type: "submitted", request: { kind: "nothing" } }] as const)
      assert.equal(after([{ type: "interrupted" }, action]).armed, false, action.type);
  });
});

describe("a thread that comes on screen", () => {
  it("is headed by its session, starts empty, and is of a session this process runs when it opened it", () => {
    const opened = after([{ type: "opened", session: RUNNING, hosted: true }]);
    assert.deepEqual(opened.printed.at(-1), { kind: "heading", session: RUNNING });
    assert.deepEqual([opened.shown, opened.hosted], [{ session: RUNNING, events: [], settled: 0, resumed: 0 }, [RUNNING.id]]);
    assert.deepEqual(after([{ type: "opened", session: FAILED, hosted: false }]).hosted, []);
  });

  it("stays as it is when it is on screen already", () => {
    assert.equal(conversationReducer(LIVE, { type: "opened", session: RUNNING, hosted: false }), LIVE);
  });

  it("takes the place of the one that was there, which this process goes on running", () => {
    const other = after([{ type: "opened", session: FAILED, hosted: false }], LIVE);
    assert.deepEqual([other.shown?.session.id, other.hosted], [FAILED.id, [RUNNING.id]]);
  });
});

describe("the events of the session on screen", () => {
  it("are kept in order, and say the session runs once they tell so", () => {
    const told = after([
      { type: "opened", session: { ...RUNNING, state: "queued" }, hosted: true },
      { type: "told", session: RUNNING.id, events: numbered(THREAD.slice(0, 2)) },
    ]);
    assert.deepEqual([told.shown?.events.length, told.shown?.session.state], [2, "running"]);
    const more = after([{ type: "told", session: RUNNING.id, events: numbered(THREAD.slice(2, 4), 3) }], told);
    assert.deepEqual(
      more.shown?.events.map(({ id }) => id),
      [1, 2, 3, 4],
    );
  });

  it("write for good the blocks that will not change, and keep on the live part those that may: here from the message no agent took yet", () => {
    assert.deepEqual(printedOf(LIVE).slice(HOME.printed.length), [
      "heading",
      "block:request",
      "block:pass",
      "block:note",
      "block:pass",
      "block:brief",
      "block:speech",
      "block:action",
      "block:action",
      "block:verdict",
      "block:action",
      "block:speech",
      "block:plan",
    ]);
    assert.equal(LIVE.shown?.settled, 12);
  });

  it("write the rest once it settles — the message delivered, the action answered — and never write a block twice", () => {
    const settled = after(
      [
        {
          type: "told",
          session: RUNNING.id,
          events: numbered(
            [
              { type: "message_delivered", message: 1, agent: "writer" },
              { type: "action_finished", action: "a4", outcome: "passed", result: "1 passed", durationMs: 2000 },
              { type: "note", phase: "write", text: "The test was run: passed." },
            ],
            THREAD.length + 1,
          ),
        },
      ],
      LIVE,
    );
    assert.deepEqual(printedOf(settled).slice(LIVE.printed.length), ["block:message", "block:pass", "block:action", "block:note"]);
    const message = settled.printed[LIVE.printed.length] as Extract<Printed, { kind: "block" }>;
    assert.equal(message.block.kind === "message" && message.block.deliveredTo, "writer");
  });

  it("are ignored when they are of another session than the one on screen, or when none is", () => {
    const events = numbered(THREAD.slice(0, 1));
    assert.equal(conversationReducer(LIVE, { type: "told", session: FAILED.id, events }), LIVE);
    assert.equal(conversationReducer(HOME, { type: "told", session: RUNNING.id, events }), HOME);
  });

  it("do not end the session by themselves: how it ended is told with what it came to", () => {
    const told = after([{ type: "told", session: RUNNING.id, events: numbered([{ type: "state_changed", state: "completed" }], THREAD.length + 1) }], LIVE);
    assert.equal(told.shown?.session.state, "running");
    assert.equal(told.shown?.settled, LIVE.shown?.settled);
  });
});

describe("the end of the session on screen", () => {
  it("settles every block of its thread, the verdicts of its tests last, then writes what it came to", () => {
    const ended = after(endOf(COMPLETED), LIVE);
    assert.deepEqual(printedOf(ended).slice(LIVE.printed.length), ["block:message", "block:pass", "block:action", "block:outcome", "result"]);
    assert.deepEqual(ended.printed.at(-1), { kind: "result", session: COMPLETED });
    assert.equal(ended.shown?.session, COMPLETED);
  });

  it("takes away what a key said of the session while it went on", () => {
    const asked = after([{ type: "interrupted" }], LIVE);
    const ended = after([{ type: "ended", session: { ...RUNNING, state: "interrupted" } }], asked);
    assert.deepEqual([ended.notice, ended.armed], [undefined, false]);
  });

  it("is ignored when it is of another session than the one on screen, or when none is", () => {
    assert.equal(conversationReducer(LIVE, { type: "ended", session: FAILED }), LIVE);
    assert.equal(conversationReducer(HOME, { type: "ended", session: COMPLETED }), HOME);
  });
});

describe("the session on screen once it is resumed", () => {
  it("goes on with its thread for a new turn, which this process runs, and is followed anew", () => {
    const picked = after([{ type: "opened", session: FAILED, hosted: false }, ...endOf(FAILED)]);
    const resumed = after([{ type: "resumed", session: { ...FAILED, state: "running" } }], picked);
    assert.deepEqual([resumed.shown?.session.state, resumed.shown?.resumed, resumed.shown?.events], ["running", 1, picked.shown?.events]);
    assert.deepEqual(resumed.hosted, [FAILED.id]);
    const again = after([...endOf({ ...FAILED, state: "interrupted" }), { type: "resumed", session: { ...FAILED, state: "queued" } }], resumed);
    assert.deepEqual([again.shown?.resumed, again.hosted], [2, [FAILED.id]]);
  });

  it("is ignored when it is of another session than the one on screen, or when none is", () => {
    assert.equal(conversationReducer(LIVE, { type: "resumed", session: FAILED }), LIVE);
    assert.equal(conversationReducer(HOME, { type: "resumed", session: COMPLETED }), HOME);
  });
});

describe("what else happens to the conversation", () => {
  it("goes back to the start, where the latest sessions are written again and no thread is on screen", () => {
    const restarted = after([{ type: "restarted", sessions: sessions(RECENT_SESSIONS + 1) }], LIVE);
    assert.deepEqual(restarted.printed.at(-1), { kind: "recent", sessions: sessions(RECENT_SESSIONS) });
    assert.deepEqual([restarted.shown, restarted.hosted], [undefined, [RUNNING.id]]);
  });

  it("writes the address of the web console once it is served", () => {
    const served = after([{ type: "served", url: "http://127.0.0.1:6727" }]);
    assert.deepEqual(served.printed.at(-1), { kind: "notice", tone: "info", text: "The web console is served at http://127.0.0.1:6727 until you leave." });
  });

  it("writes what failed in the thread, as an error", () => {
    assert.deepEqual(after([{ type: "failed", why: "No session x; oqas sessions lists them." }]).printed.at(-1), {
      kind: "notice",
      tone: "error",
      text: "No session x; oqas sessions lists them.",
    });
  });

  it("follows the clock", () => {
    assert.equal(after([{ type: "ticked", now: NOW + 1000 }]).now, NOW + 1000);
  });
});
