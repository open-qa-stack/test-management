import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  CHARACTERS_PER_TICK,
  durationOf,
  endOf,
  frameOf,
  INITIAL_PLAYBACK,
  PAUSE_TICKS,
  played,
  shows,
  DEFAULT_VIEW,
  TOOL_TICKS,
  type Playback,
} from "../../src/agent/playback.ts";
import type { SessionScript, SessionStage, Step } from "@open-qa-stack/domain/sessions";

const LOOK = { kind: "page", name: "card", lines: ["a rule"] } as const;

/**
 * A short session: a request, a pass, a reasoning, a tool with a look, a refusal, a note, a plan, a message, a
 * tool that has not answered, and what the session produced.
 */
const STEPS: readonly Step[] = [
  { kind: "say", from: "user", at: "10:00:00", text: "Cover the quotes." },
  { kind: "pass", at: "10:00:01", phase: "plan", title: "Pass 1", summary: "The shortest path." },
  { kind: "say", from: "planner", at: "10:00:02", thinking: true, text: "12345678" },
  { kind: "tool", from: "planner", at: "10:00:03", tool: "shop_goto", title: "Opened the form", look: LOOK },
  { kind: "verdict", at: "10:00:04", accepted: false, code: "PLAN-SHOWN", about: "The plan", text: "Never shown.", reason: "Never shown." },
  { kind: "note", at: "10:00:05", text: "The plan was accepted." },
  { kind: "plan", at: "10:00:06", title: "The plan", scenarios: [{ id: "a", title: "A scenario", level: "smoke", case: "nominal", refusals: [] }] },
  { kind: "say", from: "writer", at: "10:00:07", text: "Done" },
  { kind: "tool", from: "writer", at: "10:00:08", tool: "run_test", title: "Ran the test", pending: true },
  { kind: "outcome", at: "10:00:09", title: "1 test", tests: [{ title: "A test", level: "smoke", verdict: "passed" }] },
];

/** The session of a run that ended. */
const SCRIPT: SessionScript = { id: "s", title: "A session", sources: ["a card"], stage: "ended", steps: STEPS };

/** The same session while its run still writes. */
const LIVE: SessionScript = { ...SCRIPT, stage: "live" };

/** The tick each step starts at in a replay. */
const STARTS = STEPS.reduce<number[]>(
  (starts, _step, index) => [...starts, index === 0 ? 0 : starts[index - 1]! + durationOf(STEPS[index - 1]!) + PAUSE_TICKS],
  [],
);

/**
 * A replay at a tick.
 *
 * @param tick - How far it is.
 * @param changes - What differs from a replay that is stopped at the first speed.
 * @returns The playback.
 */
const at = (tick: number, changes: Partial<Playback> = {}): Playback => ({ following: false, tick, playing: false, speed: 1, ...changes });

/**
 * The first steps of the session, as a session of their own.
 *
 * @param count - How many steps to keep.
 * @param stage - Where the session is; its run still writes by default.
 * @returns The session.
 */
const upTo = (count: number, stage: SessionStage = "live"): SessionScript => ({ ...SCRIPT, stage, steps: STEPS.slice(0, count) });

describe("the duration of a step", () => {
  it("is the time to write a message of an agent, none for one of the person, the time a tool answers, a tick otherwise", () => {
    assert.deepEqual(STEPS.map(durationOf), [0, 1, 8 / CHARACTERS_PER_TICK, TOOL_TICKS, 1, 1, 1, 1, TOOL_TICKS, 1]);
    assert.equal(endOf(SCRIPT), STARTS.at(-1)! + 1 + PAUSE_TICKS);
  });
});

