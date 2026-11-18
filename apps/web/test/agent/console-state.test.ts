import assert from "node:assert/strict";
import type { Project, Session } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { consoleAfter, INITIAL_STATE, playbackOf, type ConsoleAction, type ConsoleState } from "../../src/agent/console-state.ts";
import { INITIAL_PLAYBACK } from "../../src/agent/playback.ts";
import { COMPLETED, EVENTS, fixtureScript, RUNNING, SESSION_ID } from "./session-fixture.ts";

const PROJECT: Project = { name: "Demo", applications: [{ id: "customer-management", name: "Customer Management" }] };

/** An earlier session of the project. */
const EARLIER: Session = { ...COMPLETED, id: "oqas-2026-11-14T09-00-00-000Z", openedAt: "2026-11-14T09:00:00.000Z" };

/**
 * The state of a console after a series of actions.
 *
 * @param actions - What happened, in order.
 * @param state - Where it started; a console that just opened by default.
 * @returns The state.
 */
const after = (actions: readonly ConsoleAction[], state: ConsoleState = INITIAL_STATE): ConsoleState => actions.reduce(consoleAfter, state);

/**
 * The action of a list of sessions the API answered.
 *
 * @param sessions - The sessions.
 * @param askedAt - The rank at which the list was asked; the first by default.
 * @returns The action.
 */
const listing = (sessions: readonly Session[], askedAt = 1): ConsoleAction => ({ type: "sessions", sessions, askedAt });

describe("the state of a console", () => {
  it("opens knowing nothing, its instance not yet said unreachable", () => {
    assert.deepEqual(INITIAL_STATE, { openedAt: 0, unreachable: false, opening: { state: "idle" }, playbacks: {} });
  });

  it("keeps the project and the sessions the API told", () => {
    const state = after([{ type: "project", project: PROJECT }, listing([RUNNING, EARLIER])]);
    assert.deepEqual(state, { ...INITIAL_STATE, project: PROJECT, sessions: [RUNNING, EARLIER] });
  });

  it("says the instance unreachable when it could not be reached, until the API answers again", () => {
    const cut = after([listing([RUNNING]), { type: "unreachable" }]);
    assert.deepEqual([cut.unreachable, cut.sessions], [true, [RUNNING]]);
    assert.equal(consoleAfter(cut, { type: "unreachable" }), cut);
    const answers: readonly ConsoleAction[] = [
      listing([RUNNING]),
      { type: "project", project: PROJECT },
      { type: "unlisted", message: "The folder of the sessions cannot be read." },
      { type: "opened", session: EARLIER, answeredAt: 2 },
    ];
    for (const answer of answers) assert.equal(consoleAfter(cut, answer).unreachable, false, answer.type);
  });

  it("keeps why the API could not list the sessions, until it lists them", () => {
    const failed = consoleAfter(INITIAL_STATE, { type: "unlisted", message: "The folder of the sessions cannot be read." });
    assert.deepEqual(failed, { ...INITIAL_STATE, unlisted: "The folder of the sessions cannot be read." });
    const answered = consoleAfter(failed, listing([]));
    assert.deepEqual(answered, { ...INITIAL_STATE, sessions: [] });
    assert.ok(!("unlisted" in answered));
  });
});

describe("the sessions a console lists", () => {
  const LISTED = consoleAfter(INITIAL_STATE, listing([RUNNING, EARLIER]));

  it("stay the same state, so that nothing is drawn again, when the API lists them unchanged", () => {
    assert.equal(consoleAfter(LISTED, listing([{ ...RUNNING }, { ...EARLIER }], 2)), LISTED);
  });

  it("keep the object of each session that did not change, and take the others as the API tells them", () => {
    const moved = { ...RUNNING, lastEventAt: "2026-11-15T14:45:00.000Z" };
    const next = consoleAfter(LISTED, listing([moved, { ...EARLIER }], 2));
    assert.notEqual(next.sessions, LISTED.sessions);
    assert.equal(next.sessions?.[0], moved);
    assert.equal(next.sessions?.[1], EARLIER);
  });

  it("take a session whose state changed, or whose result came", () => {
    const untold: Session = { ...RUNNING, state: "completed" };
    const ended = consoleAfter(LISTED, listing([untold, EARLIER], 2));
    assert.equal(ended.sessions?.[0], untold);
    const told: Session = { ...untold, result: COMPLETED.result! };
    assert.equal(consoleAfter(ended, listing([told, EARLIER], 3)).sessions?.[0], told);
  });

  it("follow the list of the API when a session came, left, or changed place", () => {
    const opened: Session = { ...RUNNING, id: "oqas-2026-11-16T09-00-00-000Z" };
    assert.deepEqual(consoleAfter(LISTED, listing([opened, RUNNING, EARLIER], 2)).sessions, [opened, RUNNING, EARLIER]);
    assert.deepEqual(consoleAfter(LISTED, listing([RUNNING], 2)).sessions, [RUNNING]);
    const swapped = consoleAfter(LISTED, listing([EARLIER, RUNNING], 2));
    assert.deepEqual(swapped.sessions, [EARLIER, RUNNING]);
    assert.notEqual(swapped, LISTED);
  });
});

