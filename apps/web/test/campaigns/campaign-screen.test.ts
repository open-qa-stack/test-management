import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { CampaignProgress, TestLaunch } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../../src/api/polled-state.ts";
import { EVERY_TEST } from "../../src/campaigns/campaign-composition.ts";
import { CampaignScreen, launchScopeOf, type CampaignGesture, type GestureState } from "../../src/campaigns/campaign-screen.tsx";
import { resultHref } from "../../src/executions/executions-paths.ts";
import { elementsOf, render, textOf } from "../render.ts";
import { PLANNED, POLICY, PROGRESS, QUOTE, RUNNING } from "./campaigns-fixture.ts";

/** The screen of a campaign, in the state given, as HTML. */
const screen = (state: PolledState<CampaignProgress>, gestures: GestureState = {}, launch?: TestLaunch): string =>
  render(
    createElement(CampaignScreen, {
      project: "lakeside-tests",
      id: "c1",
      state,
      gestures,
      onGesture: () => undefined,
      ...(launch === undefined ? {} : { launch }),
    }),
  );

/** The labels of the buttons of a page. */
const buttons = (html: string): string[] => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]!);

/** A campaign whose every test passed. */
const PASSED: CampaignProgress = {
  ...PROGRESS,
  results: PROGRESS.results.map((result) => ({ ...result, verdict: "passed", execution: "e2", ranAt: "2026-11-20T09:00:00.000Z" })),
};