describe("the frame of a session a person follows", () => {
  it("shows every step of a run that ended in full, with nobody speaking and nothing more to come", () => {
    assert.equal(INITIAL_PLAYBACK.following, true);
    const frame = frameOf(SCRIPT, INITIAL_PLAYBACK);
    assert.deepEqual(
      frame.shown.map(({ index, written, running }) => [index, written, running]),
      STEPS.map((step, index) => [index, step.kind === "say" ? step.text : "", false]),
    );
    assert.deepEqual([frame.speaking, frame.finished, frame.actions, frame.progress], [undefined, true, 2, 1]);
    assert.ok(!("speaking" in frame));
  });

  it("shows a tool that has not answered as running while the run still writes, and counts it only once it has", () => {
    const frame = frameOf(upTo(9), INITIAL_PLAYBACK);
    assert.deepEqual(
      frame.shown.map(({ running }) => running),
      [false, false, false, false, false, false, false, false, true],
    );
    assert.deepEqual([frame.speaking, frame.finished, frame.actions, frame.progress], ["writer", false, 1, 1]);
  });

  it("names who the last step of a run that still writes comes from: its speaker, the harness for a refusal or a note, nobody otherwise", () => {
    assert.deepEqual(
      [3, 4, 5, 6, 7, 8, 10].map((count) => frameOf(upTo(count), INITIAL_PLAYBACK).speaking),
      ["planner", "planner", "harness", "harness", undefined, "writer", undefined],
    );
    assert.equal(frameOf(upTo(2), INITIAL_PLAYBACK).speaking, undefined);
    assert.equal(frameOf(upTo(5, "ended"), INITIAL_PLAYBACK).speaking, undefined);
  });

  it("names nobody at work in a session that waits its turn, which more is to come of, followed or replayed to its end", () => {
    const queued = upTo(1, "queued");
    const frame = frameOf(queued, INITIAL_PLAYBACK);
    assert.deepEqual([frame.shown.length, frame.speaking, frame.finished], [1, undefined, false]);
    assert.equal(frameOf(queued, at(endOf(queued))).finished, false);
    assert.equal(frameOf(upTo(9, "queued"), INITIAL_PLAYBACK).shown.at(-1)!.running, false);
  });

  it("shows a run that wrote nothing yet as an empty session more is to come of, and one that ended so as over", () => {
    const waiting = frameOf(upTo(0), INITIAL_PLAYBACK);
    assert.deepEqual([waiting.shown.length, waiting.speaking, waiting.finished, waiting.progress], [0, undefined, false, 1]);
    const over = frameOf(upTo(0, "ended"), INITIAL_PLAYBACK);
    assert.deepEqual([over.shown.length, over.finished, over.progress], [0, true, 1]);
  });
});

describe("the frame of a session a person replays", () => {
  it("opens on what was asked, written in full, with nobody speaking", () => {
    const frame = frameOf(SCRIPT, at(0));
    assert.deepEqual(
      frame.shown.map(({ index, written, running }) => [index, written, running]),
      [[0, "Cover the quotes.", false]],
    );
    assert.deepEqual([frame.speaking, frame.finished, frame.actions, frame.progress], [undefined, false, 0, 0]);
  });

  it("writes a message a few characters at a tick, and names who speaks while it does", () => {
    const writing = frameOf(SCRIPT, at(STARTS[2]! + 1));
    assert.deepEqual([writing.shown.at(-1)!.written, writing.shown.at(-1)!.running, writing.speaking], ["1234", true, "planner"]);
    const written = frameOf(SCRIPT, at(STARTS[2]! + 2));
    assert.deepEqual([written.shown.at(-1)!.written, written.shown.at(-1)!.running, written.speaking], ["12345678", false, undefined]);
  });

  it("shows a tool as running until it answers, then counts it", () => {
    const running = frameOf(SCRIPT, at(STARTS[3]! + 1));
    assert.deepEqual([running.shown.at(-1)!.running, running.speaking, running.actions], [true, "planner", 0]);
    const answered = frameOf(SCRIPT, at(STARTS[3]! + TOOL_TICKS));
    assert.deepEqual([answered.shown.at(-1)!.running, answered.actions], [false, 1]);
  });

  it("shows a review whose call the harness has not answered as going, by its reviewer, followed or replayed", () => {
    const review: Step = { kind: "review", from: "plan_reviewer", at: "10:00:10", remarks: [], tool: "report_duplicates", pending: true };
    const script: SessionScript = { ...LIVE, steps: [review] };
    const followed = frameOf(script, INITIAL_PLAYBACK);
    assert.deepEqual([followed.shown[0]!.running, followed.speaking, followed.actions], [true, "plan_reviewer", 0]);
    assert.equal(frameOf({ ...script, stage: "ended" }, INITIAL_PLAYBACK).shown[0]!.running, false);
    const replayed = frameOf(script, at(0));
    assert.deepEqual([replayed.shown[0]!.running, replayed.speaking], [true, "plan_reviewer"]);
  });

  it("answers in its time a tool that has not answered in the run, as any other", () => {
    assert.equal(frameOf(LIVE, at(STARTS[8]! + 1)).shown.at(-1)!.running, true);
    const answered = frameOf(LIVE, at(STARTS[8]! + TOOL_TICKS));
    assert.deepEqual([answered.shown.at(-1)!.running, answered.actions], [false, 2]);
  });

  it("names nobody while the start of a pass, a refusal, a note or a plan shows", () => {
    assert.deepEqual(
      [1, 4, 5, 6].map((index) => {
        const frame = frameOf(SCRIPT, at(STARTS[index]!));
        return [frame.shown.at(-1)!.index, frame.shown.at(-1)!.running, frame.speaking];
      }),
      [
        [1, true, undefined],
        [4, true, undefined],
        [5, true, undefined],
        [6, true, undefined],
      ],
    );
  });

  it("is finished once every step is shown in full, if the run has ended", () => {
    const end = endOf(SCRIPT);
    assert.deepEqual([frameOf(SCRIPT, at(end - PAUSE_TICKS - 1)).finished, frameOf(SCRIPT, at(end - PAUSE_TICKS)).finished], [false, true]);
    assert.equal(frameOf(LIVE, at(end)).finished, false);
  });

  it("measures how far it is, and never past the end", () => {
    const end = endOf(SCRIPT);
    assert.deepEqual([frameOf(SCRIPT, at(end / 2)).progress, frameOf(SCRIPT, at(end * 2)).progress], [0.5, 1]);
    assert.deepEqual([frameOf(upTo(0), at(0)).progress, frameOf(upTo(0, "ended"), at(0)).finished], [1, true]);
  });
});