describe("the session a console follows", () => {
  const FOLLOWING = consoleAfter(INITIAL_STATE, { type: "followed", id: SESSION_ID });

  it("starts with a stream that connects, no event, no message on its way, and the session yet to be told", () => {
    assert.deepEqual(FOLLOWING.followed, {
      id: SESSION_ID,
      missing: false,
      stream: "connecting",
      events: [],
      saying: { state: "idle" },
      stopping: { state: "idle" },
    });
  });

  it("starts with the session as the list has it, when it has it", () => {
    const listed = consoleAfter(INITIAL_STATE, listing([EARLIER, RUNNING]));
    assert.equal(consoleAfter(listed, { type: "followed", id: SESSION_ID }).followed?.session, RUNNING);
    assert.ok(!("session" in consoleAfter(listed, { type: "followed", id: "oqas-gone" }).followed!));
  });

  it("takes the session the API told, whether the list has it or not, and says the instance reachable", () => {
    const told = consoleAfter(FOLLOWING, { type: "session", session: RUNNING });
    assert.equal(told.followed?.session, RUNNING);
    assert.equal(told.sessions, undefined);
    assert.equal(after([{ type: "unreachable" }, { type: "session", session: RUNNING }], FOLLOWING).unreachable, false);
  });

  it("keeps the object of a session the API tells again unchanged, and takes it once it changed", () => {
    const told = consoleAfter(FOLLOWING, { type: "session", session: RUNNING });
    assert.equal(consoleAfter(told, { type: "session", session: { ...RUNNING } }), told);
    assert.equal(consoleAfter(told, { type: "session", session: COMPLETED }).followed?.session, COMPLETED);
    const cut = consoleAfter(told, { type: "unreachable" });
    const again = consoleAfter(cut, { type: "session", session: { ...RUNNING } });
    assert.deepEqual([again.unreachable, again.followed?.session === RUNNING], [false, true]);
  });

  it("ignores what the API told of a session it does not follow", () => {
    assert.equal(consoleAfter(FOLLOWING, { type: "session", session: EARLIER }), FOLLOWING);
    assert.equal(consoleAfter(INITIAL_STATE, { type: "session", session: RUNNING }), INITIAL_STATE);
    assert.equal(consoleAfter(FOLLOWING, { type: "missing", id: EARLIER.id }), FOLLOWING);
    assert.equal(consoleAfter(INITIAL_STATE, { type: "missing", id: SESSION_ID }), INITIAL_STATE);
  });

  it("is missing once the instance said it keeps no session of that name", () => {
    const missing = after([{ type: "unreachable" }, { type: "missing", id: SESSION_ID }], FOLLOWING);
    assert.deepEqual(missing.followed, { ...FOLLOWING.followed, missing: true });
    assert.equal(missing.unreachable, false);
  });

  it("takes the state of its stream, and ignores the stream of another session or of none", () => {
    assert.equal(consoleAfter(FOLLOWING, { type: "stream", id: SESSION_ID, state: "open" }).followed?.stream, "open");
    assert.equal(consoleAfter(FOLLOWING, { type: "stream", id: SESSION_ID, state: "ended" }).followed?.stream, "ended");
    assert.equal(consoleAfter(FOLLOWING, { type: "stream", id: EARLIER.id, state: "reconnecting" }), FOLLOWING);
    assert.equal(consoleAfter(INITIAL_STATE, { type: "stream", id: SESSION_ID, state: "open" }), INITIAL_STATE);
  });

  it("gathers its events in order, batch after batch", () => {
    const state = after(
      [
        { type: "events", id: SESSION_ID, events: EVENTS.slice(0, 3) },
        { type: "events", id: SESSION_ID, events: EVENTS.slice(3, 5) },
      ],
      FOLLOWING,
    );
    assert.deepEqual(state.followed, { ...FOLLOWING.followed, events: EVENTS.slice(0, 5) });
  });

  it("does not keep twice an event it already received, and stays the same state when a batch brings nothing new", () => {
    const state = after(
      [
        { type: "events", id: SESSION_ID, events: EVENTS.slice(0, 3) },
        { type: "events", id: SESSION_ID, events: EVENTS.slice(1, 5) },
      ],
      FOLLOWING,
    );
    assert.deepEqual(state.followed?.events, EVENTS.slice(0, 5));
    assert.equal(consoleAfter(state, { type: "events", id: SESSION_ID, events: EVENTS.slice(0, 2) }), state);
    assert.equal(consoleAfter(state, { type: "events", id: SESSION_ID, events: [] }), state);
  });

  it("ignores the events of a session it no longer follows, or of none", () => {
    assert.equal(consoleAfter(FOLLOWING, { type: "events", id: EARLIER.id, events: EVENTS }), FOLLOWING);
    assert.equal(consoleAfter(INITIAL_STATE, { type: "events", id: SESSION_ID, events: EVENTS }), INITIAL_STATE);
  });

  it("is forgotten once the console left it, the rest kept", () => {
    const left = after([{ type: "project", project: PROJECT }, { type: "left" }], FOLLOWING);
    assert.deepEqual(left, { ...INITIAL_STATE, project: PROJECT });
    assert.ok(!("followed" in left));
  });
});

