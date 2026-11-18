import assert from "node:assert/strict";
import { createElement, type ReactNode } from "react";
import type { Session, SessionEvent, SessionScript, Step } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { Composer } from "../../src/agent/composer.tsx";
import type { Sending } from "../../src/agent/console-state.ts";
import type { LiveSession, SessionControls } from "../../src/agent/live-session.ts";
import { LookPanel } from "../../src/agent/look-panel.tsx";
import { LookView } from "../../src/agent/look-view.tsx";
import { endOf, frameOf, INITIAL_PLAYBACK, type Playback } from "../../src/agent/playback.ts";
import { scriptOf } from "../../src/agent/session-steps.ts";
import { SessionScreen } from "../../src/agent/session-screen.tsx";
import { SpeakerMark } from "../../src/agent/speaker-mark.tsx";
import { Thread } from "../../src/agent/thread.tsx";
import { at, elementsOf, linksOf, render, textOf } from "../render.ts";
import { COMPLETED, EVENTS, fixtureScript, liveOf, NO_CONTROLS, numbered, QUEUED, RUNNING, SESSION_ID } from "./session-fixture.ts";

const PATH = `/agent/sessions/${SESSION_ID}`;
const ADDRESS = `#${PATH}`;

/** The rank, in the session of the fixtures, of what the harness asks of the planner. */
const BRIEF = 4;

/** The rank, in the session of the fixtures, of the reasoning of the planner. */
const REASONING = 5;

/** The rank, in the session of the fixtures, of the tool that returned a page. */
const PAGE_TOOL = 6;

/** The rank, in the session of the fixtures, of what the writer says. */
const SAID = 11;

/** A session that stopped without ending: it has no duration, no branch and no count of model requests. */
const INTERRUPTED: Session = { ...RUNNING, state: "interrupted" };

/** A session stopped before its end: its result holds no test and no branch. */
const STOPPED: Session = { ...RUNNING, state: "completed", result: { outcome: "stopped", durationMs: 42_000, modelRequests: 3, tests: [] } };

/** What the fixtures of a session never write: an accepted verdict, a failed tool, a file handed in without an answer, and every verdict of a test. */
const REVIEWED: readonly Step[] = [
  { kind: "pass", at: "09:00:00", title: "Plan · smoke", summary: "le chemin le plus court" },
  { kind: "say", from: "planner", to: "harness", at: "09:00:01", text: "Voici le plan." },
  { kind: "verdict", at: "09:00:02", accepted: true, about: "Plan", text: "Le plan tient sur ce que l’agent a vu." },
  {
    kind: "plan",
    at: "09:00:03",
    title: "Plan accepté par le harnais",
    scenarios: [
      { priority: "P0", title: "Search a customer", source: "smoke · /customers" },
      { priority: "P1", title: "Open a customer", source: "smoke · /customers/1" },
    ],
  },
  { kind: "tool", from: "writer", at: "09:00:04", tool: "run_test", title: "A joué le test", detail: "1 failed", outcome: "failed" },
  {
    kind: "tool",
    from: "writer",
    at: "09:00:05",
    tool: "propose_test",
    title: "A remis le test",
    look: { kind: "file", name: "search-customer.spec.ts", lines: ["test('search', async () => {});"] },
  },
  {
    kind: "outcome",
    at: "09:00:06",
    title: "Verdict de l’exécution : 4 test(s)",
    tests: [
      { title: "Search a customer", level: "smoke", verdict: "passed" },
      { title: "Open a customer", level: "", verdict: "failed", note: "The heading never showed." },
      { title: "Delete a customer", level: "", verdict: "blocked" },
      { title: "Export the customers", level: "", verdict: "skipped" },
    ],
  },
];

/**
 * A session written by hand, as the console shows it.
 *
 * @param steps - Its steps.
 * @param session - The session; one that stopped without ending by default.
 * @param sources - The knowledge sources its agents read.
 * @param changes - What differs from the playback of a session just opened.
 * @returns The session, its stream open, with controls that do nothing.
 */
function liveWith(steps: readonly Step[], session: Session = INTERRUPTED, sources: readonly string[] = [], changes: Partial<Playback> = {}): LiveSession {
  const stage = session.state === "running" ? "live" : session.state === "queued" ? "queued" : "ended";
  const script: SessionScript = { id: SESSION_ID, title: "Couvrir la recherche", sources, stage, steps };
  const playback = { ...INITIAL_PLAYBACK, ...changes };
  return {
    session,
    stream: "open",
    script,
    playback,
    frame: frameOf(script, playback),
    saying: { state: "idle" },
    stopping: { state: "idle" },
    controls: NO_CONTROLS,
  };
}

/**
 * The session of the fixtures, in which the person then said « sans le profil », which the writer received
 * after it said it went on.
 */
const CORRECTED: readonly SessionEvent[] = numbered([
  ...EVENTS,
  { type: "user_message", text: "sans le profil", number: 1 },
  { type: "agent_message", agent: "writer", text: "I go on.", reasoning: false },
  { type: "message_delivered", message: 1, agent: "writer" },
]);

/**
 * The composer of a session.
 *
 * @param saying - Where the message the person sends is; nothing sent by default.
 * @returns Its HTML.
 */
function composer(saying: Sending = { state: "idle" }): string {
  return render(createElement(Composer, { saying, onSay: NO_CONTROLS.say, onKey: NO_CONTROLS.sayOnEnter }));
}

/**
 * The tick at which a replay of the session of the fixtures starts a step.
 *
 * @param index - The rank of the step.
 * @returns The tick.
 */
function startOf(index: number): number {
  const script = fixtureScript();
  return endOf({ ...script, steps: script.steps.slice(0, index) });
}

/**
 * The session of the fixtures, replayed up to a moment of a step.
 *
 * @param index - The rank of the step.
 * @param elapsed - How many ticks the step has been going for.
 * @param session - The session; the one whose agents are working by default.
 * @returns The session, its replay stopped there.
 */
function replayAt(index: number, elapsed: number, session: Session = RUNNING): LiveSession {
  return liveOf(session, { following: false, tick: startOf(index) + elapsed });
}

/**
 * A note of the harness.
 *
 * @param text - What it notes.
 * @param second - The second it is noted at.
 * @returns The step.
 */
function note(text: string, second: number): Step {
  return { kind: "note", at: `09:00:0${second}`, text };
}

/**
 * Counts how many times a piece of HTML holds a pattern.
 *
 * @param html - The HTML.
 * @param pattern - The pattern, with its flag `g`.
 * @returns The count.
 */
function countOf(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length;
}

