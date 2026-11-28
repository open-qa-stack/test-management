import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { ExecutionList, Session, TestLaunch } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../../src/api/polled-state.ts";
import { ExecutionsScreen, type ExecutionsControls, type ExecutionsScreenProps } from "../../src/executions/executions-screen.tsx";
import { linksOf, render, textOf } from "../render.ts";
import { DETAIL, EXECUTIONS } from "./executions-fixture.ts";

/** The session that ran the first execution. */
const SESSION = { id: "8d3f1a52-0c4e-4b8a-9e61-7f2a5c9d0b13", request: "Test the policies", openedAt: "", lastEventAt: "", state: "completed" } as Session;

/** What the person does on the screen, which drawing it never calls. */
const CONTROLS: ExecutionsControls = {
  outcome: () => undefined,
  origin: () => undefined,
  campaign: () => undefined,
  period: () => undefined,
  size: () => undefined,
};

/** A page of the executions, the first of those the query keeps unless the page says otherwise. */
const pageOf = (items: ExecutionList["items"], more: Partial<ExecutionList> = {}): ExecutionList => ({ items, total: items.length, start: 0, ...more });

/** The screen in a state, narrowed as the address says, as HTML. */
const screen = (state: PolledState<ExecutionList> = { value: pageOf(EXECUTIONS) }, more: Partial<ExecutionsScreenProps> = {}): string =>
  render(createElement(ExecutionsScreen, { project: "lakeside-tests", sessions: [SESSION], state, filter: {}, controls: CONTROLS, ...more }));