describe("the opening of a session", () => {
  it("is sending once the person asked, then idle with the session listed first once the API opened it", () => {
    const sending = after([listing([EARLIER]), { type: "opening" }]);
    assert.deepEqual(sending.opening, { state: "sending" });
    const opened = consoleAfter(sending, { type: "opened", session: RUNNING, answeredAt: 2 });
    assert.deepEqual([opened.opening, opened.sessions, opened.openedAt], [{ state: "idle" }, [RUNNING, EARLIER], 2]);
  });

  it("lists the session opened alone before the API listed any, and once when the listing already had it", () => {
    assert.deepEqual(consoleAfter(INITIAL_STATE, { type: "opened", session: RUNNING, answeredAt: 1 }).sessions, [RUNNING]);
    const listed = consoleAfter(INITIAL_STATE, listing([EARLIER, RUNNING]));
    assert.deepEqual(consoleAfter(listed, { type: "opened", session: COMPLETED, answeredAt: 2 }).sessions, [COMPLETED, EARLIER]);
  });

  it("is not undone by a list asked before the session was opened, which lacks it; the next list is taken", () => {
    const opened = after([listing([EARLIER], 1), { type: "opening" }, { type: "opened", session: RUNNING, answeredAt: 3 }]);
    assert.equal(consoleAfter(opened, listing([EARLIER], 2)), opened);
    assert.deepEqual(consoleAfter(opened, listing([EARLIER], 4)).sessions, [EARLIER]);
    assert.equal(consoleAfter(opened, listing([{ ...RUNNING }, { ...EARLIER }], 4)), opened);
  });

  it("keeps the message of the API when it refused", () => {
    const refused = after([{ type: "opening" }, { type: "refused", message: "Une session est déjà en cours." }]);
    assert.deepEqual(refused.opening, { state: "refused", message: "Une session est déjà en cours." });
  });
});