/**
 * Renders the thread of a session as its screen does when the address asks for nothing.
 *
 * @param live - The session.
 * @param lookIndex - The rank of the action whose look is open, if any.
 * @returns Its HTML.
 */
function thread(live: LiveSession = liveOf(), lookIndex?: number): string {
  return render(createElement(Thread, { path: PATH, frame: live.frame, lookIndex, stage: live.script.stage }));
}

/**
 * The screen of a session, as an element.
 *
 * @param query - The query of its address, with its `?`, if any.
 * @param live - The session.
 * @returns The element.
 */
function screenOf(query = "", live: LiveSession = liveOf()): ReactNode {
  return createElement(SessionScreen, { route: at(`${ADDRESS}${query}`), live, project: "lakeside-tests" });
}

/**
 * Renders the screen of a session.
 *
 * @param query - The query of its address, with its `?`, if any.
 * @param live - The session.
 * @returns Its HTML.
 */
function screen(query = "", live: LiveSession = liveOf()): string {
  return render(screenOf(query, live));
}

/**
 * Presses every button of the screen of a session but the one that submits its composer, in order.
 *
 * @param changes - What differs from the playback of a session just opened.
 * @param query - The query of the address of the session; none by default.
 * @returns The controls the buttons called, in order.
 */
function pressed(changes: Partial<Playback> = {}, query = ""): string[] {
  const calls: string[] = [];
  const controls: SessionControls = {
    ...NO_CONTROLS,
    toggle: () => calls.push("toggle"),
    restart: () => calls.push("restart"),
    faster: () => calls.push("faster"),
    skip: () => calls.push("skip"),
    follow: () => calls.push("follow"),
    stop: () => calls.push("stop"),
  };
  const buttons = elementsOf(screenOf(query, { ...liveOf(RUNNING, changes), controls }), "button").filter((button) => button["type"] === "button");
  for (const button of buttons) (button["onClick"] as () => void)();
  return calls;
}

describe("the mark of a speaker", () => {
  it("carries the icon and the tone of who speaks, as a picture assistive technology skips, and pulses while it is active", () => {
    assert.match(
      render(createElement(SpeakerMark, { speaker: "harness" })),
      /^<span class="speaker-mark md tone-neutral" aria-hidden="true"><svg width="16" height="16" /,
    );
    assert.match(render(createElement(SpeakerMark, { speaker: "planner", active: true })), /^<span class="speaker-mark md tone-ai active" aria-hidden="true">/);
  });

  it("is small in a line of text and large where the agents are introduced", () => {
    assert.match(
      render(createElement(SpeakerMark, { speaker: "writer", size: "sm" })),
      /^<span class="speaker-mark sm tone-primary" aria-hidden="true"><svg width="12" /,
    );
    assert.match(
      render(createElement(SpeakerMark, { speaker: "writer", size: "lg", active: true })),
      /^<span class="speaker-mark lg tone-primary active" aria-hidden="true"><svg width="24" /,
    );
  });
});