describe("the executions of the tests", () => {
  it("says it reads the executions until the instance listed them, and why it could not", () => {
    assert.equal(textOf(screen({})), "Exécutions Lecture des exécutions Elles apparaissent dès que l’instance a répondu.");
    assert.match(textOf(screen({ unread: "L’instance ne répond pas." })), /Lecture des exécutions L’instance ne répond pas\.$/);
  });

  it("says the instance keeps no execution yet, and none of a filter once narrowed to it", () => {
    assert.match(
      textOf(screen({ value: pageOf([]) })),
      /Aucune exécution pour l’instant Les exécutions des tests apparaissent ici dès qu’une session de l’agent a lancé/,
    );
    for (const more of [
      { filter: { outcome: "failing" } },
      { filter: { origin: "manual" } },
      { filter: { campaign: "c1" } },
      { filter: { period: "day" } },
      { before: "e1" },
    ] as const)
      assert.match(
        textOf(screen({ value: pageOf([]) }, more)),
        /30 derniers jours Aucune exécution ne correspond Aucune exécution gardée ne correspond à ces filtres\.$/,
      );
  });

  it("shows each execution as a card: whether a test failed, its date, its origin and the session that ran it, where, how many tests and how long, never a commit", () => {
    const html = screen();
    const text = textOf(html);
    assert.match(
      text,
      /^Exécutions Les exécutions des tests, la plus récente d’abord\. Résultat Toutes Avec un échec Sans échec Origine Toutes les origines Session de l’agent Lancement manuel Campagne Période Toutes les dates Dernières 24 heures 7 derniers jours 30 derniers jours 19 nov\. 2026, \d\d:\d\d Session de l’agent · Test the policies 5 tests · 9 s 2 réussis 1 échoué Voir l’échec Détail par test /,
    );
    assert.match(html, /<span class="tests-mark failed" role="img" aria-label="Échoué">/);
    assert.match(html, new RegExp(`<a href="#/agent/sessions/${SESSION.id}">Test the policies</a>`));
    assert.doesNotMatch(text, /4f2a9c0/);
    assert.match(text, / Session de l’agent 0 test · 0 s Détail par test 1–2 sur 2 Par page 25 50 100$/);
    assert.match(html, /<span class="tests-mark passed" role="img" aria-label="Réussi">/);
  });

  it("says the environment an execution ran against, when it is kept", () => {
    assert.match(textOf(screen({ value: pageOf([{ ...EXECUTIONS[0]!, environment: "staging" }]) })), / Test the policies staging · 5 tests · 9 s /);
  });

  it("says an execution of a campaign is one, leading to the campaign, whatever session the console lists", () => {
    const [latest] = EXECUTIONS;
    const launched = { ...latest!, origin: "campaign" as const, campaignId: "c1" };
    assert.match(textOf(screen({ value: pageOf([launched]) })), / Campagne · 5 tests d’une campagne /);
    const campaign = {
      id: "c1",
      name: "Recette 4.2",
      environment: "local",
      targetVersion: "4.2",
      status: "in_progress" as const,
      createdAt: "2026-11-20T08:00:00.000Z",
      tests: [],
      counts: { passed: 0, failed: 0, flaky: 0, skipped: 0, not_run: 0 },
    };
    const named = screen({ value: pageOf([launched]) }, { campaigns: [campaign] });
    assert.match(textOf(named), / Campagne Toutes les campagnes Recette 4\.2 Période /);
    assert.match(
      named,
      /<span class="exec-card-origin">Campagne · <a href="#\/campaigns\/view\?id=c1">Campagne « Recette 4\.2 » · 5 tests<\/a><\/span><span class="small muted">4\.2 · 5 tests · 9\ss<\/span>/,
    );
    // An execution run by hand names no session.
    const { sessionId: _session, ...byHand } = latest!;
    assert.match(textOf(screen({ value: pageOf([{ ...byHand, origin: "manual" as const }]) })), / Lancement manuel 5 tests · 9\ss /);
  });

  it("says at a glance what came of the tests of an execution: a bar of their verdicts, how many passed, how many failed", () => {
    const html = screen();
    assert.match(
      html,
      /<span class="verdict-bar" aria-hidden="true"><span class="verdict-part passed" style="flex-grow:2"><\/span><span class="verdict-part flaky" style="flex-grow:1"><\/span><span class="verdict-part skipped" style="flex-grow:1"><\/span><span class="verdict-part failed" style="flex-grow:1"><\/span><\/span><span class="exec-card-words"><span class="verdict-words passed">2 réussis<\/span><span class="verdict-words failed">1 échoué<\/span><\/span>/,
    );
    const [latest] = EXECUTIONS;
    const passed = { ...latest!, results: latest!.results.filter((result) => result.verdict === "passed") };
    const sound = screen({ value: pageOf([passed]) });
    assert.match(sound, /<span class="exec-card-words"><span class="verdict-words passed">2 réussis<\/span><\/span>/);
    assert.doesNotMatch(sound, /Voir l/);
  });

  it("leads to the failures of an execution first, then to each of its tests", () => {
    const [first, second] = EXECUTIONS;
    assert.deepEqual(linksOf(screen()), [
      `#/executions/view?id=${first!.id}`,
      `#/agent/sessions/${SESSION.id}`,
      `#/executions/view?id=${first!.id}`,
      `#/executions/view?id=${first!.id}&view=all`,
      `#/executions/view?id=${second!.id}`,
      `#/executions/view?id=${second!.id}&view=all`,
    ]);
  });

  it("shows the launch that runs above the executions kept, on the first page, unless narrowed to what it is not", () => {
    const running: TestLaunch = { startedAt: "2026-11-19T11:00:00.000Z", environment: "staging", paths: [DETAIL] };
    const told = / En cours 19 nov\. 2026, \d\d:\d\d Lancement manuel · staging Préparation des tests…/;
    assert.match(textOf(screen(undefined, { running })), told);
    assert.match(textOf(screen(undefined, { running, filter: { origin: "manual", period: "day" } })), told);
    assert.equal(linksOf(screen(undefined, { running }))[0], "#/executions/running");
    for (const more of [{ filter: { outcome: "failing" } }, { filter: { origin: "design" } }, { filter: { campaign: "c1" } }, { before: "e1" }] as const)
      assert.doesNotMatch(textOf(screen(undefined, { running, ...more })), /En cours/);
    // It is there too when the instance keeps none yet, and tells how far it went.
    const some = { ...running, campaign: "c1", progress: { total: 5, finished: [{ path: DETAIL, title: "A", verdict: "passed" as const }] } };
    const alone = textOf(screen({ value: pageOf([]) }, { running: some, filter: {} }));
    assert.match(alone, / Campagne · staging 1 \/ 5 tests$/);
  });

  it("selects the filter chosen, tells which executions the page shows, and leads to the older ones and back to the latest ones, keeping the filter", () => {
    const html = screen({ value: pageOf(EXECUTIONS, { total: 132, start: 25, next: "e9" }) }, { filter: { outcome: "failing", period: "week" }, before: "e0" });
    assert.match(html, /<option value="failing" selected="">Avec un échec<\/option>/);
    assert.match(html, /<option value="week" selected="">7 derniers jours<\/option>/);
    assert.deepEqual(linksOf(html).slice(-2), ["#/executions?outcome=failing&period=week", "#/executions?outcome=failing&period=week&before=e9"]);
    assert.match(textOf(html), /26–27 sur 132 ← Les plus récentes Plus anciennes → Par page 25 50 100$/);
    // The first page leads to no latest ones, and the last one to no older ones.
    assert.doesNotMatch(textOf(screen()), /Les plus récentes|Plus anciennes/);
  });
});
