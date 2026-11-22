import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { Session, TestExecution } from "@open-qa-stack/domain/sessions";
import { scopeText, stateOf } from "../../src/agent/session-facts.ts";
import { ScopeCard } from "../../src/agent/scope-card.tsx";
import { CampaignComposer } from "../../src/campaigns/campaign-composer.tsx";
import { CampaignVerdictBadge } from "../../src/campaigns/campaign-verdict.tsx";
import { EVERY_TEST } from "../../src/campaigns/campaign-composition.ts";
import { DesignCard } from "../../src/configuration/settings-cards.tsx";
import { ResultScreen } from "../../src/executions/result-screen.tsx";
import { VerdictBadge } from "../../src/executions/verdicts.tsx";
import { LEVELS, levelHint, levelName, originName, phaseName, statusCount, statusName } from "../../src/i18n/vocabulary.ts";
import { TestScreen } from "../../src/tests/test-screen.tsx";
import { TestsScreen } from "../../src/tests/tests-screen.tsx";
import { parseRoute } from "../../src/routing/route.ts";
import { COMPLETED } from "../agent/session-fixture.ts";
import { render, textOf } from "../render.ts";
import { DETAIL, READING, SMOKE, TESTS } from "../tests/tests-fixture.ts";
import { speaking } from "./in-language.ts";

const inEnglish = speaking("en");

/** A run of the test of the smoke level that failed. */
const FAILED_RUN: TestExecution = {
  id: "e1",
  origin: "design",
  ranAt: "2026-11-19T10:00:00.000Z",
  result: { path: SMOKE.path, title: SMOKE.title, project: "customer-management", verdict: "failed", durationMs: 1000 },
};

/** What the card of a test needs besides its test and its executions, none of which a static rendering uses. */
const TEST_SCREEN = { route: parseRoute("#/tests/view"), source: {}, saving: { pending: false }, onChange: () => undefined } as const;

/** A session whose result says its tests failed. */
const FAILED_SESSION: Session = { ...COMPLETED, result: { ...COMPLETED.result!, outcome: "failed" } };

/** What each screen that names a level says of the smoke level, as a person reads it. */
function levelOnEachScreen(): Readonly<Record<string, string>> {
  const nothing = (): void => undefined;
  return {
    tests: textOf(render(createElement(TestsScreen, { project: "p", route: parseRoute("#/tests"), state: { tests: TESTS }, controls: { search: nothing } }))),
    test: textOf(
      render(
        createElement(TestScreen, {
          ...TEST_SCREEN,
          project: "p",
          path: SMOKE.path,
          tests: { value: TESTS },
          executions: { value: [] },
          versions: {},
        }),
      ),
    ),
    configuration: textOf(render(createElement(DesignCard, { design: { levels: ["smoke"] } }))),
    scope: textOf(
      render(createElement(ScopeCard, { step: { kind: "scope", at: "09:00:00", title: "Portée", environment: "local", applications: [], levels: ["smoke"] } })),
    ),
    session: scopeText({ ...COMPLETED, scope: { levels: ["smoke"] } })!,
    campaign: textOf(
      render(
        createElement(CampaignComposer, {
          tests: { value: [SMOKE] },
          filter: EVERY_TEST,
          chosen: new Set<string>(),
          changed: false,
          saving: false,
          onFilter: nothing,
          onTick: nothing,
          onSave: nothing,
        }),
      ),
    ),
  };
}

/** What each screen that tells a failure says of it, as a person reads it. */
function failureOnEachScreen(): Readonly<Record<string, string>> {
  return {
    execution: textOf(render(createElement(VerdictBadge, { verdict: "failed" }))),
    result: textOf(render(createElement(ResultScreen, { project: "p", id: "e1", path: DETAIL.path, state: { value: READING } }))),
    test: textOf(
      render(
        createElement(TestScreen, {
          ...TEST_SCREEN,
          project: "p",
          path: SMOKE.path,
          tests: { value: TESTS },
          executions: { value: [FAILED_RUN] },
          versions: {},
        }),
      ),
    ),
    session: stateOf(FAILED_SESSION).label,
    campaign: textOf(render(createElement(CampaignVerdictBadge, { counts: { passed: 1, failed: 1, flaky: 0, skipped: 0, not_run: 0 } }))),
  };
}

/** The words each screen once said of a level or a status in its own way; a tag or a file name may still hold a level as it is. */
const OTHER_WORDINGS =
  /(?<![\w@-])(Smoke|smoke|Fumée|fumée|Inter-applications|inter-applications|Cross-application|En échec|en échec|test failed|tests passed)(?![\w-])/;

describe("the vocabulary of the console", () => {
  it("names a level and what it covers, and a level it does not know as it is", () => {
    assert.deepEqual(LEVELS.map(levelName), ["Vérification rapide", "Fonctionnel", "Parcours métier", "Entre applications", "De bout en bout"]);
    assert.equal(levelHint("smoke"), "l’application répond");
    assert.equal(levelName("later"), "later");
  });

  it("names each status, counts it, names each origin and each phase, and a phase it does not know as a step", () => {
    assert.deepEqual((["passed", "failed", "flaky", "skipped", "blocked", "indeterminate", "not_run", "stopped"] as const).map(statusName), [
      "Réussi",
      "Échoué",
      "Instable",
      "Ignoré",
      "Bloqué",
      "Indéterminé",
      "Non joué",
      "Arrêté",
    ]);
    assert.deepEqual([statusCount("failed", 1), statusCount("failed", 2)], ["1 échoué", "2 échoués"]);
    assert.deepEqual((["design", "manual", "campaign"] as const).map(originName), ["Session de l’agent", "Lancement manuel", "Campagne"]);
    assert.deepEqual([phaseName("plan"), phaseName("later")], ["Plan", "Étape"]);
  });

  it("says a level the same way on every screen that names it, in each language", async () => {
    for (const [screen, text] of Object.entries(levelOnEachScreen())) {
      assert.ok(text.includes("Vérification rapide"), screen);
      assert.doesNotMatch(text, OTHER_WORDINGS, screen);
    }
    await inEnglish();
    for (const [screen, text] of Object.entries(levelOnEachScreen())) assert.ok(text.includes("Quick check"), screen);
  });

  it("says a failure the same way on every screen that tells one, in each language", async () => {
    for (const [screen, text] of Object.entries(failureOnEachScreen())) {
      assert.ok(text.includes("Échoué"), screen);
      assert.doesNotMatch(text, OTHER_WORDINGS, screen);
    }
    await inEnglish();
    for (const [screen, text] of Object.entries(failureOnEachScreen())) assert.ok(text.includes("Failed"), screen);
  });
});