describe("the thread of a session", () => {
  it("says an empty session waits to be taken while it is queued, waits for the first events of one whose agents work, and says an ended one left nothing", () => {
    const queued = textOf(thread(liveWith([], QUEUED)));
    assert.equal(
      queued,
      "La session attend d’être prise par un agent Le fil se remplira dès qu’elle démarrera ; un message envoyé d’ici là sera remis à ses agents.",
    );
    const waiting = textOf(thread(liveWith([], RUNNING)));
    assert.equal(waiting, "Les agents n’ont encore rien écrit Le fil se remplira dès leur premier événement.");
    const ended = textOf(thread(liveWith([])));
    assert.equal(ended, "Cette session n’a laissé aucun événement Elle s’est arrêtée avant que ses agents ne commencent.");
  });

  it("is a labelled region whose turns come one under another", () => {
    const html = thread();
    assert.match(
      html,
      /^<section class="thread" aria-label="Fil de la session"><div class="thread-item"><div class="pass" role="separator" aria-label="Configuration">/,
    );
    assert.equal(countOf(html, /<div class="thread-item">/g), 10);
    assert.match(thread(liveOf(COMPLETED)), /<\/section><\/div><\/section>$/);
  });

  it("ends on who is at work, with its picture, only while the session goes on", () => {
    assert.match(
      thread(),
      /<div class="working" role="status"><span class="speaker-mark sm tone-primary active" aria-hidden="true">.*?<\/span><span>Rédacteur travaille<\/span><span class="dots" aria-hidden="true"><i><\/i><i><\/i><i><\/i><\/span><\/div><\/section>$/,
    );
    assert.match(thread(replayAt(REASONING, 2)), /<span>Planificateur travaille<\/span>/);
    assert.match(thread(replayAt(BRIEF, 2)), /<span class="speaker-mark sm tone-neutral active" aria-hidden="true">.*?<\/span><span>Harnais travaille<\/span>/);
    assert.doesNotMatch(thread(liveOf(COMPLETED)), /class="working"/);
    assert.doesNotMatch(thread(liveOf(INTERRUPTED)), /class="working"/);
    assert.doesNotMatch(thread(liveWith([], RUNNING)), /class="working"/);
  });

  it("says the agents work, without a picture, when nobody in particular does or when the person just spoke", () => {
    const nobody = /<div class="working" role="status"><span>Les agents travaillent<\/span><span class="dots" aria-hidden="true">/;
    assert.match(thread(liveWith([REVIEWED[0]!], RUNNING)), nobody);
    assert.match(thread(liveWith([{ kind: "say", from: "user", at: "09:00:00", text: "tester la recherche" }], RUNNING)), nobody);
    assert.match(thread(replayAt(REASONING, -1)), nobody);
  });

  it("shows what the person asked as their own bubble, said to be theirs to who cannot see it", () => {
    assert.match(
      thread(),
      /<div class="thread-item"><div class="request"><span class="sr-only">Votre demande : <\/span>tester la recherche d&#x27;un client<\/div><\/div>/,
    );
  });

  it("shows what the person said since as a bubble of theirs too, said to be a message, waiting for an agent until one received it", () => {
    const waiting = thread(liveOf(RUNNING, {}, CORRECTED.slice(0, -1)));
    assert.match(
      waiting,
      /<div class="thread-item"><div class="sent"><div class="request"><span class="sr-only">Votre message : <\/span>sans le profil<\/div><span class="sent-status">en attente d’un agent<\/span><\/div><\/div>/,
    );
    const delivered = thread(liveOf(RUNNING, {}, CORRECTED));
    assert.match(delivered, /sans le profil<\/div><span class="sent-status">remis à Rédacteur<\/span><\/div><\/div>/);
    assert.equal(countOf(delivered, /Votre demande : /g), 1);
    assert.equal(countOf(delivered, /class="sent-status"/g), 1);
  });

  it("tells in a replay where a message was at that moment: waiting until the replay reaches its delivery", () => {
    const script = scriptOf(COMPLETED, CORRECTED);
    const delivery = script.steps.findIndex((step) => step.kind === "delivery");
    const reached = endOf({ ...script, steps: script.steps.slice(0, delivery) });
    const at = (tick: number): string => textOf(thread(liveOf(COMPLETED, { following: false, tick }, CORRECTED)));
    assert.match(at(reached - 1), /Votre message : sans le profil en attente d’un agent .*I go on\.$/);
    assert.match(at(reached), /Votre message : sans le profil remis à Rédacteur .*I go on\.$/);
  });

  it("keeps where a message is under it when the thread keeps only what is said, or follows the person alone", () => {
    const live = liveOf(RUNNING, {}, CORRECTED);
    const kept = (filter: "talk" | "all", followed?: "user"): string =>
      textOf(
        render(
          createElement(Thread, {
            path: PATH,
            frame: live.frame,
            lookIndex: undefined,
            stage: "live",
            filter,
            ...(followed === undefined ? {} : { followed }),
          }),
        ),
      );
    assert.match(kept("talk"), /Votre message : sans le profil remis à Rédacteur/);
    assert.match(kept("all", "user"), /Votre message : sans le profil remis à Rédacteur/);
  });

  it("names an agent once, with its role and the time it came in, for all it thinks, says and does in a row", () => {
    const html = thread();
    const text = textOf(html);
    assert.equal(countOf(html, /<article class="turn">/g), 2);
    assert.match(
      text,
      /Planificateur explore l’application et propose le plan 14:44:11 Réflexion I should open the application first\. I should open the application first\. A ouvert \/ dans customer-management \{"url":"http:\/\/localhost:3020\/"\} 900 ms A proposé un plan de 1 scénario\(s\) The plan was accepted: search\. 40 ms /,
    );
    assert.match(text, /Rédacteur écrit et joue les tests Playwright 14:44:19 I write the test now\. A joué le test Rédacteur travaille$/);
    assert.match(
      html,
      /<article class="turn"><span class="speaker-mark md tone-ai" aria-hidden="true">.*?<\/span><div class="turn-body"><header class="turn-head"><a class="turn-agent" [^>]*>Planificateur<\/a><span class="turn-role">explore l’application et propose le plan<\/span><span class="turn-at">14:44:11<\/span><\/header>/,
    );
  });

  it("makes the name of an agent the link that leaves it alone in the thread, keeping what the address holds", () => {
    assert.match(
      thread(),
      new RegExp(`<a class="turn-agent" href="${ADDRESS}\\?agent=planner" aria-label="Planificateur : ne voir que cet agent">Planificateur</a>`),
    );
    const { frame } = liveOf();
    const talk = render(createElement(Thread, { path: PATH, frame, lookIndex: undefined, filter: "talk", query: { show: "talk" }, stage: "live" }));
    assert.deepEqual(linksOf(talk), [`${ADDRESS}?show=talk&agent=planner`, `${ADDRESS}?show=talk&agent=writer`]);
  });

  it("makes the name of the agent the thread follows the link that brings the others back", () => {
    const { frame } = liveOf();
    const followed = render(
      createElement(Thread, {
        path: PATH,
        frame,
        lookIndex: undefined,
        filter: "talk",
        followed: "writer",
        query: { show: "talk", agent: "writer" },
        stage: "live",
      }),
    );
    assert.match(followed, new RegExp(`<a class="turn-agent" href="${ADDRESS}\\?show=talk" aria-label="Rédacteur : voir tous les agents">Rédacteur</a>`));
    assert.deepEqual(linksOf(followed), [`${ADDRESS}?show=talk`]);
  });

  it("makes the picture of an agent pulse while one of its steps is going", () => {
    assert.match(thread(), /<article class="turn"><span class="speaker-mark md tone-primary active" aria-hidden="true">/);
    assert.match(thread(replayAt(REASONING, 2)), /<article class="turn"><span class="speaker-mark md tone-ai active" aria-hidden="true">/);
    assert.doesNotMatch(thread(liveOf(COMPLETED)), /<article class="turn"><span class="speaker-mark md tone-[a-z]+ active"/);
  });

  it("writes what an agent says as a paragraph, with a caret while it is written", () => {
    assert.match(thread(), /<p class="turn-text">I write the test now\.<\/p>/);
    assert.match(thread(replayAt(SAID, 1)), /<p class="turn-text">I wr<span class="caret"><\/span><\/p><\/div><\/article>/);
    assert.doesNotMatch(thread(), /class="caret"/);
  });

  it("folds a reasoning under its first line once written, and opens it with a caret while it is written", () => {
    assert.match(
      thread(),
      /<details class="thinking"><summary><svg [^>]*>.*?<\/svg><span class="thinking-label">Réflexion<\/span><span class="thinking-preview" aria-hidden="true">I should open the application first\.<\/span><\/summary><p class="thinking-text">I should open the application first\.<\/p><\/details>/,
    );
    const written = thread(replayAt(REASONING, 2));
    assert.match(written, /<details class="thinking" open=""><summary>/);
    assert.match(written, /<p class="thinking-text">I should<span class="caret"><\/span><\/p>/);
  });

  it("tells an action in a line, how long it took, with the answer of its tool folded under it and a link to what the agent had before its eyes", () => {
    const html = thread();
    assert.match(
      html,
      new RegExp(
        `<div class="act"><details><summary class="act-line"><span class="act-state" aria-hidden="true"></span><svg [^>]*>.*?</svg><span class="act-title">A ouvert / dans customer-management</span></summary><pre class="act-result">\\{&quot;url&quot;:&quot;http://localhost:3020/&quot;\\}</pre></details><a id="look-eye-${PAGE_TOOL}" class="act-look" href="${ADDRESS}\\?look=${PAGE_TOOL}" aria-label="A ouvert / dans customer-management — voir ce que l’agent avait sous les yeux"><svg [^>]*>.*?</svg></a><span class="act-time">900 ms</span></div>`,
      ),
    );
    assert.deepEqual(linksOf(html), [`${ADDRESS}?agent=planner`, `${ADDRESS}?look=${PAGE_TOOL}`, `${ADDRESS}?agent=writer`]);
  });

  it("marks the action whose look is open, and its eye, and no other", () => {
    const html = thread(liveWith([...fixtureScript().steps, ...REVIEWED]), PAGE_TOOL);
    assert.match(
      html,
      new RegExp(
        `<div class="act selected"><details>.{0,900}<a id="look-eye-${PAGE_TOOL}" class="act-look" href="${ADDRESS}\\?look=${PAGE_TOOL}" aria-current="true" aria-label=`,
      ),
    );
    assert.equal(countOf(html, /class="act selected"/g), 1);
    assert.equal(countOf(html, /aria-current/g), 1);
    assert.doesNotMatch(thread(), /act selected|aria-current/);
  });

  it("marks an action that passed, and gives no link to one that looked at nothing", () => {
    assert.match(
      thread(),
      /<div class="act"><details><summary class="act-line"><span class="act-state ok" role="img" aria-label="réussi"><\/span><svg [^>]*>.*?<\/svg><span class="act-title">A proposé un plan de 1 scénario\(s\)<\/span><\/summary><pre class="act-result">The plan was accepted: search\.<\/pre><\/details><span class="act-time">40 ms<\/span><\/div>/,
    );
  });

  it("shows an action whose tool has not answered as running, without a duration, an answer or a link", () => {
    assert.match(
      thread(),
      /<div class="act"><div class="act-line"><span class="spinner" role="img" aria-label="en cours"><\/span><svg [^>]*>.*?<\/svg><span class="act-title">A joué le test<\/span><\/div><\/div>/,
    );
    const replayed = thread(replayAt(PAGE_TOOL, 1));
    assert.match(
      replayed,
      /<div class="act"><div class="act-line"><span class="spinner" role="img" aria-label="en cours"><\/span><svg [^>]*>.*?<\/svg><span class="act-title">A ouvert \/ dans customer-management<\/span><\/div><\/div>/,
    );
    assert.deepEqual(linksOf(replayed), [`${ADDRESS}?agent=planner`]);
    assert.doesNotMatch(replayed, /act-result|act-time|act selected|<details><summary/);
  });

  it("stops the spinner of an action whose tool never answered once the session ended", () => {
    const html = thread(liveOf(COMPLETED));
    assert.doesNotMatch(html, /class="spinner"/);
    assert.match(
      html,
      /<div class="act"><div class="act-line"><span class="act-state" aria-hidden="true"><\/span><svg [^>]*>.*?<\/svg><span class="act-title">A joué le test<\/span><\/div><\/div>/,
    );
  });

  it("marks an action that failed, and links a file an agent handed in even when its tool answered nothing", () => {
    const html = thread(liveWith(REVIEWED));
    assert.match(
      html,
      /<div class="act"><details><summary class="act-line"><span class="act-state ko" role="img" aria-label="échec"><\/span><svg [^>]*>.*?<\/svg><span class="act-title">A joué le test<\/span><\/summary><pre class="act-result">1 failed<\/pre><\/details><\/div>/,
    );
    assert.match(
      html,
      new RegExp(
        `<div class="act"><div class="act-line"><span class="act-state" aria-hidden="true"></span><svg [^>]*>.*?</svg><span class="act-title">A remis le test</span></div><a id="look-eye-5" class="act-look" href="${ADDRESS}\\?look=5" aria-label="A remis le test — voir ce que l’agent avait sous les yeux">`,
      ),
    );
    assert.deepEqual(linksOf(html), [`${ADDRESS}?agent=planner`, `${ADDRESS}?agent=writer`, `${ADDRESS}?look=5`]);
    assert.doesNotMatch(html, /act-time/);
  });

  it("tells whom the harness hands the work to, its request folded under it, open while it is written", () => {
    const html = thread();
    assert.match(textOf(html), /Harnais passe la main à Planificateur 14:44:10 This plan is of the level smoke alone\./);
    assert.match(
      html,
      /<details class="brief"><summary><span class="speaker-mark sm tone-neutral" aria-hidden="true">.*?<\/span><span><b>Harnais<\/b> passe la main à <b>Planificateur<\/b><\/span><span class="turn-at">14:44:10<\/span><\/summary><p class="brief-text">This plan is of the level smoke alone\.<\/p><\/details>/,
    );
    const written = thread(replayAt(BRIEF, 3));
    assert.match(written, /<details class="brief" open=""><summary>/);
    assert.match(written, /<p class="brief-text">This plan is<\/p>/);
  });

  it("shows a note of the harness alone as a line", () => {
    assert.match(
      thread(),
      /<div class="notes single"><svg [^>]*>.*?<\/svg><span class="note-text">The configuration is valid; the run targets the environment local\.<\/span><\/div>/,
    );
  });

  it("folds the notes of the harness that follow one another under their count and the last of them, each with its time", () => {
    const html = thread(liveWith([note("The source was read.", 1), note("The card was written.", 2), note("The index is ready.", 3)]));
    assert.match(
      html,
      /<details class="notes"><summary><svg [^>]*>.*?<\/svg><span>3 notes du harnais<\/span><span class="note-preview" aria-hidden="true">The index is ready\.<\/span><\/summary><ul><li><span class="turn-at">09:00:01<\/span> The source was read\.<\/li><li><span class="turn-at">09:00:02<\/span> The card was written\.<\/li><li><span class="turn-at">09:00:03<\/span> The index is ready\.<\/li><\/ul><\/details>/,
    );
    assert.doesNotMatch(html, /notes single/);
    const apart = thread(liveWith([note("The source was read.", 1), REVIEWED[1]!, note("The card was written.", 2)]));
    assert.equal(countOf(apart, /<div class="notes single">/g), 2);
    assert.doesNotMatch(apart, /notes du harnais/);
  });

  it("shows a verdict of the harness with the gate that refused, and an accepted one without", () => {
    const html = thread();
    assert.match(textOf(html), /Harnais refusé PLAN-ELEMENT Plan 14:44:17 The plan was refused by the harness: name an element\./);
    assert.match(
      html,
      /<article class="verdict refused"><header class="verdict-head"><div class="lead"><span class="speaker-mark sm tone-neutral" aria-hidden="true">.*?<\/span><b>Harnais<\/b><span class="badge ko">refusé<\/span><span class="verdict-code">PLAN-ELEMENT<\/span><span class="turn-role">Plan<\/span><\/div><span class="turn-at">14:44:17<\/span><\/header><p class="verdict-text">/,
    );
    const accepted = thread(liveWith(REVIEWED));
    assert.match(accepted, /<article class="verdict accepted">.{0,600}<span class="badge ok">accepté<\/span><span class="turn-role">Plan<\/span>/);
    assert.doesNotMatch(accepted, /verdict-code/);
  });

  it("lists the scenarios of an accepted plan under their count", () => {
    assert.match(textOf(thread()), /Plan accepté par le harnais 1 scénario\(s\) 14:44:16 smoke Search a customer nominal · customer-management/);
    const html = thread(liveWith(REVIEWED));
    assert.match(
      textOf(html),
      /Plan accepté par le harnais 2 scénario\(s\) 09:00:03 P0 Search a customer smoke · \/customers P1 Open a customer smoke · \/customers\/1/,
    );
    assert.match(
      html,
      /<section class="result-card"><header><div class="lead"><span class="act-state ok" aria-hidden="true"><\/span><b>Plan accepté par le harnais<\/b>/,
    );
    assert.match(
      html,
      /<div class="result-row"><span class="badge neutral">P0<\/span><span class="result-title">Search a customer<\/span><span class="turn-role">smoke · \/customers<\/span><\/div>/,
    );
  });

  it("opens a pass with what it makes of the request when it says it, a part of a pass marked apart", () => {
    assert.match(
      thread(liveWith(REVIEWED)),
      /<div class="pass" role="separator" aria-label="Plan · smoke · le chemin le plus court"><span class="pass-title">Plan · smoke<\/span><span class="pass-summary">le chemin le plus court<\/span><\/div>/,
    );
    assert.match(
      thread(),
      /<div class="pass minor" role="separator" aria-label="Écriture d’un test · search"><span class="pass-title">Écriture d’un test<\/span><span class="pass-summary">search<\/span><\/div>/,
    );
    assert.match(thread(), /<div class="pass" role="separator" aria-label="Configuration"><span class="pass-title">Configuration<\/span><\/div>/);
  });

  it("ends on the verdict of each test: passed, failed, blocked, or as the harness wrote it", () => {
    const html = thread(liveWith(REVIEWED));
    assert.match(
      textOf(html),
      /Verdict de l’exécution : 4 test\(s\) réussi Search a customer smoke échoué Open a customer The heading never showed\. bloqué Delete a customer skipped Export the customers$/,
    );
    assert.match(html, /<section class="result-card outcome"><header><b>Verdict de l’exécution : 4 test\(s\)<\/b><\/header>/);
    assert.match(
      html,
      /<div class="result-row"><span class="badge ok">réussi<\/span><span class="result-title">Search a customer<\/span><span class="turn-role">smoke<\/span><\/div>/,
    );
    assert.match(html, /<span class="badge ko">échoué<\/span>/);
    assert.match(html, /<span class="badge warn">bloqué<\/span><span class="result-title">Delete a customer<\/span><span class="turn-role"><\/span><\/div>/);
    assert.match(html, /<span class="badge warn">skipped<\/span>/);
    assert.match(textOf(thread(liveOf(COMPLETED))), /Verdict de l’exécution : 1 test\(s\) réussi Rechercher un client par son nom Every attempt passed\.$/);
  });

  it("keeps a kind of step or an agent when asked, and its links keep what the address holds", () => {
    const { frame } = liveOf();
    const kept = render(
      createElement(Thread, {
        path: PATH,
        frame,
        lookIndex: undefined,
        filter: "actions",
        followed: "planner",
        query: { show: "actions", agent: "planner" },
        stage: "live",
      }),
    );
    assert.deepEqual(linksOf(kept), [`${ADDRESS}?show=actions`, `${ADDRESS}?show=actions&agent=planner&look=${PAGE_TOOL}`]);
    assert.doesNotMatch(kept, /act selected|class="turn-text"|class="thinking"|class="brief"|A joué le test/);
    assert.equal(countOf(kept, /<article class="turn">/g), 1);
    assert.match(kept, /Écriture d’un test/);
  });

  it("names an agent once for the steps a filter leaves in a row", () => {
    const steps: readonly Step[] = [REVIEWED[4]!, note("The test ran.", 5), REVIEWED[5]!];
    const { frame } = liveWith(steps);
    assert.equal(countOf(thread(liveWith(steps)), /<article class="turn">/g), 2);
    const kept = render(createElement(Thread, { path: PATH, frame, lookIndex: undefined, filter: "actions", stage: "ended" }));
    assert.equal(countOf(kept, /<article class="turn">/g), 1);
  });
});

