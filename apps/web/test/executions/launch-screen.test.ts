import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { CampaignOverview, LaunchState, TestLaunch } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../../src/api/polled-state.ts";
import { LaunchScreen } from "../../src/executions/launch-screen.tsx";
import { linksOf, render, textOf } from "../render.ts";
import { DETAIL } from "./executions-fixture.ts";

/** A launch that runs, whose runner has not listed its tests yet. */
const LAUNCH: TestLaunch = { startedAt: "2026-11-19T10:00:00.000Z", environment: "staging", paths: [DETAIL] };

/** The screen, as HTML. */
const screen = (state: PolledState<LaunchState>): string =>
  render(createElement(LaunchScreen, { project: "lakeside-tests", state, campaigns: [{ id: "c1", name: "Recette 4.2" } as CampaignOverview] }));

describe("the execution that runs", () => {
  it("says it reads it until the instance answered, and why it could not", () => {
    assert.match(textOf(screen({})), /Exécution en cours Lecture de l’exécution Elle apparaît dès que l’instance a répondu\.$/);
    assert.match(textOf(screen({ unread: "L’instance ne répond pas." })), /L’instance ne répond pas\.$/);
  });

  it("says its tests are prepared, then how far it went and what came of each test it finished, the failures first", () => {
    assert.match(
      textOf(screen({ value: { running: LAUNCH } })),
      /Exécution en cours depuis le 19 nov\. 2026, \d\d:\d\d En cours Préparation des tests… Lancement manuel · staging$/,
    );
    const finished = [
      { path: DETAIL, title: "Display a policy", verdict: "passed" as const },
      { path: DETAIL, title: "Edit a policy", verdict: "failed" as const },
    ];
    const html = screen({ value: { running: { ...LAUNCH, campaign: "c1", progress: { total: 5, finished } } } });
    assert.match(
      textOf(html),
      /2 \/ 5 tests 1 échoué 1 réussi Campagne · Recette 4\.2 · staging Tests terminés · 2 tests Échoué Edit a policy Réussi Display a policy$/,
    );
    const card = `#/tests/view?path=${encodeURIComponent(DETAIL)}`;
    assert.deepEqual(linksOf(html).slice(-3), ["#/campaigns/view?id=c1", card, card]);
  });

  it("says none runs, and leads to the execution the last one kept, or says why it kept none", () => {
    const ended = { ...LAUNCH, endedAt: "2026-11-19T10:01:00.000Z" };
    assert.match(textOf(screen({ value: {} })), /Aucune exécution en cours Elle apparaît ici dès que des tests sont lancés\.$/);
    assert.match(textOf(screen({ value: { last: { ...ended, failure: "No report." } } })), /Aucune exécution en cours No report\.$/);
    assert.equal(linksOf(screen({ value: { last: { ...ended, execution: "e1" } } })).at(-1), "#/executions/view?id=e1");
  });
});