describe("the request of a person to stop the session a console follows", () => {
  const FOLLOWING = consoleAfter(INITIAL_STATE, { type: "followed", id: SESSION_ID });
  const SENDING = consoleAfter(FOLLOWING, { type: "stopping", id: SESSION_ID });

  it("is sending once the person confirmed it, then asked once the API took it: the session goes on until its host obeyed", () => {
    assert.deepEqual(FOLLOWING.followed?.stopping, { state: "idle" });
    assert.deepEqual(SENDING.followed?.stopping, { state: "sending" });
    const asked = consoleAfter(SENDING, { type: "stop_asked", id: SESSION_ID });
    assert.deepEqual(asked.followed, { ...FOLLOWING.followed, stopping: { state: "asked" } });
  });

  it("keeps the message of the API when it refused, until the person asks again", () => {
    const refused = consoleAfter(SENDING, { type: "unstopped", id: SESSION_ID, message: "L’instance ne répond pas." });
    assert.deepEqual(refused.followed?.stopping, { state: "refused", message: "L’instance ne répond pas." });
    assert.deepEqual(refused.followed?.saying, { state: "idle" });
    assert.deepEqual(consoleAfter(refused, { type: "stopping", id: SESSION_ID }).followed?.stopping, { state: "sending" });
  });

  it("ignores what the API answers for a session the console no longer follows, and is forgotten with the session", () => {
    for (const action of [
      { type: "stopping", id: EARLIER.id },
      { type: "stop_asked", id: EARLIER.id },
      { type: "unstopped", id: EARLIER.id, message: "Refused." },
    ] as const) {
      assert.equal(consoleAfter(SENDING, action), SENDING);
      assert.equal(consoleAfter(INITIAL_STATE, action), INITIAL_STATE);
    }
    const asked = consoleAfter(SENDING, { type: "stop_asked", id: SESSION_ID });
    assert.deepEqual(after([{ type: "left" }, { type: "followed", id: SESSION_ID }], asked).followed?.stopping, { state: "idle" });
  });
});

describe("the message a person sends to the session a console follows", () => {
  const FOLLOWING = consoleAfter(INITIAL_STATE, { type: "followed", id: SESSION_ID });
  const SENDING = consoleAfter(FOLLOWING, { type: "saying", id: SESSION_ID });

  it("is sending once the person sent it, then nothing once the API took it", () => {
    assert.deepEqual(SENDING.followed?.saying, { state: "sending" });
    assert.deepEqual(consoleAfter(SENDING, { type: "said", id: SESSION_ID }).followed?.saying, { state: "idle" });
  });

  it("keeps the message of the API when it refused, until the person sends again", () => {
    const refused = consoleAfter(SENDING, { type: "unsaid", id: SESSION_ID, message: "La session vient de se terminer." });
    assert.deepEqual(refused.followed?.saying, { state: "refused", message: "La session vient de se terminer." });
    assert.deepEqual(consoleAfter(refused, { type: "saying", id: SESSION_ID }).followed?.saying, { state: "sending" });
  });

  it("changes nothing else of the session: its stream and its events stay", () => {
    const told = after(
      [
        { type: "stream", id: SESSION_ID, state: "open" },
        { type: "events", id: SESSION_ID, events: EVENTS },
      ],
      FOLLOWING,
    );
    assert.deepEqual(consoleAfter(told, { type: "saying", id: SESSION_ID }).followed, { ...told.followed, saying: { state: "sending" } });
  });

  it("ignores what the API answers for a session the console no longer follows, or for none", () => {
    for (const action of [
      { type: "saying", id: EARLIER.id },
      { type: "said", id: EARLIER.id },
      { type: "unsaid", id: EARLIER.id, message: "Refused." },
    ] as const) {
      assert.equal(consoleAfter(SENDING, action), SENDING);
      assert.equal(consoleAfter(INITIAL_STATE, action), INITIAL_STATE);
    }
  });

  it("is forgotten once the person left the session: coming back, nothing is on its way and nothing was refused", () => {
    const refused = consoleAfter(SENDING, { type: "unsaid", id: SESSION_ID, message: "Refused." });
    for (const state of [SENDING, refused]) {
      assert.deepEqual(after([{ type: "left" }, { type: "followed", id: SESSION_ID }], state).followed?.saying, { state: "idle" });
    }
  });
});

describe("the playback of a session of a console", () => {
  const script = fixtureScript();

  it("is the one of a session just opened while the person never touched it", () => {
    assert.equal(playbackOf(INITIAL_STATE, SESSION_ID), INITIAL_PLAYBACK);
  });

  it("changes with what the person does, from where it was, each session apart", () => {
    const replayed = consoleAfter(INITIAL_STATE, { type: "playback", script, action: { type: "restart" } });
    assert.deepEqual(replayed.playbacks, { [SESSION_ID]: { following: false, tick: 0, playing: true, speed: 1 } });
    const faster = after(
      [
        { type: "playback", script, action: { type: "faster" } },
        { type: "playback", script: { ...script, id: EARLIER.id }, action: { type: "faster" } },
        { type: "playback", script, action: { type: "beat" } },
      ],
      replayed,
    );
    assert.deepEqual(playbackOf(faster, SESSION_ID), { following: false, tick: 2, playing: true, speed: 2 });
    assert.deepEqual(playbackOf(faster, EARLIER.id), { ...INITIAL_PLAYBACK, speed: 2 });
  });
});