describe("what an agent looked at", () => {
  it("is a file with its lines, an empty one kept as a line, or a text with its excerpt", () => {
    const code = render(createElement(LookView, { look: { kind: "code", file: "a.spec.ts", lines: ["one", "", "three"], caption: "The test." } }));
    assert.match(code, /<span class="look-line">one<\/span><span class="look-line"> <\/span><span class="look-line">three<\/span>/);
    const document = render(createElement(LookView, { look: { kind: "document", source: "the card", excerpt: ["A rule."], caption: "What is known." } }));
    assert.equal(textOf(document), "the card A rule. What is known.");
  });
});

describe("the panel of a look", () => {
  /** The panel of the look of the page the planner opened, closed by the address of the session. */
  const panel = (): string => {
    const look = { kind: "document", source: "http://localhost:3020/", excerpt: ['- heading "Customers"'], caption: "La page." } as const;
    return render(createElement(LookPanel, { opened: { index: PAGE_TOOL, action: "A ouvert / dans customer-management", look }, close: ADDRESS }));
  };

  it("is a dialog that does not hold the keyboard, named by its title and by the action it belongs to", () => {
    const html = panel();
    assert.match(html, /^<section class="look-panel" role="dialog" aria-modal="false" aria-labelledby="look-panel-title look-panel-action">/);
    assert.match(html, /<h2 id="look-panel-title" tabindex="-1">Sous les yeux de l’agent<\/h2>/);
    assert.match(html, /<p id="look-panel-action" class="look-panel-action">A ouvert \/ dans customer-management<\/p>/);
    assert.equal(textOf(html), 'Sous les yeux de l’agent A ouvert / dans customer-management http://localhost:3020/ - heading "Customers" La page.');
  });

  it("is closed by a link to the address it is given, named « Fermer »", () => {
    const html = panel();
    assert.match(html, new RegExp(`<a class="look-panel-close" href="${ADDRESS}" aria-label="Fermer"><svg [^>]*aria-hidden="true">`));
    assert.deepEqual(linksOf(html), [ADDRESS]);
  });
});