describe("the playback of a session", () => {
  it("stays as it is on a beat while the session is followed or the replay is stopped", () => {
    assert.equal(played(SCRIPT, INITIAL_PLAYBACK, { type: "beat" }), INITIAL_PLAYBACK);
    const following = { ...INITIAL_PLAYBACK, playing: true };
    assert.equal(played(SCRIPT, following, { type: "beat" }), following);
    const stopped = at(3);
    assert.equal(played(SCRIPT, stopped, { type: "beat" }), stopped);
  });

  it("moves a replay that plays by its speed at each beat", () => {
    assert.deepEqual(played(SCRIPT, at(0, { playing: true, speed: 2 }), { type: "beat" }), at(2, { playing: true, speed: 2 }));
  });

  it("follows the session again once the replay has shown everything", () => {
    const end = endOf(SCRIPT);
    assert.deepEqual(played(SCRIPT, at(end - 2, { playing: true }), { type: "beat" }), at(end - 1, { playing: true }));
    assert.deepEqual(played(SCRIPT, at(end - 1, { playing: true }), { type: "beat" }), at(end - 1, { following: true }));
    assert.deepEqual(played(LIVE, at(end - 1, { playing: true, speed: 8 }), { type: "beat" }), at(end - 1, { following: true, speed: 8 }));
  });

  it("replays from the first step, going on by itself at the speed it had", () => {
    assert.deepEqual(played(SCRIPT, { ...INITIAL_PLAYBACK, speed: 4 }, { type: "restart" }), at(0, { playing: true, speed: 4 }));
    assert.deepEqual(played(SCRIPT, at(40, { speed: 2 }), { type: "restart" }), at(0, { playing: true, speed: 2 }));
  });

  it("stops a replay and starts it again, and leaves a session that is followed as it is", () => {
    assert.equal(played(SCRIPT, at(3, { playing: true }), { type: "toggle" }).playing, false);
    assert.equal(played(SCRIPT, at(3), { type: "toggle" }).playing, true);
    assert.equal(played(SCRIPT, INITIAL_PLAYBACK, { type: "toggle" }), INITIAL_PLAYBACK);
  });

  it("goes through the speeds, back to the first after the last or from a speed it does not know", () => {
    assert.deepEqual(
      [1, 2, 4, 8, 3].map((speed) => played(SCRIPT, at(0, { speed }), { type: "faster" }).speed),
      [2, 4, 8, 1, 1],
    );
    assert.deepEqual(played(SCRIPT, INITIAL_PLAYBACK, { type: "faster" }), { ...INITIAL_PLAYBACK, speed: 2 });
  });

  it("skips to the next verdict, a refusal then a plan, stopped there, then follows the session", () => {
    const refusal = played(SCRIPT, at(0, { playing: true }), { type: "skip" });
    assert.deepEqual(refusal, at(STARTS[4]! + 1));
    assert.equal(frameOf(SCRIPT, refusal).shown.at(-1)!.step.kind, "verdict");
    const plan = played(SCRIPT, refusal, { type: "skip" });
    assert.deepEqual(plan, at(STARTS[6]! + 1));
    assert.deepEqual(played(SCRIPT, { ...plan, speed: 2 }, { type: "skip" }), at(STARTS[6]! + 1, { following: true, speed: 2 }));
  });

  it("skips to the verdict of a reviewer as to one of the harness", () => {
    const review: Step = { kind: "review", from: "code_reviewer", at: "10:00:10", remarks: [], tool: "report_quality" };
    const reviewed: SessionScript = { ...SCRIPT, steps: [STEPS[0]!, review] };
    assert.deepEqual(played(reviewed, at(0, { playing: true }), { type: "skip" }), at(durationOf(STEPS[0]!) + PAUSE_TICKS + 1));
  });

  it("skips without going back, and leaves a session that is followed as it is", () => {
    assert.deepEqual(played(SCRIPT, at(STARTS[4]! + 3), { type: "skip" }), at(STARTS[6]! + 1));
    assert.equal(played(SCRIPT, INITIAL_PLAYBACK, { type: "skip" }), INITIAL_PLAYBACK);
  });

  it("leaves a replay for the session as it is now", () => {
    assert.deepEqual(played(SCRIPT, at(12, { playing: true, speed: 4 }), { type: "follow" }), at(12, { following: true, speed: 4 }));
  });
});

