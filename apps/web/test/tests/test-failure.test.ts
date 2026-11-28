import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { ExecutionResult, TestExecution } from "@open-qa-stack/domain/sessions";
import { TestFailure } from "../../src/tests/test-failure.tsx";
import { at, linksOf, render, textOf } from "../render.ts";
import { DETAIL } from "./tests-fixture.ts";

const RESULT: ExecutionResult = { path: DETAIL.path, title: DETAIL.title, project: "policy-management", verdict: "failed", durationMs: 6400 };

/** The card of a test whose latest execution is the one given, as HTML. */
const card = (result: ExecutionResult | undefined, report?: string): string => {
  const latest: TestExecution | undefined =
    result === undefined ? undefined : { id: "e1", origin: "manual", ranAt: "2026-11-19T10:00:00.000Z", environment: "local", result };
  return render(createElement(TestFailure, { path: DETAIL.path, steps: 3, latest, ...(report === undefined ? {} : { report }) }));
};

describe("the failure a test opens on", () => {
  it("says the step it failed at out of how many, when and where, and leads to that result", () => {
    const html = card({ ...RESULT, version: 2, failure: { step: { number: 2, title: "Read its amounts" }, expected: "hidden", received: "visible" } });
    assert.match(html, /^<section class="run-outcome ko test-failure" aria-label="Dernier échec">/);
    assert.match(
      textOf(html),
      /^Échoué à l’étape 2 sur 3 19 nov\. 2026, \d\d:\d\d · 6 s · Lancement manuel · local · v2 Voir le dernier résultat Attendu hidden Obtenu visible Lisez d’abord le résultat/,
    );
    assert.equal(linksOf(html)[0], `#/executions/result?id=e1&path=${encodeURIComponent(DETAIL.path)}`);
  });

  it("asks the agent, with the request written, and reports a defect when it can", () => {
    const html = card({ ...RESULT, failure: { step: { number: 2, title: "Read its amounts" } } }, "#/tests/view?panel=report");
    const [, ask, report] = linksOf(html);
    assert.match(
      at(ask!).query["request"]!,
      /^Le test « Display the detail of a policy » \(apps\/.*\) échoue à l’étape 2 \(Read its amounts\)\. Cherche pourquoi\./,
    );
    assert.equal(report, "#/tests/view?panel=report");
    assert.doesNotMatch(textOf(html), /Attendu|Obtenu/);
    assert.match(textOf(card({ ...RESULT, failure: { message: "Error: timeout" } })), /Voir le dernier résultat Error: timeout Lisez/);
    assert.match(at(linksOf(card(RESULT))[1]!).query["request"]!, /spec\.ts\) échoue\. Cherche/);
    assert.match(textOf(card(RESULT)), /^Échoué 19 nov\./);
    assert.doesNotMatch(card(RESULT), /Signaler/);
  });

  it("is nothing for a test that passed, or never ran", () => {
    assert.equal(card({ ...RESULT, verdict: "passed" }), "");
    assert.equal(card(undefined), "");
  });
});