describe("the composer of a session", () => {
  it("is a form: a field of several lines labelled for who cannot see it, and a button that sends, named « Envoyer »", () => {
    const html = composer();
    assert.match(
      html,
      /^<form class="composer"><div class="composer-field"><label class="sr-only" for="composer-message">Dites aux agents ce qu’il faut corriger<\/label><textarea id="composer-message" name="message" rows="2" placeholder="Dites aux agents ce qu’il faut corriger…"><\/textarea><button type="submit" class="btn primary"><svg width="16" height="16" [^>]*><path d="M4 12l16-8-6 16-3-7z"\/><\/svg><span class="btn-label">Envoyer<\/span><\/button><\/div><\/form>$/,
    );
    assert.doesNotMatch(html, /disabled|role="alert"/);
  });

  it("lets nothing be written nor sent while a message is on its way", () => {
    const html = composer({ state: "sending" });
    assert.match(html, /<textarea id="composer-message" name="message" rows="2" disabled=""/);
    assert.match(html, /<button type="submit" class="btn primary" disabled="">/);
  });

  it("says under the field why the instance refused a message, as an alert the field is described by, and takes messages again", () => {
    const html = composer({ state: "refused", message: "La session vient de se terminer : elle ne prend plus de message." });
    assert.match(html, /<textarea [^>]*aria-describedby="composer-refused">/);
    assert.match(
      html,
      /<\/div><p id="composer-refused" class="composer-refused" role="alert">La session vient de se terminer : elle ne prend plus de message\.<\/p><\/form>$/,
    );
    assert.doesNotMatch(html, /disabled/);
  });
});

