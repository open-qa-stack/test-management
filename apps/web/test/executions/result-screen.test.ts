import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { TestReading } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../../src/api/polled-state.ts";
import { ResultScreen } from "../../src/executions/result-screen.tsx";
import { linksOf, render, textOf } from "../render.ts";
import { DETAIL, READING } from "../tests/tests-fixture.ts";

/** The reading of the test in the execution, dated by it. */
const RAN = { ...READING, ranAt: "2026-11-19T00:29:03.488Z" };

/** The screen of what came of the test of the policies in the execution `e1`, in a state, at the step asked, as HTML. */
const screen = (state: PolledState<TestReading>, step?: number): string =>
  render(createElement(ResultScreen, { project: "lakeside-tests", id: "e1", path: DETAIL.path, state, ...(step === undefined ? {} : { step }) }));

describe("the screen of what came of a test in an execution", () => {
  it("says it reads the test until the instance read it, and why it could not, under the way to the card of the test", () => {
    assert.equal(
      textOf(screen({})),
      `lakeside-tests / Exécutions / e1 / ${DETAIL.path} ${DETAIL.path} Fiche du test → Lecture du test Il apparaît dès que l’instance a répondu.`,
    );
    assert.match(textOf(screen({ unread: "L’instance ne répond pas." })), /Lecture du test L’instance ne répond pas\.$/);
    assert.deepEqual(linksOf(screen({})), ["#/executions", "#/executions/view?id=e1", `#/tests/view?path=${encodeURIComponent(DETAIL.path)}`]);
  });

  it("says the detail of the execution is gone, when its report is", () => {
    assert.match(
      textOf(screen({ value: { path: DETAIL.path } })),
      /Le détail de cette exécution n’est plus disponible Son rapport a été supprimé, ou ne contient pas ce test\.$/,
    );
  });

  it("says how the test ended and where it failed, what it expected and found, then its steps, and shows the page at the step that failed", () => {
    const html = screen({ value: RAN });
    const text = textOf(html);
    assert.match(
      text,
      /^lakeside-tests \/ Exécutions \/ \d+ nov\. 2026, \d\d:\d\d \/ Display the detail of a policy Display the detail of a policy Fiche du test →/,
    );
    assert.match(text, /Échoué Échoue à l’étape 2 sur 2\. Attendu "1500 CHF" Obtenu "250 CHF"/);
    assert.match(text, /Étapes · 2 étapes 1 ✓ 1\. Open the policy of the customer Fill the search 224 ms 2 ✕ 2\. Read its amounts 5,0 s/);
    // The step that failed is shown: the run kept no capture of it.
    assert.match(text, /Écran à l’étape 2 Aucune capture pour cette étape\. Détails techniques/);
    assert.match(
      html,
      /<a class="row test-step failed on" href="#\/executions\/result\?id=e1&amp;path=apps%2Fpolicy-management%2F[^"]*&amp;step=2" aria-current="step">/,
    );
    assert.match(
      text,
      /Détails techniques Error: expect\(locator\)\.toHaveText\(\) at policy-detail-nominal\.spec\.ts:9 opened apps\/policy-management\/tests\/policies\/policy-detail\/policy-detail-nominal\.spec\.ts \/work\/\.oqas\/test-results\/trace\.zip$/,
    );
  });

  it("leads to the trace of the test, only when its run kept one", () => {
    const trace = "#/executions/trace?id=e1&path=apps%2Fpolicy-management%2F";
    assert.match(textOf(screen({ value: { ...RAN, traced: true } })), /Fiche du test → · Voir la trace →/);
    assert.ok(linksOf(screen({ value: { ...RAN, traced: true } })).some((link) => link.startsWith(trace)));
    assert.ok(!linksOf(screen({ value: { ...RAN, traced: false } })).some((link) => link.startsWith(trace)));
  });

  it("shows the page at the step the address asks for, whole width, from the run of the execution", () => {
    const html = screen({ value: RAN }, 1);
    assert.match(textOf(html), /Écran à l’étape 1 Détails/);
    assert.match(
      html,
      /<img class="test-capture" src="\/api\/tests\/capture\?path=apps%2Fpolicy-management%2F[^"]*&amp;step=1&amp;execution=e1" alt="Capture de l’étape 1"\/>/,
    );
    assert.match(html, /<a class="row test-step on" href="[^"]*&amp;step=1" aria-current="step">/);
    // A step the test does not have is no step to show: the one that failed is.
    assert.match(textOf(screen({ value: RAN }, 9)), /Écran à l’étape 2/);
  });

  it("says how a run that did not fail went, and shows the page at the last step it captured", () => {
    const { failedStep: _, expected: __, received: ___, ...rest } = READING.view!;
    const steps = rest.steps.map((step) => ({ ...step, state: "passed" as const }));
    const read = (status: "expected" | "flaky" | "skipped", shown = steps) =>
      textOf(screen({ value: { ...READING, view: { ...rest, steps: shown, status } } }));
    assert.match(read("expected"), /Réussi Réussit ses 2 étapes\. .* Écran à l’étape 1 /);
    assert.match(read("flaky", steps.slice(0, 1)), /Instable Réussit son étape après une nouvelle tentative\./);
    // Without any capture, the page shown is that of the first step.
    assert.match(
      read(
        "expected",
        steps.map(({ capture: _capture, ...step }) => step),
      ),
      /Écran à l’étape 1 Aucune capture pour cette étape\./,
    );
    assert.match(read("skipped", []), /Ignoré A été ignoré\. .*Étapes · 0 étape L’exécution n’a rapporté aucune étape de ce test\. Détails techniques /);
  });

  it("says when the failed assertion does not say what it received", () => {
    const { expected: _, received: __, ...view } = READING.view!;
    assert.match(
      textOf(screen({ value: { ...READING, view } })),
      /Échoue à l’étape 2 sur 2\. Le message de l’assertion en échec ne dit pas ce qu’elle a obtenu/,
    );
    // A failure the report tells without a step that failed is told as such.
    const { failedStep: ___, ...unplaced } = view;
    assert.match(textOf(screen({ value: { ...READING, view: unplaced } })), /Échoué Échoue\. Étapes/);
  });
});