describe("the screen of a campaign", () => {
  it("tells where the campaign is in its life, how far it went, then each test, the failures first, which leads to its result", () => {
    const html = screen({ value: PROGRESS });
    assert.match(textOf(html), /^lakeside-tests \/ Campagnes \/ Recette 4\.2 Recette 4\.2 en cours/);
    assert.match(textOf(html), /planifiée prête en cours clôturée Environnement local Planifiée le \d+ nov\. 2026/);
    assert.match(
      textOf(html),
      /Avancement 1 \/ 2 joués 1 échoué 1 non joué 2 tests En échec Answer an insurance quote apps\/\S+ \d+ nov\. 2026, \d\d:\d\d non joué Display the detail of a policy/,
    );
    assert.match(html, /<li class="current" aria-current="step">en cours<\/li>/);
    assert.ok(html.includes(`href="${resultHref("e1", QUOTE.path).replaceAll("&", "&amp;")}"`));
    assert.doesNotMatch(html, new RegExp(`href="[^"]*${encodeURIComponent(POLICY.path)}`));
    assert.deepEqual(buttons(html), ["Relancer l’échec", "Lancer le test non joué", "Tout relancer", "Clôturer"]);
  });

  it("offers what the state of the campaign allows: fix its tests, launch them, launch them all again, nothing once closed", () => {
    const planned = screen({ value: { campaign: PLANNED, results: [] } });
    assert.deepEqual(buttons(planned), ["Figer les tests"]);
    assert.match(
      textOf(planned),
      /Choisissez ses tests ci-dessous : ils restent modifiables jusqu’à ce que vous les figiez\. Aucun test Aucun test n’est choisi pour cette campagne\.$/,
    );
    assert.match(planned, /disabled="">Figer les tests<\/button>/, "a campaign becomes ready with tests");
    assert.deepEqual(buttons(screen({ value: { ...PROGRESS, campaign: { ...RUNNING, status: "ready" } } })), ["Lancer les tests"]);
    assert.deepEqual(buttons(screen({ value: PASSED })), ["Tout relancer", "Clôturer"]);
    const unrun: CampaignProgress = {
      ...PROGRESS,
      results: PROGRESS.results.map((result) => ({ path: result.path, title: result.title, verdict: "not_run" })),
    };
    assert.match(screen({ value: unrun }), /<button type="button" class="btn primary">Lancer les 2 non joués<\/button>/);
    const closed = screen({ value: { ...PASSED, campaign: { ...RUNNING, status: "closed", closedAt: "2026-11-21T10:00:00.000Z" } } });
    assert.deepEqual(buttons(closed), []);
    assert.match(textOf(closed), /Clôturée le 21 nov\. 2026, \d\d:\d\d Avancement 2 \/ 2 joués 2 réussis/);
  });

  it("composes a planned campaign, and fixes its tests only once the choice is kept", () => {
    const composer = {
      tests: { value: [] },
      filter: EVERY_TEST,
      chosen: new Set<string>(),
      saving: false,
      onFilter: () => undefined,
      onTick: () => undefined,
      onSave: () => undefined,
    };
    const chosen = { campaign: { ...PLANNED, tests: [QUOTE] }, results: [{ ...QUOTE, verdict: "not_run" as const }] };
    const composed = (changed: boolean) =>
      render(
        createElement(CampaignScreen, {
          project: "lakeside-tests",
          id: "c2",
          state: { value: chosen },
          gestures: {},
          onGesture: () => undefined,
          composer: { ...composer, changed },
        }),
      );
    assert.match(composed(false), /<button type="button" class="btn primary">Figer les tests<\/button>/);
    assert.match(composed(true), /disabled="">Figer les tests<\/button>/);
    assert.match(textOf(composed(false)), /Aucun test dans le dépôt/);
  });

  it("says whether the campaign passes once it is no longer planned: every test passed, at once or on a retry", () => {
    assert.match(screen({ value: PROGRESS }), /Recette 4\.2 <span class="badge ai">en cours<\/span> <span class="badge ko">ne passe pas<\/span><\/h1>/);
    assert.match(screen({ value: PASSED }), /<span class="badge ok">.*passe<\/span>/);
    const flaky = { ...PASSED, results: [{ ...PASSED.results[0]!, verdict: "flaky" as const }, PASSED.results[1]!] };
    assert.match(textOf(screen({ value: flaky })), /en cours passe .* 1 réussi 1 instable/);
    assert.doesNotMatch(textOf(screen({ value: { campaign: PLANNED, results: [] } })), /passe/);
  });

  it("asks to confirm a closing, which can be given up", () => {
    const html = screen({ value: PROGRESS }, { confirming: true });
    assert.match(textOf(html), /Clôturer pour de bon \? Une campagne clôturée ne se relance plus\. Clôturer la campagne Annuler/);
    assert.deepEqual(buttons(html), ["Clôturer la campagne", "Annuler"]);
  });

  it("follows the launch that runs: how far it went, the tests it finished with their verdict, those still to come", () => {
    const launch: TestLaunch = { startedAt: "2026-11-20T10:00:00.000Z", environment: "local", paths: [QUOTE.path, POLICY.path], campaign: "c1" };
    assert.match(textOf(screen({ value: PROGRESS }, {}, launch)), /Lancement en préparation : installation/);
    const running = screen({ value: PROGRESS }, {}, { ...launch, progress: { total: 2, finished: [{ ...POLICY, verdict: "passed" }] } });
    assert.match(textOf(running), /Lancement en cours : 1 \/ 2 tests finis/);
    assert.match(running, /<progress class="campaign-launch-bar" max="2" value="1">/);
    assert.match(textOf(running), /en cours Answer an insurance quote .* dans le lancement en cours Réussi Display the detail of a policy .* à l’instant/);
    assert.doesNotMatch(running, /href="#\/executions\/result/, "a test of the launch leads to no result until it ended");
    assert.ok(buttons(running).filter((label) => label !== "Clôturer").length === 3);
    assert.match(running, /disabled="">Tout relancer/);
    const other = screen({ value: PROGRESS }, {}, { ...launch, paths: [QUOTE.path] });
    assert.match(textOf(other), /non joué Display the detail of a policy/);
  });

  it("says the gesture asked of the instance, and why it refused one", () => {
    for (const gesture of ["launch", "launch_failed", "launch_not_run"] as CampaignGesture[])
      assert.match(textOf(screen({ value: PROGRESS }, { pending: gesture })), /Envoi…/);
    assert.match(textOf(screen({ value: { campaign: PLANNED, results: [] } }, { pending: "ready" })), /Envoi…/);
    assert.match(textOf(screen({ value: PROGRESS }, { confirming: true, pending: "confirm_close" })), /Envoi…/);
    assert.match(textOf(screen({ value: PROGRESS }, { refusal: "Refusé." })), /Refusé\./);
  });

  it("launches the tests a gesture names", () => {
    assert.deepEqual((["launch_failed", "launch_not_run", "launch"] as CampaignGesture[]).map(launchScopeOf), ["failed", "not_run", undefined]);
  });

  it("asks for the gesture a button names", () => {
    const asked: CampaignGesture[] = [];
    const onGesture = (gesture: CampaignGesture): number => asked.push(gesture);
    for (const gestures of [{}, { confirming: true }]) {
      const node = createElement(CampaignScreen, { project: "lakeside-tests", id: "c1", state: { value: PROGRESS }, gestures, onGesture });
      for (const button of elementsOf(node, "button")) (button["onClick"] as () => void)();
    }
    assert.deepEqual(asked, ["launch_failed", "launch_not_run", "launch", "close", "confirm_close", "cancel_close"]);
  });

  it("says it reads the campaign until the instance answered, and why it could not", () => {
    assert.match(textOf(screen({})), /^lakeside-tests \/ Campagnes \/ c1 c1 Lecture de la campagne Elle apparaît dès que l’instance a répondu\.$/);
    assert.match(textOf(screen({ unread: "Down." })), /Lecture de la campagne Down\.$/);
  });
});