/** What a session holds before it started: what was asked. */
const ASKED = numbered([{ type: "user_message", text: "tester la recherche d'un client" }]);

describe("the stop of a session", () => {
  const STOP = "?stop=ask";
  const stoppedWith = (stopping: LiveSession["stopping"], query = STOP, session: Session = RUNNING) => screen(query, { ...liveOf(session), stopping });

  it("is offered in the bar of a session that runs or waits its turn, by a link to its confirmation, and never once the session ended", () => {
    for (const session of [RUNNING, QUEUED]) {
      assert.deepEqual(
        linksOf(screen("?show=talk", liveOf(session))).filter((href) => href.includes("stop=")),
        [`${ADDRESS}?show=talk&stop=ask`],
      );
    }
    for (const session of [COMPLETED, INTERRUPTED, STOPPED]) {
      for (const query of ["", STOP]) assert.doesNotMatch(screen(query, liveOf(session)), /Arrêter|session-stop/, session.state);
    }
    assert.doesNotMatch(screen("", liveOf(RUNNING, { following: false, tick: 30 })), /id="session-stop"/);
  });

  it("stops nothing by itself: the screen holds no button that stops until the address opens the confirmation", () => {
    assert.doesNotMatch(screen(), /class="session-stop"|Arrêter la session/);
    assert.deepEqual(pressed(), ["restart"]);
    assert.deepEqual(pressed({}, STOP), ["restart", "stop"]);
  });

  it("is confirmed under the bar: what stopping does, the way out first, then the button that stops", () => {
    const html = screen(`?show=talk&stop=ask`);
    assert.match(
      html,
      /<\/div><section class="session-stop" aria-labelledby="session-stop-title"><h2 id="session-stop-title" class="session-stop-title">Arrêter cette session \?<\/h2><p class="session-stop-note">Ses agents s’arrêtent dès qu’ils rendent la main, et la session ne reprend pas\. Ce qu’ils ont écrit reste dans le dépôt de tests\.<\/p><div class="session-stop-actions"><a id="session-stop-cancel" class="btn" href="#\/agent\/sessions\/[^"?]+\?show=talk">Annuler<\/a><button type="button" class="btn danger">Arrêter la session<\/button><\/div><\/section><div class="pass-stepper"/,
    );
    assert.doesNotMatch(html, /role="alert"/);
    assert.match(screen(STOP, liveOf(QUEUED, {}, ASKED)), /class="session-stop"/);
    assert.match(screen(STOP, liveOf(RUNNING, { following: false, tick: 30 })), /class="session-stop"/);
  });

  it("cannot be asked twice while the request is on its way, and says why the instance refused, the button free to ask again", () => {
    assert.match(stoppedWith({ state: "sending" }), /<button type="button" class="btn danger" disabled="">Arrêter la session<\/button>/);
    const refused = stoppedWith({ state: "refused", message: "L’instance ne répond pas." });
    assert.match(
      refused,
      /<button type="button" class="btn danger">Arrêter la session<\/button><\/div><p class="session-stop-refused" role="alert">L’instance ne répond pas\.<\/p><\/section>/,
    );
  });

  it("says in the bar that the stop was asked once the instance took it, the session still going on, and offers it no more", () => {
    for (const query of ["", STOP]) {
      const html = stoppedWith({ state: "asked" }, query);
      assert.match(
        html,
        /<span id="session-stop" class="session-stopping" role="status" tabindex="-1">arrêt demandé…<\/span><button type="button" class="btn ghost sm">/,
      );
      assert.match(textOf(html), /en direct 2026-11-15 · 14:44:06 UTC · 2 action\(s\) arrêt demandé… Rejouer/);
      assert.doesNotMatch(html, /class="session-stop"|Arrêter/);
    }
    assert.doesNotMatch(stoppedWith({ state: "asked" }, "", INTERRUPTED), /arrêt demandé|session-stop/);
  });
});