describe("what the conversation shows", () => {
  const kinds = (view: Parameters<typeof shows>[1], speaker?: Parameters<typeof shows>[2]) =>
    STEPS.filter((step) => shows(step, view, speaker)).map((step) => step.kind);

  it("is what is said — the notes of the harness included —, the start of a pass and what the session produced, then the verdicts and the actions when asked", () => {
    assert.deepEqual(kinds({ verdicts: false, actions: false }), ["say", "pass", "say", "note", "say", "outcome"]);
    assert.deepEqual(kinds(DEFAULT_VIEW), ["say", "pass", "say", "verdict", "note", "plan", "say", "outcome"]);
    assert.deepEqual(kinds({ verdicts: false, actions: true }), ["say", "pass", "say", "tool", "note", "say", "tool", "outcome"]);
    assert.equal(kinds({ verdicts: true, actions: true }).length, STEPS.length);
  });

  it("follows one speaker, a verdict or a note being the harness speaking, a plan nobody", () => {
    const all = { verdicts: true, actions: true };
    assert.deepEqual(kinds(all, "planner"), ["pass", "say", "tool", "outcome"]);
    assert.deepEqual(kinds(all, "harness"), ["pass", "verdict", "note", "outcome"]);
    assert.deepEqual(kinds(DEFAULT_VIEW, "writer"), ["pass", "say", "outcome"]);
  });

  it("keeps the verdict of a reviewer among the verdicts, and with the reviewer it follows", () => {
    const review: Step = { kind: "review", from: "code_reviewer", at: "10:00:10", remarks: [], tool: "report_quality" };
    assert.deepEqual([shows(review, DEFAULT_VIEW), shows(review, { verdicts: false, actions: true })], [true, false]);
    assert.deepEqual([shows(review, DEFAULT_VIEW, "code_reviewer"), shows(review, DEFAULT_VIEW, "harness")], [true, false]);
  });

  it("keeps a row of notes alike as the harness speaking", () => {
    const alike: Step = { kind: "repeated", at: "10:00:10", before: "A ", after: ".", sources: ["a", "b"], notes: [] };
    assert.deepEqual([shows(alike, DEFAULT_VIEW, "harness"), shows(alike, DEFAULT_VIEW, "writer")], [true, false]);
  });

  it("keeps what the session works on and the delivery of a message whatever it shows, whoever it follows", () => {
    const scope: Step = { kind: "scope", at: "10:00:10", title: "Portée", environment: "local", applications: ["shop"], levels: ["smoke"] };
    const delivery: Step = { kind: "delivery", at: "10:00:10", message: 1, to: "planner" };
    const none = { verdicts: false, actions: false };
    assert.deepEqual([shows(scope, none, "writer"), shows(delivery, none, "writer")], [true, true]);
  });
});
