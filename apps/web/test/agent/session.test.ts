import assert from "node:assert/strict";
import { createElement, type ReactNode } from "react";
import type { PlanScenario, Session, SessionEvent, SessionScript, Step } from "@open-qa-stack/domain/sessions";
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
import { nameApplications } from "../../src/applications/application-names.ts";
import { COMPLETED, EVENTS, fixtureScript, liveOf, NO_CONTROLS, numbered, QUEUED, REFUSAL, RUNNING, SESSION_ID } from "./session-fixture.ts";

const PATH = `/agent/sessions/${SESSION_ID}`;

/** What a thread needs of a person who unfolded no long text. */
const UNREAD = { unfolded: [], onUnfold: NO_CONTROLS.unfold } as const;
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
  { kind: "pass", at: "09:00:00", title: "Plan · Vérification rapide", summary: "le chemin le plus court" },
  { kind: "say", from: "planner", to: "harness", at: "09:00:01", text: "Voici le plan." },
  {
    kind: "verdict",
    at: "09:00:02",
    accepted: true,
    about: "Plan",
    text: "Le plan tient sur ce que l’agent a vu.",
    reason: "Le plan tient sur ce que l’agent a vu.",
  },
  {
    kind: "plan",
    at: "09:00:03",
    title: "Plan accepté par le harnais",
    scenarios: [
      { id: "search", title: "Search a customer", level: "smoke", application: "shop", refusals: [] },
      { id: "open", title: "Open a customer", level: "smoke", refusals: [] },
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
    title: "Verdict de l’exécution : 4 tests",
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
    unfolded: [],
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
 * @param ended - Whether the session ended; it goes on by default.
 * @returns Its HTML.
 */
function composer(saying: Sending = { state: "idle" }, ended = false): string {
  return render(createElement(Composer, { saying, ended, onSay: NO_CONTROLS.say, onKey: NO_CONTROLS.sayOnEnter }));
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
  return render(
    createElement(Thread, {
      path: PATH,
      frame: live.frame,
      lookIndex,
      stage: live.script.stage,
      unfolded: live.unfolded,
      onUnfold: NO_CONTROLS.unfold,
    }),
  );
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

  it("is a labelled region whose turns come one under another, what an ended session came to first", () => {
    const html = thread();
    assert.match(
      html,
      /^<section class="thread" aria-label="Fil de la session"><div class="thread-item"><div class="pass" role="separator" aria-label="Configuration">/,
    );
    assert.equal(countOf(html, /<div class="thread-item">/g), 10);
    assert.match(
      thread(liveOf(COMPLETED)),
      /^<section class="thread" aria-label="Fil de la session"><div class="thread-item"><section class="result-card outcome">/,
    );
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
            ...UNREAD,
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

  it("names an agent once, with its role and the time it came in, for all it thinks, says and does in a row, its actions in a row folded under their count and time", () => {
    const html = thread();
    const text = textOf(html);
    assert.equal(countOf(html, /<article class="turn">/g), 2);
    assert.match(
      text,
      /Planificateur explore l’application et propose le plan 14:44:11 Réflexion I should open the application first\. I should open the application first\. 2 actions 940 ms A ouvert \/ dans customer-management \{"url":"http:\/\/localhost:3020\/"\} 900 ms A proposé un plan de 1 scénario The plan was accepted: search\. 40 ms /,
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
    const talk = render(createElement(Thread, { ...UNREAD, path: PATH, frame, lookIndex: undefined, filter: "talk", query: { show: "talk" }, stage: "live" }));
    assert.deepEqual(linksOf(talk), [`${ADDRESS}?show=talk&agent=planner`, `${ADDRESS}?show=talk&agent=writer`]);
  });

  it("makes the name of the agent the thread follows the link that brings the others back", () => {
    const { frame } = liveOf();
    const followed = render(
      createElement(Thread, {
        ...UNREAD,
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
        `<div class="act"><details><summary class="act-line"><span class="act-state" aria-hidden="true"></span><svg [^>]*>.*?</svg><span class="act-title">A ouvert / dans customer-management</span></summary><pre class="act-result">\\{&quot;url&quot;:&quot;http://localhost:3020/&quot;\\}</pre></details><a id="look-eye-${PAGE_TOOL}" class="act-look" href="${ADDRESS}\\?look=${PAGE_TOOL}" aria-label="A ouvert / dans customer-management — voir la page consultée"><svg [^>]*>.*?</svg></a><span class="act-time">900\u202fms</span></div>`,
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
      /<div class="act"><details><summary class="act-line"><span class="act-state ok" role="img" aria-label="Réussi"><\/span><svg [^>]*>.*?<\/svg><span class="act-title">A proposé un plan de 1 scénario<\/span><\/summary><pre class="act-result">The plan was accepted: search\.<\/pre><\/details><span class="act-time">40\u202fms<\/span><\/div>/,
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

  it("marks an action that failed, and links a file an agent handed in even when its tool answered nothing, the file folded under its path", () => {
    const html = thread(liveWith(REVIEWED));
    assert.match(
      html,
      /<div class="act"><details><summary class="act-line"><span class="act-state ko" role="img" aria-label="échec"><\/span><svg [^>]*>.*?<\/svg><span class="act-title">A joué le test<\/span><\/summary><pre class="act-result">1 failed<\/pre><\/details><\/div>/,
    );
    assert.match(
      html,
      new RegExp(
        `<div class="act"><details><summary class="act-line"><span class="act-state" aria-hidden="true"></span><svg [^>]*>.*?</svg><span class="act-text"><span class="act-title">A remis le test</span><span class="act-path">search-customer.spec.ts</span></span></summary><pre class="act-code code mono"><span class="code-line">test\\(&#x27;search&#x27;, async \\(\\) =&gt; \\{\\}\\);</span></pre></details><a id="look-eye-5" class="act-look" href="${ADDRESS}\\?look=5" aria-label="A remis le test — voir le fichier de test">`,
      ),
    );
    assert.deepEqual(linksOf(html), [`${ADDRESS}?agent=planner`, `${ADDRESS}?agent=writer`, `${ADDRESS}?look=5`]);
    assert.doesNotMatch(html, /act-time/);
  });

  it("names the test a run plays, with the path of its file, and lets its code be read while it runs", () => {
    const file = { kind: "file", name: "apps/shop/tests/policies-list.spec.ts", lines: ['test("Display the policies list", async () => {', "});"] } as const;
    const running: Step = {
      kind: "tool",
      from: "writer",
      at: "09:00:01",
      tool: "run_test",
      title: "A joué « Display the policies list »",
      look: file,
      subject: "Display the policies list",
      pending: true,
    };
    const html = thread(liveWith([running], RUNNING));
    assert.match(
      html,
      /<div class="act"><details><summary class="act-line"><span class="spinner" role="img" aria-label="en cours"><\/span><svg [^>]*>.*?<\/svg><span class="act-text"><span class="act-title">A joué « Display the policies list »<\/span><span class="act-path">apps\/shop\/tests\/policies-list\.spec\.ts<\/span><\/span><\/summary><pre class="act-code code mono"><span class="code-line">test\(&quot;Display the policies list&quot;, async \(\) =&gt; \{<\/span><span class="code-line">\}\);<\/span><\/pre><\/details><a id="look-eye-0" class="act-look"/,
    );
    assert.doesNotMatch(html, /act-time|act-tests|act-result/);
  });

  it("says how a run ended on its line, and unfolds it on the verdict of each test, the answer of the tool when it did not pass, and the code", () => {
    const file = { kind: "file", name: "a.spec.ts", lines: ["test();"] } as const;
    const passed: Step = {
      kind: "tool",
      from: "writer",
      at: "09:00:01",
      tool: "run_test",
      title: "A joué « a »",
      look: file,
      subject: "a",
      detail: "Run of the file: passed.",
      durationMs: 2400,
      outcome: "passed",
      tests: [{ title: "a", verdict: "passed" }],
    };
    const failed: Step = {
      ...passed,
      detail: "Run of the file: failed.\n  Error: no heading",
      outcome: "failed",
      tests: [
        { title: "a", verdict: "failed" },
        { title: "b", verdict: "timedOut" },
      ],
    };
    const ok = thread(liveWith([passed]));
    assert.match(ok, /<span class="act-title">A joué « a » : Réussi<\/span>/);
    assert.match(
      ok,
      /<\/summary><ul class="act-tests"><li><span class="badge ok">Réussi<\/span><span>a<\/span><\/li><\/ul><pre class="act-code code mono"><span class="code-line">test\(\);<\/span><\/pre><\/details>/,
    );
    assert.match(ok, /<span class="act-time">2,4\u202fs<\/span>/);
    const ko = thread(liveWith([failed]));
    assert.match(ko, /<span class="act-title">A joué « a » : Échoué<\/span>/);
    assert.match(
      ko,
      /<ul class="act-tests"><li><span class="badge ko">Échoué<\/span><span>a<\/span><\/li><li><span class="badge warn">timedOut<\/span><span>b<\/span><\/li><\/ul><pre class="act-result">Run of the file: failed\.\n {2}Error: no heading<\/pre><pre class="act-code code mono">/,
    );
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

  it("shows a note of the harness alone as a line, in the words of the console when it knows its form", () => {
    assert.match(
      thread(),
      /<div class="notes single"><svg [^>]*>.*?<\/svg><span class="note-text">La configuration est valide ; la session vise l’environnement local\.<\/span><\/div>/,
    );
    assert.match(thread(liveWith([note("The harness did something new.", 1)])), /<span class="note-text">The harness did something new\.<\/span>/);
  });

  it("names no path of the machine that ran in the notes of the harness", () => {
    const html = thread(
      liveWith([
        note(
          "The knowledge base /home/me/shop/.oqas/knowledge/knowledge-base.json is complete and made of the cards every source has now, by their fingerprints; it was kept.",
          1,
        ),
      ]),
    );
    assert.match(html, /La base de connaissance est complète et à jour ; elle est conservée\./);
    assert.doesNotMatch(html, /\/home\//);
  });

  it("folds the notes of the harness that follow one another under their count and the last of them, each with its time", () => {
    const html = thread(liveWith([note("The source was read.", 1), note("The card was written.", 2), note("The knowledge base is ready.", 3)]));
    assert.match(
      html,
      /<details class="notes"><summary><svg [^>]*>.*?<\/svg><span>3 notes du harnais<\/span><span class="note-preview" aria-hidden="true">The knowledge base is ready\.<\/span><\/summary><ul><li><span class="turn-at">09:00:01<\/span> The source was read\.<\/li><li><span class="turn-at">09:00:02<\/span> The card was written\.<\/li><li><span class="turn-at">09:00:03<\/span> The knowledge base is ready\.<\/li><\/ul><\/details>/,
    );
    assert.doesNotMatch(html, /notes single/);
    const apart = thread(liveWith([note("The source was read.", 1), REVIEWED[1]!, note("The card was written.", 2)]));
    assert.equal(countOf(apart, /<div class="notes single">/g), 2);
    assert.doesNotMatch(apart, /notes du harnais/);
  });

  it("folds a row of notes alike under one line that counts their sources, alone or among other notes, each note in the words of the console", () => {
    const alike: Step = {
      kind: "repeated",
      at: "09:00:01",
      before: "The card of ",
      after: " is up to date; it was kept.",
      sources: ["orders-api", "orders-db"],
      notes: [
        { kind: "note", at: "09:00:01", text: "The card of orders-api is up to date; it was kept." },
        { kind: "note", at: "09:00:02", text: "The card of orders-db is up to date; it was kept." },
      ],
    };
    const alone = thread(liveWith([alike]));
    assert.match(
      alone,
      /<details class="notes"><summary><svg [^>]*>.*?<\/svg><span>Les fiches de 2 sources sont à jour ; elles sont conservées\.<\/span><span class="note-count">2 sources<\/span><\/summary><ul><li><span class="turn-at">09:00:01<\/span> La fiche de orders-api est à jour ; elle est conservée\.<\/li><li><span class="turn-at">09:00:02<\/span> La fiche de orders-db est à jour ; elle est conservée\.<\/li><\/ul><\/details>/,
    );
    const among = thread(liveWith([note("The knowledge base is ready.", 3), alike]));
    assert.match(
      among,
      /<span>2 notes du harnais<\/span><span class="note-preview" aria-hidden="true">Les fiches de 2 sources sont à jour ; elles sont conservées\.<\/span>/,
    );
    assert.match(among, /<li><span class="turn-at">09:00:03<\/span> The knowledge base is ready\.<\/li><li><details class="notes">/);
    const read: Step = {
      kind: "repeated",
      at: "09:00:01",
      before: "Read ",
      after: " again.",
      sources: ["orders-api", "orders-db"],
      notes: [
        { kind: "note", at: "09:00:01", text: "Read orders-api again." },
        { kind: "note", at: "09:00:02", text: "Read orders-db again." },
      ],
    };
    assert.match(thread(liveWith([read])), /<span>Read … again\.<\/span><span class="note-count">2 sources<\/span>/);
  });

  it("folds a refusal of the harness under one line, and shows it under it as every verdict: its author and the kind of judge it is, what it came to, its gate, what it is about", () => {
    const html = thread();
    assert.match(
      textOf(html),
      /refusé PLAN-ELEMENT Le harnais refuse le plan search 14:44:17 Harnais contrôle automatique refusé PLAN-ELEMENT 14:44:17 Plan · scénario search Le harnais refuse le plan scenario search, expect 1\.1,/,
    );
    assert.match(html, /<details class="refusals"><summary><span class="speaker-mark sm tone-neutral"[^>]*>.*?<\/span><span class="badge ko">refusé<\/span>/);
    assert.match(
      html,
      /<article class="verdict refused"><header class="verdict-head"><div class="lead"><span class="speaker-mark sm tone-neutral" aria-hidden="true">.*?<\/span><b>Harnais<\/b><span class="badge outline">contrôle automatique<\/span><span class="badge ko">refusé<\/span><span class="verdict-code">PLAN-ELEMENT<\/span><\/div><span class="turn-at">14:44:17<\/span><\/header><p class="verdict-about">Plan · scénario search<\/p><p class="verdict-subject">Le harnais refuse le plan<\/p><p id="verdict-text-9" class="verdict-text/,
    );
    const accepted = thread(liveWith(REVIEWED));
    assert.match(accepted, /<article class="verdict accepted">.{0,700}<span class="badge ok">accepté<\/span><\/div>.{0,80}<p class="verdict-about">Plan<\/p>/);
    assert.doesNotMatch(accepted, /verdict-code|verdict-subject/);
    const error: Step = {
      kind: "verdict",
      at: "09:00:00",
      accepted: false,
      about: "Plan",
      text: "shop_click: Two elements.",
      tool: "shop_click",
      reason: "Two elements.",
    };
    assert.equal(
      textOf(thread(liveWith([error]))),
      "erreur Une action de l’agent n’a pas abouti 09:00:00 Harnais contrôle automatique erreur 09:00:00 Plan · outil shop_click Une action de l’agent n’a pas abouti Détails techniques shop_click: Two elements.",
    );
  });

  it("gathers the refusals alike that follow one another under one line that counts them and names their scenarios, each refusal under it", () => {
    const refusal = (scenario: string, at: string): Step => ({
      kind: "verdict",
      at,
      accepted: false,
      about: "Plan",
      code: "PLAN-LOCATOR",
      scenario,
      text: `The plan was refused by the harness: scenario ${scenario} cites no element.`,
      subject: "The plan was refused by the harness",
      reason: `scenario ${scenario} cites no element.`,
    });
    const html = thread(liveWith([refusal("search", "09:00:01"), refusal("open", "09:00:02"), refusal("search", "09:00:03")]));
    assert.equal(countOf(html, /<details class="refusals">/g), 1);
    assert.equal(countOf(html, /<article class="verdict refused">/g), 3);
    assert.match(
      textOf(html),
      /^Refusé ×3 PLAN-LOCATOR Le harnais refuse le plan search, open 09:00:01 Harnais contrôle automatique refusé PLAN-LOCATOR 09:00:01 Plan · scénario search Le harnais refuse le plan scenario search cites no element\./,
    );
    const pressed: string[] = [];
    const buttons = elementsOf(
      createElement(Thread, {
        path: PATH,
        frame: liveWith([refusal("search", "09:00:01"), { ...refusal("open", "09:00:02"), reason: "x".repeat(481) } as Step]).frame,
        lookIndex: undefined,
        stage: "ended",
        unfolded: [],
        onUnfold: (index) => pressed.push(index),
      }),
      "button",
    );
    (buttons[0]!["onClick"] as () => void)();
    assert.deepEqual(pressed, ["text-1"]);
  });

  it("names what a row of refusals is about by its phase when the harness gave it no subject, and an action that did not succeed when no gate refused", () => {
    const coded: Step = {
      kind: "verdict",
      at: "09:00:01",
      accepted: false,
      about: "Plan",
      code: "PLAN-LEVEL",
      text: "Too many levels.",
      reason: "Too many levels.",
    };
    assert.match(textOf(thread(liveWith([coded, coded]))), /^Refusé ×2 PLAN-LEVEL Plan 09:00:01 /);
    const failed: Step = { kind: "verdict", at: "09:00:01", accepted: false, about: "Plan", tool: "shop_click", text: "shop_click: No.", reason: "No." };
    assert.match(textOf(thread(liveWith([failed, failed]))), /^Refusé ×2 Une action de l’agent n’a pas abouti 09:00:01 /);
  });

  it("folds the page a refusal quotes under its address, and keeps its text as the harness wrote it under Détails techniques", () => {
    const html = thread();
    assert.match(
      html,
      /<details class="raw"><summary>Page à ce moment <span class="mono">http:\/\/localhost:3020\/<\/span><\/summary><pre>- heading &quot;Customers&quot;\n- textbox &quot;Search...&quot;\n- button &quot;Search&quot;\n- table &quot;Customers&quot;<\/pre><\/details>/,
    );
    assert.ok(html.includes(`<details class="raw"><summary>Détails techniques</summary><pre>${REFUSAL.replaceAll('"', "&quot;")}</pre></details></article>`));
  });

  it("writes a short reason whole, and folds a long one to its first lines over a button that unfolds it in place", () => {
    assert.match(thread(liveWith(REVIEWED)), /<p id="verdict-text-2" class="verdict-text">Le plan tient sur ce que l’agent a vu\.<\/p><details class="raw">/);
    const folded = thread();
    assert.match(folded, /<p id="verdict-text-9" class="verdict-text folded">scenario search, expect 1\.1,[^<]*then propose the plan again\.<\/p>/);
    assert.match(folded, /<button type="button" class="btn ghost sm read-more" aria-expanded="false" aria-controls="verdict-text-9">Lire la suite<\/button>/);
    const unfolded = thread({ ...liveOf(), unfolded: ["text-9"] });
    assert.match(unfolded, /<p id="verdict-text-9" class="verdict-text">/);
    assert.match(unfolded, /<button type="button" class="btn ghost sm read-more" aria-expanded="true" aria-controls="verdict-text-9">Replier<\/button>/);
    const pressed: string[] = [];
    const [button] = elementsOf(
      createElement(Thread, {
        path: PATH,
        frame: liveOf().frame,
        lookIndex: undefined,
        stage: "live",
        unfolded: [],
        onUnfold: (index) => pressed.push(index),
      }),
      "button",
    );
    (button!["onClick"] as () => void)();
    assert.deepEqual(pressed, ["text-9"]);
  });

  it("unfolds the long reason of an accepted verdict, which stays in sight, by its key", () => {
    const accepted: Step = { kind: "verdict", at: "09:00:00", accepted: true, about: "Plan", text: "x".repeat(481), reason: "x".repeat(481) };
    const pressed: string[] = [];
    const [button] = elementsOf(
      createElement(Thread, {
        path: PATH,
        frame: liveWith([accepted]).frame,
        lookIndex: undefined,
        stage: "ended",
        unfolded: [],
        onUnfold: (key) => pressed.push(key),
      }),
      "button",
    );
    (button!["onClick"] as () => void)();
    assert.deepEqual(pressed, ["text-0"]);
  });

  it("folds a reason of many short lines too, and one of a single long line", () => {
    const lines = { kind: "verdict", at: "09:00:00", accepted: false, about: "Plan", text: "a\nb\nc\nd\ne\nf\ng", reason: "a\nb\nc\nd\ne\nf\ng" } as const;
    const line = { ...lines, reason: "x".repeat(481) };
    for (const step of [lines, line]) assert.match(thread(liveWith([step])), /class="verdict-text folded"/);
    assert.doesNotMatch(thread(liveWith([{ ...lines, reason: "a\nb\nc\nd\ne\nf" }])), /folded|read-more/);
  });

  it("shows the verdict of a reviewer in the same form: the agent and the kind of judge it is, what it came to, what it reviewed, its remarks folded under their count, the call under Détails techniques", () => {
    const review: Step = {
      kind: "review",
      from: "code_reviewer",
      at: "09:00:01",
      scenario: "search",
      remarks: [{ text: "The total depends on the data.", where: "Step 1", rule: "PW-DATA-01", concerns: "plan" }, { text: "No screenshot ends the step." }],
      tool: "report_quality",
      answer: "Recorded. Answer with one word; call no more tools.",
      reply: "Done",
      durationMs: 6,
    };
    const html = thread(liveWith([review]));
    assert.match(
      textOf(html),
      /^Relecteur de code agent relecteur 2 remarques 09:00:01 relecture du test de search · juge la qualité du code Playwright 2 remarques Step 1 PW-DATA-01 porte sur le plan The total depends on the data\. No screenshot ends the step\. Détails techniques Outil report_quality Réponse du harnais Recorded\. Answer with one word; call no more tools\. Réponse du relecteur Done$/,
    );
    assert.match(
      html,
      /<article class="verdict review">.*<b>Relecteur de code<\/b><span class="badge ai">agent relecteur<\/span><span class="badge warn">2 remarques<\/span>.*<details class="raw remarks-fold"><summary>2 remarques<\/summary><ol class="remarks"><li class="remark"><div class="remark-head"><b>Step 1<\/b><span class="verdict-code">PW-DATA-01<\/span>/,
    );
    assert.match(html, /<li class="remark"><p class="remark-text">No screenshot ends the step\.<\/p><\/li>/);
    assert.match(html, /<details class="raw"><summary>Détails techniques<\/summary><dl>/);
  });

  it("says a reviewer found nothing, a duplicate of the plan with what it repeats, a call not taken, and one still on its way", () => {
    const clean: Step = {
      kind: "review",
      from: "coherence_reviewer",
      at: "09:00:01",
      scenario: "search",
      remarks: [],
      tool: "report_findings",
      answer: "Recorded.",
    };
    const plan: Step = {
      kind: "review",
      from: "plan_reviewer",
      at: "09:00:02",
      remarks: [{ text: "Both search a customer.", duplicate: { scenario: "search-again", of: "tests/search.spec.ts" } }],
      tool: "report_duplicates",
      answer: "Recorded.",
    };
    const none: Step = { ...plan, remarks: [] };
    const refused: Step = { ...clean, refused: true, answer: "The arguments do not match." };
    const text = textOf(thread(liveWith([clean, plan, none, refused])));
    assert.match(
      text,
      /Relecteur de cohérence agent relecteur aucune remarque 09:00:01 relecture du test de search · compare chaque test à son scénario Détails techniques Outil report_findings Réponse du harnais Recorded\. Relecteur/,
    );
    assert.match(
      text,
      /Relecteur du plan agent relecteur 1 doublon 09:00:02 relecture du plan · cherche les doublons avec l’existant search-again double tests\/search\.spec\.ts Both search a customer\./,
    );
    assert.match(text, /Relecteur du plan agent relecteur aucun doublon/);
    assert.match(text, /non retenu par le harnais 09:00:01 .* Réponse du harnais The arguments do not match\.$/);
    const pending: Step = { kind: "review", from: "code_reviewer", at: "09:00:03", remarks: [], tool: "report_quality", pending: true };
    const going = thread(liveWith([pending], RUNNING));
    assert.match(going, /<span class="speaker-mark sm tone-ok active"[^>]*>.*<span class="badge neutral">en cours<\/span>/);
    assert.doesNotMatch(going, /Réponse du harnais|<ol/);
    assert.match(thread(liveWith([pending])), /<span class="badge ok">aucune remarque<\/span>/);
  });

  it("shows what the session works on at the head of its thread: the levels asked, the applications by their names, the environment, and where the levels are asked", () => {
    const scope: Step = {
      kind: "scope",
      at: "09:00:00",
      title: "Portée de la session",
      environment: "local",
      applications: ["shop", "back-office"],
      levels: ["smoke", "functional"],
    };
    nameApplications([{ id: "shop", name: "Shop" }]);
    const html = thread(liveWith([scope]));
    nameApplications([]);
    assert.match(
      textOf(html),
      /^Portée de la session 09:00:00 Niveaux demandés Vérification rapide Fonctionnel Applications Shop, back-office Environnement local Seuls ces niveaux sont conçus ; la configuration les fixe\.$/,
    );
    assert.match(html, /<section class="result-card scope" aria-label="Portée de la session">/);
    assert.match(html, /<dd class="badges"><span class="badge info">Vérification rapide<\/span><span class="badge info">Fonctionnel<\/span><\/dd>/);
    assert.match(
      textOf(thread(liveWith([{ ...scope, domains: ["quotes", "policies"] }]))),
      /Applications shop, back-office Domaines quotes, policies Environnement local/,
    );
  });

  it("lists the scenarios of an accepted plan under their count, each a cell folded to its level, its title, its case and its application", () => {
    assert.match(textOf(thread()), /Plan accepté par le harnais 1 scénario 14:44:16 Vérification rapide Search a customer nominal · customer-management/);
    const html = thread(liveWith(REVIEWED));
    assert.match(
      textOf(html),
      /Plan accepté par le harnais 2 scénarios 09:00:03 Vérification rapide Search a customer shop .*Vérification rapide Open a customer Identifiant open/,
    );
    assert.match(
      html,
      /<section class="result-card plan"><header><div class="lead"><span class="act-state ok" aria-hidden="true"><\/span><b>Plan accepté par le harnais<\/b>/,
    );
    assert.match(
      html,
      /<details class="scenario"><summary class="scenario-head"><span class="badge neutral">Vérification rapide<\/span><span class="result-title">Search a customer<\/span><span class="turn-role">shop<\/span><\/summary>/,
    );
    assert.match(html, /<span class="result-title">Open a customer<\/span><\/summary>/);
  });

  it("unfolds a scenario on all the plan says of it — its intent, its facts, its steps and what each expects — then the scenario as told, under Détails", () => {
    const scenario: PlanScenario = {
      id: "search",
      title: "Search a customer",
      level: "functional",
      case: "negative",
      application: "shop",
      intent: "Finds no customer for an unknown name.",
      kind: "visual",
      effect: "write",
      domain: "customers",
      feature: "customer-search",
      sources: [{ source: "specs", item: "Search" }, { source: "shop" }],
      data: [
        { value: "Zed", from: "made-up" },
        { value: "Ada", from: "shop" },
      ],
      steps: [
        {
          action: "Search Zed.",
          expects: [
            { result: "Nothing is listed.", shows: ["No customer"], absent: ["Ada"] },
            { result: "The field keeps it.", shows: [], absent: [] },
          ],
        },
        { action: "Clear the search.", expects: [], restores: true },
      ],
      refusals: [
        {
          kind: "verdict",
          at: "09:00:01",
          accepted: false,
          code: "PLAN-LEVEL",
          about: "Plan",
          scenario: "search",
          text: "Two screens.",
          reason: "Two screens.",
        },
        { kind: "verdict", at: "09:00:02", accepted: false, about: "Plan", scenario: "search", text: "No address.", reason: "No address." },
      ],
    };
    const plan: Step = {
      kind: "plan",
      at: "09:00:03",
      title: "Plan accepté par le harnais",
      scenarios: [scenario, { id: "other", title: "Other", level: "custom", kind: "probe", data: [], refusals: [] }],
    };
    const html = thread(liveWith([plan]));
    const text = textOf(html);
    assert.match(text, /Fonctionnel Search a customer négatif · shop 2 refus du harnais Finds no customer for an unknown name\./);
    assert.match(
      text,
      /Identifiant search Niveau Fonctionnel Cas négatif Effet écrit des données Nature visuel Application shop Domaine customers · customer-search Sources specs Search shop Données Zed inventée Ada shop/,
    );
    assert.match(
      text,
      /Search Zed\. Nothing is listed\. Affiche No customer N’affiche plus Ada The field keeps it\. Clear the search\. remet en état Refusé par le harnais avant l’acceptation du plan 09:00:01 PLAN-LEVEL Two screens\. 09:00:02 No address\. Détails/,
    );
    assert.match(html, /<span class="turn-role">négatif · shop<\/span><span class="badge warn">2 refus du harnais<\/span><\/summary>/);
    assert.doesNotMatch(html.slice(html.indexOf("<pre>")), /refusals/);
    assert.match(html, /<ol class="scenario-steps" aria-label="Étapes">/);
    assert.match(html, /<code class="shown-text">No customer<\/code>/);
    assert.match(html, /<details class="raw"><summary>Détails<\/summary><pre>\{\n {2}&quot;id&quot;: &quot;search&quot;,/);
    assert.match(text, /custom Other Identifiant other Niveau custom Nature probe Données aucune saisie Détails/);
    assert.doesNotMatch(html.slice(html.indexOf("Other")), /scenario-steps|scenario-intent/);
  });

  it("opens a pass with what it makes of the request when it says it, a part of a pass marked apart", () => {
    assert.match(
      thread(liveWith(REVIEWED)),
      /<div class="pass" role="separator" aria-label="Plan · Vérification rapide · le chemin le plus court"><span class="pass-title">Plan · Vérification rapide<\/span><span class="pass-summary">le chemin le plus court<\/span><\/div>/,
    );
    assert.match(
      thread(),
      /<div class="pass minor" role="separator" aria-label="Écriture d’un test · search"><span class="pass-title">Écriture d’un test<\/span><span class="pass-summary">search<\/span><\/div>/,
    );
    assert.match(thread(), /<div class="pass" role="separator" aria-label="Configuration"><span class="pass-title">Configuration<\/span><\/div>/);
  });

  it("opens, once the session ended, on the verdict of each test, counted: passed, failed, blocked, or as the harness wrote it, a raw reason folded", () => {
    const html = thread(liveWith(REVIEWED));
    assert.match(
      textOf(html),
      /^Verdict de l’exécution : 4 tests 1 réussi · 1 échoué · 2 sans verdict Réussi Search a customer Vérification rapide Échoué Open a customer Détails techniques The heading never showed\. Bloqué Delete a customer Ignoré Export the customers Plan · Vérification rapide/,
    );
    assert.match(
      html,
      /<section class="result-card outcome"><header><b>Verdict de l’exécution : 4 tests<\/b><span class="outcome-tally">1 réussi · 1 échoué · 2 sans verdict<\/span><\/header>/,
    );
    assert.match(
      html,
      /<div class="result-row"><span class="badge ok">Réussi<\/span><span class="result-title">Search a customer<\/span><span class="turn-role">Vérification rapide<\/span><\/div>/,
    );
    assert.match(
      html,
      /<span class="badge ko">Échoué<\/span><span class="result-title">Open a customer<\/span><details class="raw result-raw"><summary>Détails techniques<\/summary><pre>The heading never showed\.<\/pre><\/details>/,
    );
    assert.match(html, /<span class="badge warn">Bloqué<\/span><span class="result-title">Delete a customer<\/span><span class="turn-role"><\/span><\/div>/);
    assert.match(html, /<span class="badge warn">Ignoré<\/span>/);
    assert.match(
      textOf(thread(liveOf(COMPLETED))),
      /^Verdict de l’exécution : 1 test 1 réussi Réussi Rechercher un client par son nom Chaque essai a réussi\. /,
    );
  });

  it("keeps the verdicts where they came while the session goes on, and counts only what came", () => {
    const html = thread(liveWith(REVIEWED, RUNNING));
    assert.match(textOf(html), /^Plan · Vérification rapide /);
    const failed = thread(liveWith([{ kind: "outcome", at: "09:00:00", title: "Verdicts", tests: [{ title: "Open", level: "", verdict: "failed" }] }]));
    assert.match(failed, /<span class="outcome-tally">1 échoué<\/span>/);
  });

  it("leaves out a pass that holds nothing, but the one a session that goes on is at", () => {
    const pass = (title: string): Step => ({ kind: "pass", at: "09:00:00", title, summary: "" });
    const steps = [pass("Cartographie · sources"), pass("Cartographie · fiche"), note("The knowledge base is ready.", 1), pass("Plan")];
    assert.doesNotMatch(textOf(thread(liveWith(steps))), /sources|Plan/);
    assert.match(textOf(thread(liveWith(steps, RUNNING))), /^Cartographie · fiche The knowledge base is ready\. Plan Les agents travaillent$/);
  });

  it("folds the work of the agents in a row under one line: who worked, how many actions and failures, the refusals and notes of the harness, and their time", () => {
    const opened: Step = {
      kind: "tool",
      from: "planner",
      at: "09:00:01",
      tool: "shop_goto",
      title: "A ouvert /",
      durationMs: 300,
      look: { kind: "page", name: "/", lines: ["- heading"] },
    };
    const failed: Step = { kind: "tool", from: "planner", at: "09:00:02", tool: "shop_click", title: "A cliqué", outcome: "failed", durationMs: 200 };
    const refused: Step = { kind: "verdict", at: "09:00:03", accepted: false, about: "Plan", tool: "shop_click", text: "shop_click: No.", reason: "No." };
    const work = [opened, refused, failed, note("The source was read.", 4)];
    const html = thread(liveWith(work));
    assert.match(
      html,
      /^<section class="thread" aria-label="Fil de la session"><div class="thread-item"><details class="stretch"><summary><span class="stretch-marks"><span class="speaker-mark sm tone-ai"/,
    );
    assert.match(textOf(html), /^Planificateur · 2 actions · 1 échec · 1 refus du harnais · 1 note du harnais 500 ms Planificateur /);
    assert.match(thread(liveWith(work), 0), /<details class="stretch" open="">/);
    const harness = thread(liveWith([refused, note("The source was read.", 4)]));
    assert.match(harness, /<span class="stretch-marks"><span class="speaker-mark sm tone-neutral"/);
    assert.match(textOf(harness), /^1 refus du harnais · 1 note du harnais erreur /);
    const pressed: string[] = [];
    const [stretch] = elementsOf(
      createElement(Thread, {
        path: PATH,
        frame: liveWith(work).frame,
        lookIndex: undefined,
        stage: "ended",
        unfolded: [],
        onUnfold: (key) => pressed.push(key),
      }),
      "details",
    ).filter((details) => details["className"] === "stretch");
    const toggle = stretch!["onToggle"] as (event: { currentTarget: { open: boolean } }) => void;
    toggle({ currentTarget: { open: false } });
    assert.deepEqual(pressed, []);
    toggle({ currentTarget: { open: true } });
    assert.deepEqual(pressed, ["stretch-0"]);
    assert.match(thread({ ...liveWith(work), unfolded: ["stretch-0"] }), /<details class="stretch" open="">/);
    const written: Step = { kind: "tool", from: "writer", at: "09:00:05", tool: "propose_test", title: "A remis le test", durationMs: 100 };
    assert.match(textOf(thread(liveWith([opened, written]))), /^Planificateur, Rédacteur · 2 actions 400 ms /);
  });

  it("counts the failures of the actions an agent did in a row, beside what it says", () => {
    const failed: Step = { kind: "tool", from: "planner", at: "09:00:02", tool: "shop_click", title: "A cliqué", outcome: "failed", durationMs: 200 };
    const said: Step = { kind: "say", from: "planner", at: "09:00:03", text: "Voici le plan." };
    assert.match(textOf(thread(liveWith([failed, failed, said]))), /2 actions 2 échecs 400 ms /);
  });

  it("keeps a kind of step or an agent when asked, and its links keep what the address holds", () => {
    const { frame } = liveOf();
    const kept = render(
      createElement(Thread, {
        ...UNREAD,
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
    const kept = render(createElement(Thread, { ...UNREAD, path: PATH, frame, lookIndex: undefined, filter: "actions", stage: "ended" }));
    assert.equal(countOf(kept, /<article class="turn">/g), 1);
  });
});

describe("what an agent looked at", () => {
  it("is a file with its lines, an empty one kept as a line, or a text with its excerpt", () => {
    const code = render(createElement(LookView, { look: { kind: "code", file: "a.spec.ts", lines: ["one", "", "three"] }, caption: "A joué « a »" }));
    assert.match(
      code,
      /<pre class="look-code code mono"><span class="code-line">one<\/span><span class="code-line"> <\/span><span class="code-line">three<\/span><\/pre>/,
    );
    const document = render(
      createElement(LookView, { look: { kind: "document", source: "http://localhost/", excerpt: ["A rule."] }, caption: "A regardé la page de shop" }),
    );
    assert.equal(textOf(document), "A rule. A regardé la page de shop");
  });
});

describe("the panel of a look", () => {
  /** The panel of the look of the page the planner opened, closed by the address of the session. */
  const panel = (): string => {
    const look = { kind: "document", source: "http://localhost:3020/", application: "customer-management", excerpt: ['- heading "Customers"'] } as const;
    return render(createElement(LookPanel, { opened: { index: PAGE_TOOL, action: "A ouvert / dans customer-management", look }, close: ADDRESS }));
  };

  it("is a dialog that does not hold the keyboard, titled by what it shows and named by what it is", () => {
    const html = panel();
    assert.match(html, /^<section class="look-panel" role="dialog" aria-modal="false" aria-labelledby="look-panel-title look-panel-subtitle">/);
    assert.match(html, /<h2 id="look-panel-title" tabindex="-1">Page consultée<\/h2>/);
    assert.match(html, /<p id="look-panel-subtitle" class="look-panel-subtitle">customer-management · http:\/\/localhost:3020\/<\/p>/);
    assert.equal(textOf(html), 'Page consultée customer-management · http://localhost:3020/ - heading "Customers" A ouvert / dans customer-management');
  });

  it("titles a file as a test file under its path, and a page whose application is unknown under its address", () => {
    const file = render(
      createElement(LookPanel, {
        opened: { index: 1, action: "A joué « a »", look: { kind: "code", file: "apps/shop/tests/a.spec.ts", lines: ["test();"] } },
        close: ADDRESS,
      }),
    );
    assert.match(textOf(file), /^Fichier de test apps\/shop\/tests\/a\.spec\.ts /);
    const page = render(
      createElement(LookPanel, {
        opened: { index: 1, action: "A regardé", look: { kind: "document", source: "http://localhost/", excerpt: [] } },
        close: ADDRESS,
      }),
    );
    assert.match(textOf(page), /^Page consultée http:\/\/localhost\/ /);
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

  it("asks, once the session ended, what the agents are to do next, and names its button « Poursuivre la session »", () => {
    const html = composer({ state: "idle" }, true);
    assert.match(
      html,
      /<label class="sr-only" for="composer-message">Dites aux agents quoi faire ensuite : corriger un test, ajouter un scénario…<\/label><textarea id="composer-message" name="message" rows="2" placeholder="Dites aux agents quoi faire ensuite : corriger un test, ajouter un scénario…">/,
    );
    assert.match(html, /<span class="btn-label">Poursuivre la session<\/span>/);
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
      assert.match(textOf(html), /En direct 15 nov. 2026, 14:44:06 · 2 actions arrêt demandé… Rejouer/);
      assert.doesNotMatch(html, /class="session-stop"|Arrêter/);
    }
    assert.doesNotMatch(stoppedWith({ state: "asked" }, "", INTERRUPTED), /arrêt demandé|session-stop/);
  });
});

describe("the screen of a session", () => {
  it("lets the person speak to the agents under the thread while they work or are waited for, in a replay too, and go on with the session once it ended", () => {
    assert.match(screen(), /<\/section><form class="composer">.*Envoyer.*<\/form><div class="session-end"><\/div><\/div>/);
    assert.match(screen("", liveOf(QUEUED, {}, ASKED)), /<\/section><form class="composer">.*<\/form><div class="session-end"><\/div><\/div>/);
    assert.match(screen("", liveOf(RUNNING, { following: false, tick: 30 })), /<form class="composer">/);
    for (const ended of [COMPLETED, INTERRUPTED, { ...RUNNING, state: "archived" as Session["state"] }]) {
      const html = screen("", liveOf(ended));
      assert.match(html, /<\/section><form class="composer">.*Poursuivre la session.*<\/form><div class="session-end"><\/div><\/div>/);
      assert.doesNotMatch(html, /Envoyer/);
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

  it("is headed by its day, what was asked left to its bubble, and leads back to the sessions of the project", () => {
    const html = screen();
    assert.match(textOf(html), /^Agent lakeside-tests \/ Agent \/ Session du 15 nov\. Session du 15 nov\. /);
    assert.equal(countOf(html, /tester la recherche d&#x27;un client/g), 1);
    assert.equal(linksOf(html)[0], "#/agent");
  });

  it("says in its facts what the session is kept to", () => {
    const html = screen("", liveOf({ ...RUNNING, scope: { domains: ["quotes"], levels: ["business"] } }));
    assert.match(html, /<span class="session-facts">15 nov. 2026, 14:44:06 · limitée à quotes, Parcours métier · 2 actions<\/span>/);
  });

  it("follows a session whose agents work: its state, its facts in a line, and the offer to replay it", () => {
    const html = screen();
    assert.match(
      html,
      /<div class="session-bar"><span class="badge info">En direct<\/span><span class="session-facts">15 nov. 2026, 14:44:06 · 2 actions<\/span><a id="session-stop" class="btn ghost sm" href="#\/agent\/sessions\/[^"?]+\?stop=ask"><svg [^>]*><rect [^>]*\/><\/svg> Arrêter<\/a><button type="button" class="btn ghost sm"><svg [^>]*>.*?<\/svg> Rejouer<\/button><\/div>/,
    );
    assert.match(textOf(html), /En direct 15 nov. 2026, 14:44:06 · 2 actions Arrêter Rejouer ✓ Configuration/);
    assert.match(html, /<div class="content"><div class="session"><div class="session-bar">/);
    assert.doesNotMatch(html, /disabled|role="progressbar"|session-bar replay/);
    assert.deepEqual(pressed(), ["restart"]);
  });

  it("says the stream of the events is reconnecting in place of the facts, whether the session goes on or not", () => {
    for (const session of [RUNNING, COMPLETED]) {
      const html = screen("", { ...liveOf(session), stream: "reconnecting" });
      assert.match(html, /<span class="session-facts">connexion au flux interrompue, nouvelle tentative…<\/span>/);
      assert.match(textOf(html), /connexion au flux interrompue, nouvelle tentative… (Arrêter )?Rejouer/);
      assert.doesNotMatch(html, /14:44:06/);
    }
    assert.doesNotMatch(screen("", { ...liveOf(), stream: "connecting" }), /connexion au flux interrompue/);
  });

  it("adds what an ended session knows: its duration, its model requests and its branch", () => {
    assert.match(
      textOf(screen("", liveOf(COMPLETED))),
      /Réussi 15 nov. 2026, 14:44:06 · 1 min 54 s · 3 actions · 50 requêtes au modèle · oqas\/design-20261115T144408Z Rejouer/,
    );
    assert.match(textOf(screen("", liveOf(STOPPED))), /Arrêté 15 nov. 2026, 14:44:06 · 42 s · 3 actions · 3 requêtes au modèle Rejouer/);
  });

  it("tells only the opening and the actions of a session that has no result", () => {
    const interrupted = screen("", liveOf(INTERRUPTED));
    assert.match(textOf(interrupted), /Interrompue 15 nov. 2026, 14:44:06 · 3 actions Rejouer/);
    assert.match(interrupted, /<div class="session-bar"><span class="badge warn">Interrompue<\/span>/);
    const untold = screen("", liveOf({ ...RUNNING, state: "completed" }));
    assert.match(
      untold,
      /<div class="session-bar"><span class="badge neutral">Terminée<\/span><span class="session-facts">15 nov. 2026, 14:44:06 · 3 actions<\/span>/,
    );
  });

  it("counts the knowledge sources the agents read, each once, among the facts of a session that read some", () => {
    const written = liveWith([{ kind: "say", from: "cartographer", at: "09:00:00", text: "Je lis les sources." }], INTERRUPTED, ["specification", "tickets"]);
    assert.match(textOf(screen("", written)), /Interrompue 15 nov. 2026, 14:44:06 · 2 sources de connaissance lues · 0 action Rejouer/);
    const events = numbered([
      { type: "phase_started", phase: "survey" },
      { type: "phase_started", phase: "card", source: "orders-db" },
      { type: "phase_started", phase: "card", source: "specs" },
      { type: "phase_started", phase: "card", source: "orders-db" },
      { type: "agent_message", agent: "cartographer", text: "I read the sources.", reasoning: false },
    ]);
    assert.match(textOf(screen("", liveOf(RUNNING, {}, events))), /:06 · 2 sources de connaissance lues · 0 action Arrêter Rejouer/);
    assert.doesNotMatch(screen(), /de connaissance lue/);
  });

  it("offers no replay of a session that has no event", () => {
    assert.match(screen("", liveWith([], RUNNING)), /<button type="button" class="btn ghost sm" disabled="">/);
  });

  it("replays a session at the pace asked: stopped or going, its speed, and how far it is", () => {
    const stopped = screen("", liveOf(RUNNING, { following: false, tick: endOf(fixtureScript()) / 4 }));
    assert.match(textOf(stopped), /Reprendre Verdict suivant × 1 Revenir au direct ✓ Configuration/);
    assert.match(stopped, /<div class="session-bar replay"><button type="button" class="btn primary sm">/);
    assert.match(
      stopped,
      /role="progressbar" aria-label="Avancement de la relecture" aria-valuemin="0" aria-valuemax="100" aria-valuenow="25"><i style="width:25%"><\/i>/,
    );
    assert.match(stopped, /<path d="M6 4l14 8-14 8z"\/><\/svg><span class="btn-label">Reprendre<\/span><\/button>/);
    assert.match(stopped, /<button type="button" class="btn ghost sm" aria-label="Aller au prochain verdict">/);
    assert.match(stopped, /<button type="button" class="btn ghost sm playback-speed" aria-label="Changer la vitesse">× 1<\/button>/);
    const going = screen("", liveOf(RUNNING, { following: false, tick: 30, playing: true, speed: 4 }));
    assert.match(textOf(going), /Pause Verdict suivant × 4 Revenir au direct/);
    assert.match(going, /<path d="M7 4v16M17 4v16"\/><\/svg><span class="btn-label">Pause<\/span><\/button>/);
    assert.doesNotMatch(going, /Rejouer|session-facts/);
  });

  it("ties each button of a replay to its control", () => {
    assert.deepEqual(pressed({ following: false, tick: 30 }), ["toggle", "skip", "faster", "follow"]);
  });

  it("says in its bar that a queued session waits for an agent, and names nobody at work under what was asked", () => {
    const html = screen("", liveOf(QUEUED, {}, ASKED));
    assert.match(html, /<span class="badge outline">En file<\/span>/);
    assert.match(textOf(html), /En file 15 nov. 2026, 14:44:06 · en attente d’un agent · 0 action Arrêter Rejouer /);
    assert.doesNotMatch(html, /class="working"|travaille/);
    assert.match(textOf(screen("", liveOf(QUEUED, { following: false, tick: 30 }, ASKED))), /× 1 Tout afficher/);
  });

  it("leads from a replay back to the live session, or to the whole of an ended one", () => {
    assert.match(textOf(screen("", liveOf(RUNNING, { following: false, tick: 30 }))), /× 1 Revenir au direct/);
    assert.match(textOf(screen("", liveOf(COMPLETED, { following: false, tick: 30 }))), /× 1 Tout afficher ✓ Configuration/);
    assert.doesNotMatch(screen("", liveOf(COMPLETED, { following: false, tick: 30 })), /Revenir au direct/);
  });

  it("shows where the session is with its passes, each but the last tied to the next, the parts of a pass left out", () => {
    assert.match(textOf(screen()), /✓ Configuration 2 Plan · Vérification rapide Tout Échanges Actions Verdicts/);
    assert.match(textOf(screen("", liveOf(COMPLETED))), /✓ Configuration ✓ Plan · Vérification rapide Tout/);
    assert.match(
      screen("", replayAt(REASONING, 0)),
      /<span class="s done"><span class="n">✓<\/span>Configuration<\/span><span class="sep"><\/span><\/span><span class="pass-step"><span class="s cur"><span class="n">2<\/span>Plan · Vérification rapide<\/span><\/span><\/div>/,
    );
    assert.match(
      screen("", replayAt(0, 0)),
      /<span class="s cur"><span class="n">1<\/span>Configuration<\/span><span class="sep"><\/span><\/span><span class="pass-step"><span class="s"><span class="n">2<\/span>Plan · Vérification rapide<\/span><\/span><\/div>/,
    );
  });

  it("keeps of the thread what its address asks: a kind of step, an agent, or both, and its links keep them", () => {
    const verdicts = screen("?show=verdicts");
    assert.doesNotMatch(verdicts, /class="act-line/);
    assert.match(verdicts, new RegExp(`<a class="chip on" href="${ADDRESS}\\?show=verdicts" aria-current="true">Verdicts</a>`));
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
    assert.doesNotMatch(html, /look-panel|role="dialog"|Page consultée|Fichier de test|act selected|aria-current="true"[^>]*class="act-look"/);
    assert.doesNotMatch(html, /Regard|Vues de la session|view=/);
    assert.ok(linksOf(html).includes(`${ADDRESS}?look=${PAGE_TOOL}`));
  });

  it("opens from the address the look of the action it names, marks that action, and closes by the same address without it", () => {
    const live = liveWith([...fixtureScript().steps, ...REVIEWED]);
    const page = screen(`?look=${PAGE_TOOL}`, live);
    assert.match(
      textOf(page),
      /Page consultée customer-management · http:\/\/localhost:3020\/ - heading "Customers" - textbox "Search\.\.\." A ouvert \/ dans customer-management/,
    );
    assert.match(page, new RegExp(`<div class="act selected"><details>.{0,900}<a id="look-eye-${PAGE_TOOL}" class="act-look"`));
    assert.equal(countOf(page, /class="act selected"/g), 1);
    assert.match(page, new RegExp(`<a class="look-panel-close" href="${ADDRESS}" aria-label="Fermer">`));
    assert.match(page, /<\/section><form class="composer">.*<\/form><div class="session-end"><\/div><section class="look-panel" role="dialog"/);
    const file = screen(`?look=${fixtureScript().steps.length + 5}`, live);
    assert.match(textOf(file), /Fichier de test search-customer\.spec\.ts test\('search', async \(\) => \{\}\); A remis le test$/);
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
    assert.match(textOf(early), /Page consultée customer-management · http:\/\/localhost:3020\//);
    assert.doesNotMatch(early, /act selected|look-eye/);
    const running = screen(`?look=${PAGE_TOOL}`, replayAt(PAGE_TOOL, 1));
    assert.match(running, /<div class="act selected"><div class="act-line"><span class="spinner"/);
    assert.doesNotMatch(running, /look-eye/);
  });
});