describe("the screen of a session", () => {
  it("lets the person speak to the agents under the thread while they work or are waited for, in a replay too, and not once the session ended", () => {
    assert.match(screen(), /<\/section><form class="composer">.*<\/form><div class="session-end"><\/div><\/div>/);
    assert.match(screen("", liveOf(QUEUED, {}, ASKED)), /<\/section><form class="composer">.*<\/form><div class="session-end"><\/div><\/div>/);
    assert.match(screen("", liveOf(RUNNING, { following: false, tick: 30 })), /<form class="composer">/);
    for (const ended of [COMPLETED, INTERRUPTED, { ...RUNNING, state: "archived" as Session["state"] }]) {
      const html = screen("", liveOf(ended));
      assert.doesNotMatch(html, /composer|textarea|Envoyer/);
      assert.match(html, /<\/section><div class="session-end"><\/div><\/div>/);
    }
  });

  it("shows in its composer where the message sent is, and ties its form and its field to what sends it", () => {
    const live = liveOf();
    assert.match(screen("", { ...live, saying: { state: "sending" } }), /<textarea [^>]*disabled=""/);
    assert.match(textOf(screen("", { ...live, saying: { state: "refused", message: "L’instance ne répond pas." } })), /Envoyer L’instance ne répond pas\.$/);
    const calls: string[] = [];
    const controls: SessionControls = { ...NO_CONTROLS, say: () => calls.push("say"), sayOnEnter: () => calls.push("sayOnEnter") };
    const element = screenOf("", { ...live, controls });
    (elementsOf(element, "form")[0]!["onSubmit"] as () => void)();
    (elementsOf(element, "textarea")[0]!["onKeyDown"] as () => void)();
    assert.deepEqual(calls, ["say", "sayOnEnter"]);
  });

  it("is headed by what was asked, and leads back to the sessions of the project", () => {
    const html = screen();
    assert.match(textOf(html), /^lakeside-tests \/ Agent \/ tester la recherche d'un client tester la recherche d'un client /);
    assert.equal(linksOf(html)[0], "#/agent");
  });

  it("follows a session whose agents work: its state, its facts in a line, and the offer to replay it", () => {
    const html = screen();
    assert.match(
      html,
      /<div class="session-bar"><span class="badge info">en direct<\/span><span class="session-facts">2026-11-15 · 14:44:06 UTC · 2 action\(s\)<\/span><a id="session-stop" class="btn ghost sm" href="#\/agent\/sessions\/[^"?]+\?stop=ask"><svg [^>]*><rect [^>]*\/><\/svg> Arrêter<\/a><button type="button" class="btn ghost sm"><svg [^>]*>.*?<\/svg> Rejouer<\/button><\/div>/,
    );
    assert.match(textOf(html), /en direct 2026-11-15 · 14:44:06 UTC · 2 action\(s\) Arrêter Rejouer ✓ Configuration/);
    assert.match(html, /<div class="content"><div class="session"><div class="session-bar">/);
    assert.doesNotMatch(html, /disabled|role="progressbar"|session-bar replay/);
    assert.deepEqual(pressed(), ["restart"]);
  });

  it("says the stream of the events is reconnecting in place of the facts, whether the session goes on or not", () => {
    for (const session of [RUNNING, COMPLETED]) {
      const html = screen("", { ...liveOf(session), stream: "reconnecting" });
      assert.match(html, /<span class="session-facts">connexion au flux interrompue, nouvelle tentative…<\/span>/);
      assert.match(textOf(html), /connexion au flux interrompue, nouvelle tentative… (Arrêter )?Rejouer/);
      assert.doesNotMatch(html, /14:44:06 UTC/);
    }
    assert.doesNotMatch(screen("", { ...liveOf(), stream: "connecting" }), /connexion au flux interrompue/);
  });

  it("adds what an ended session knows: its duration, its model requests and its branch", () => {
    assert.match(
      textOf(screen("", liveOf(COMPLETED))),
      /tests réussis 2026-11-15 · 14:44:06 UTC · 1 min 54 s · 3 action\(s\) · 50 requêtes au modèle · oqas\/design-20261115T144408Z Rejouer/,
    );
    assert.match(textOf(screen("", liveOf(STOPPED))), /arrêtée avant la fin 2026-11-15 · 14:44:06 UTC · 42 s · 3 action\(s\) · 3 requêtes au modèle Rejouer/);
  });

  it("tells only the opening and the actions of a session that has no result", () => {
    const interrupted = screen("", liveOf(INTERRUPTED));
    assert.match(textOf(interrupted), /interrompue 2026-11-15 · 14:44:06 UTC · 3 action\(s\) Rejouer/);
    assert.match(interrupted, /<div class="session-bar"><span class="badge warn">interrompue<\/span>/);
    const untold = screen("", liveOf({ ...RUNNING, state: "completed" }));
    assert.match(
      untold,
      /<div class="session-bar"><span class="badge neutral">terminée<\/span><span class="session-facts">2026-11-15 · 14:44:06 UTC · 3 action\(s\)<\/span>/,
    );
  });

  it("counts the knowledge sources the agents read, each once, among the facts of a session that read some", () => {
    const written = liveWith([{ kind: "say", from: "cartographer", at: "09:00:00", text: "Je lis les sources." }], INTERRUPTED, ["specification", "tickets"]);
    assert.match(textOf(screen("", written)), /interrompue 2026-11-15 · 14:44:06 UTC · 2 source\(s\) de connaissance lue\(s\) · 0 action\(s\) Rejouer/);
    const events = numbered([
      { type: "phase_started", phase: "survey" },
      { type: "phase_started", phase: "card", source: "orders-db" },
      { type: "phase_started", phase: "card", source: "specs" },
      { type: "phase_started", phase: "card", source: "orders-db" },
      { type: "agent_message", agent: "cartographer", text: "I read the sources.", reasoning: false },
    ]);
    assert.match(textOf(screen("", liveOf(RUNNING, {}, events))), /UTC · 2 source\(s\) de connaissance lue\(s\) · 0 action\(s\) Arrêter Rejouer/);
    assert.doesNotMatch(screen(), /source\(s\)/);
  });

  it("offers no replay of a session that has no event", () => {
    assert.match(screen("", liveWith([], RUNNING)), /<button type="button" class="btn ghost sm" disabled="">/);
  });

  it("replays a session at the pace asked: stopped or going, its speed, and how far it is", () => {
    const stopped = screen("", liveOf(RUNNING, { following: false, tick: endOf(fixtureScript()) / 4 }));
    assert.match(textOf(stopped), /Reprendre Décision suivante × 1 Revenir au direct ✓ Configuration/);
    assert.match(stopped, /<div class="session-bar replay"><button type="button" class="btn primary sm">/);
    assert.match(
      stopped,
      /role="progressbar" aria-label="Avancement de la relecture" aria-valuemin="0" aria-valuemax="100" aria-valuenow="25"><i style="width:25%"><\/i>/,
    );
    assert.match(stopped, /<path d="M6 4l14 8-14 8z"\/><\/svg><span class="btn-label">Reprendre<\/span><\/button>/);
    assert.match(stopped, /<button type="button" class="btn ghost sm" aria-label="Aller à la prochaine décision du harnais">/);
    assert.match(stopped, /<button type="button" class="btn ghost sm playback-speed" aria-label="Changer la vitesse">× 1<\/button>/);
    const going = screen("", liveOf(RUNNING, { following: false, tick: 30, playing: true, speed: 4 }));
    assert.match(textOf(going), /Pause Décision suivante × 4 Revenir au direct/);
    assert.match(going, /<path d="M7 4v16M17 4v16"\/><\/svg><span class="btn-label">Pause<\/span><\/button>/);
    assert.doesNotMatch(going, /Rejouer|session-facts/);
  });

  it("ties each button of a replay to its control", () => {
    assert.deepEqual(pressed({ following: false, tick: 30 }), ["toggle", "skip", "faster", "follow"]);
  });

  it("says in its bar that a queued session waits for an agent, and names nobody at work under what was asked", () => {
    const html = screen("", liveOf(QUEUED, {}, ASKED));
    assert.match(html, /<span class="badge outline">en file<\/span>/);
    assert.match(textOf(html), /en file 2026-11-15 · 14:44:06 UTC · en attente d’un agent · 0 action\(s\) Arrêter Rejouer /);
    assert.doesNotMatch(html, /class="working"|travaille/);
    assert.match(textOf(screen("", liveOf(QUEUED, { following: false, tick: 30 }, ASKED))), /× 1 Tout afficher/);
  });

  it("leads from a replay back to the live session, or to the whole of an ended one", () => {
    assert.match(textOf(screen("", liveOf(RUNNING, { following: false, tick: 30 }))), /× 1 Revenir au direct/);
    assert.match(textOf(screen("", liveOf(COMPLETED, { following: false, tick: 30 }))), /× 1 Tout afficher ✓ Configuration/);
    assert.doesNotMatch(screen("", liveOf(COMPLETED, { following: false, tick: 30 })), /Revenir au direct/);
  });

  it("shows where the session is with its passes, each but the last tied to the next, the parts of a pass left out", () => {
    assert.match(textOf(screen()), /✓ Configuration 2 Plan · smoke Tout Échanges Actions Verdicts du harnais/);
    assert.match(textOf(screen("", liveOf(COMPLETED))), /✓ Configuration ✓ Plan · smoke Tout/);
    assert.match(
      screen("", replayAt(REASONING, 0)),
      /<span class="s done"><span class="n">✓<\/span>Configuration<\/span><span class="sep"><\/span><\/span><span class="pass-step"><span class="s cur"><span class="n">2<\/span>Plan · smoke<\/span><\/span><\/div>/,
    );
    assert.match(
      screen("", replayAt(0, 0)),
      /<span class="s cur"><span class="n">1<\/span>Configuration<\/span><span class="sep"><\/span><\/span><span class="pass-step"><span class="s"><span class="n">2<\/span>Plan · smoke<\/span><\/span><\/div>/,
    );
  });

  it("keeps of the thread what its address asks: a kind of step, an agent, or both, and its links keep them", () => {
    const verdicts = screen("?show=verdicts");
    assert.doesNotMatch(verdicts, /class="act/);
    assert.match(verdicts, new RegExp(`<a class="chip on" href="${ADDRESS}\\?show=verdicts" aria-current="true">Verdicts du harnais</a>`));
    assert.ok(linksOf(screen("?show=talk")).includes(`${ADDRESS}?show=talk&agent=planner`));
    const followed = screen("?show=actions&agent=planner");
    assert.doesNotMatch(followed, /A joué le test/);
    assert.ok(linksOf(followed).includes(`${ADDRESS}?show=actions&agent=planner&look=${PAGE_TOOL}`));
    assert.ok(linksOf(followed).includes(`${ADDRESS}?show=talk&agent=planner`));
    assert.match(followed, new RegExp(`<a class="turn-agent" href="${ADDRESS}\\?show=actions" aria-label="Planificateur : voir tous les agents">`));
    assert.match(
      followed,
      new RegExp(`<a class="chip on followed-chip" href="${ADDRESS}\\?show=actions" aria-label="Ne plus suivre Planificateur">Planificateur ×</a>`),
    );
  });

  it("takes an unknown filter for none, and follows nobody for an unknown agent or for the person", () => {
    const agentOnly = screen("?agent=writer&show=nothing");
    assert.match(agentOnly, new RegExp(`<a class="chip on" href="${ADDRESS}\\?agent=writer" aria-current="true">Tout</a>`));
    assert.match(agentOnly, new RegExp(`<a class="chip on followed-chip" href="${ADDRESS}" aria-label="Ne plus suivre Rédacteur">`));
    assert.doesNotMatch(screen("?agent=nobody"), /followed-chip/);
    assert.doesNotMatch(screen("?agent=user"), /followed-chip/);
  });

  it("is its thread alone by default: no panel, no action marked, and nothing but the thread to switch to", () => {
    const html = screen();
    assert.doesNotMatch(html, /look-panel|role="dialog"|Sous les yeux de l’agent|act selected|aria-current="true"[^>]*class="act-look"/);
    assert.doesNotMatch(html, /Regard|Vues de la session|view=/);
    assert.ok(linksOf(html).includes(`${ADDRESS}?look=${PAGE_TOOL}`));
  });

  it("opens from the address the look of the action it names, marks that action, and closes by the same address without it", () => {
    const live = liveWith([...fixtureScript().steps, ...REVIEWED]);
    const page = screen(`?look=${PAGE_TOOL}`, live);
    assert.match(textOf(page), /Sous les yeux de l’agent A ouvert \/ dans customer-management http:\/\/localhost:3020\/ - heading "Customers"/);
    assert.match(page, new RegExp(`<div class="act selected"><details>.{0,900}<a id="look-eye-${PAGE_TOOL}" class="act-look"`));
    assert.equal(countOf(page, /class="act selected"/g), 1);
    assert.match(page, new RegExp(`<a class="look-panel-close" href="${ADDRESS}" aria-label="Fermer">`));
    assert.match(page, /<\/section><div class="session-end"><\/div><section class="look-panel" role="dialog"/);
    const file = screen(`?look=${fixtureScript().steps.length + 5}`, live);
    assert.match(
      textOf(file),
      /Sous les yeux de l’agent A remis le test search-customer\.spec\.ts test\('search', async \(\) => \{\}\); Le test que l’agent a remis\.$/,
    );
  });

  it("keeps the filter and the agent of the address in the eyes of the thread and in the link that closes the look", () => {
    const links = linksOf(screen(`?show=actions&agent=planner&look=${PAGE_TOOL}`));
    assert.ok(links.includes(`${ADDRESS}?show=actions&agent=planner&look=${PAGE_TOOL}`));
    assert.equal(links.at(-1), `${ADDRESS}?show=actions&agent=planner`);
    assert.ok(linksOf(screen("?show=actions")).includes(`${ADDRESS}?show=actions&look=${PAGE_TOOL}`));
  });

  it("opens nothing for an address whose look names no action that looked at something", () => {
    const live = liveWith([...fixtureScript().steps, ...REVIEWED]);
    for (const query of ["?look=7", "?look=3", "?look=99", "?look=page", "?look=", "?look=-1", `?look=${PAGE_TOOL}.0`]) {
      assert.doesNotMatch(screen(query, live), /look-panel|act selected/, query);
    }
  });

  it("keeps open, while the session is replayed, the look of an action the replay has not reached yet", () => {
    const early = screen(`?look=${PAGE_TOOL}`, replayAt(REASONING, 0));
    assert.match(textOf(early), /Sous les yeux de l’agent A ouvert \/ dans customer-management http:\/\/localhost:3020\//);
    assert.doesNotMatch(early, /act selected|look-eye/);
    const running = screen(`?look=${PAGE_TOOL}`, replayAt(PAGE_TOOL, 1));
    assert.match(running, /<div class="act selected"><div class="act-line"><span class="spinner"/);
    assert.doesNotMatch(running, /look-eye/);
  });
});
