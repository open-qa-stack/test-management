import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { CampaignProgress } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../../src/api/polled-state.ts";
import { CampaignScreen, type CampaignGesture, type GestureState } from "../../src/campaigns/campaign-screen.tsx";
import { resultHref } from "../../src/executions/executions-paths.ts";
import { elementsOf, render, textOf } from "../render.ts";
import { PLANNED, POLICY, PROGRESS, QUOTE, RUNNING } from "./campaigns-fixture.ts";

/** The screen of a campaign, in the state given, as HTML. */
const screen = (state: PolledState<CampaignProgress>, launching = false, gestures: GestureState = {}): string =>
  render(createElement(CampaignScreen, { project: "lakeside-tests", id: "c1", state, launching, gestures, onGesture: () => undefined }));

/** The labels of the buttons of a page. */
const buttons = (html: string): string[] => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]!);

describe("the screen of a campaign", () => {
  it("tells where the campaign is, its environment and its tags, then each test with what came of it, which leads to its result", () => {
    const html = screen({ value: PROGRESS });
    assert.match(textOf(html), /^lakeside-tests \/ Campagnes \/ Recette 4\.2 Recette 4\.2 en cours/);
    assert.match(textOf(html), /Environnement local Tags @p0 @domain-policies Planifiée le \d+ nov\. 2026/);
    assert.match(
      textOf(html),
      /2 tests · 1 échoué · 1 non joué En échec Answer an insurance quote apps\/\S+ \d+ nov\. 2026, \d\d:\d\d non joué Display the detail of a policy/,
    );
    assert.ok(html.includes(`href="${resultHref("e1", QUOTE.path).replaceAll("&", "&amp;")}"`));
    assert.doesNotMatch(html, new RegExp(`href="[^"]*${encodeURIComponent(POLICY.path)}`));
    assert.deepEqual(buttons(html), ["Relancer les tests", "Clôturer"]);
  });

  it("offers what the state of the campaign allows: fix its tests, launch them, nothing once closed", () => {
    const planned = screen({ value: { campaign: PLANNED, results: [] } });
    assert.deepEqual(buttons(planned), ["Figer les tests"]);
    assert.match(textOf(planned), /tous les tests .* Ce sont les tests que ses tags prennent aujourd’hui .* Aucun test Aucun test du dépôt ne porte ces tags/);
    assert.deepEqual(buttons(screen({ value: { ...PROGRESS, campaign: { ...RUNNING, status: "ready" } } })), ["Lancer les tests"]);
    const closed = screen({ value: { ...PROGRESS, campaign: { ...RUNNING, status: "closed", closedAt: "2026-11-21T10:00:00.000Z" } } });
    assert.deepEqual(buttons(closed), []);
    assert.match(textOf(closed), /Clôturée le 21 nov\. 2026/);
  });

  it("says its tests run, the gesture asked of the instance, and why it refused one", () => {
    const launching = screen({ value: PROGRESS }, true);
    assert.match(textOf(launching), /Les tests de la campagne tournent/);
    assert.match(launching, /<button type="button" class="btn primary" disabled="">Relancer les tests<\/button>/);
    for (const gesture of ["launch", "close"] as CampaignGesture[]) assert.match(textOf(screen({ value: PROGRESS }, false, { pending: gesture })), /Envoi…/);
    assert.match(textOf(screen({ value: { campaign: PLANNED, results: [] } }, false, { pending: "ready" })), /Envoi…/);
    assert.match(textOf(screen({ value: PROGRESS }, false, { refusal: "Refusé." })), /Refusé\./);
  });

  it("asks the instance for the gesture a button names", () => {
    const asked: CampaignGesture[] = [];
    const node = createElement(CampaignScreen, {
      project: "lakeside-tests",
      id: "c1",
      state: { value: PROGRESS },
      launching: false,
      gestures: {},
      onGesture: (gesture: CampaignGesture) => asked.push(gesture),
    });
    for (const button of elementsOf(node, "button")) (button["onClick"] as () => void)();
    assert.deepEqual(asked, ["launch", "close"]);
  });

  it("says it reads the campaign until the instance answered, and why it could not", () => {
    assert.match(textOf(screen({})), /^lakeside-tests \/ Campagnes \/ c1 c1 Lecture de la campagne Elle apparaît dès que l’instance a répondu\.$/);
    assert.match(textOf(screen({ unread: "Down." })), /Lecture de la campagne Down\.$/);
  });
});
