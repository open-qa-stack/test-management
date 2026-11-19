import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import { TestScreen } from "../../src/tests/test-screen.tsx";
import { INITIAL_TEST, type TestState } from "../../src/tests/test-state.ts";
import { linksOf, render, textOf } from "../render.ts";
import { DETAIL, READING } from "./tests-fixture.ts";

/** The screen of the test of the policies in a state, as HTML. */
const screen = (state: TestState): string => render(createElement(TestScreen, { project: "lakeside-tests", path: DETAIL.path, state }));

describe("the screen of a test", () => {
  it("says it reads the test until the instance read it, and why it could not, under the path of the test", () => {
    assert.equal(
      textOf(screen(INITIAL_TEST)),
      `lakeside-tests / Tests / ${DETAIL.path} ${DETAIL.path} ${DETAIL.path} Lecture du test Il apparaît dès que l’instance a répondu.`,
    );
    assert.match(textOf(screen({ unread: "L’instance ne répond pas." })), /Lecture du test L’instance ne répond pas\.$/);
    assert.deepEqual(linksOf(screen(INITIAL_TEST)), ["#/tests"]);
  });

  it("says no run ran the test yet", () => {
    assert.match(
      textOf(screen({ reading: { path: DETAIL.path } })),
      /Ce test n’a pas encore été exécuté Ses étapes apparaissent ici dès qu’une session de l’agent, ou une exécution, l’a joué\.$/,
    );
  });

  it("says how its latest run ended and where it failed, what it expected and found, then its steps, and shows the page at the step that failed", () => {
    const html = screen({ reading: READING });
    const text = textOf(html);
    assert.match(text, /^lakeside-tests \/ Tests \/ Display the detail of a policy Display the detail of a policy /);
    assert.match(text, /en échec Échoue à l’étape 2 sur 2\. Exécution run-2026-11-19T00-29-03-488Z Attendu "1500 CHF" Obtenu "250 CHF"/);
    assert.match(text, /Étapes · 2 étapes 1 ✓ 1\. Open the policy of the customer Fill the search 224 ms 2 ✕ 2\. Read its amounts 5,0 s/);
    // The step that failed is shown: the run kept no capture of it.
    assert.match(text, /Écran à l’étape 2 Aucune capture pour cette étape\. Détails techniques/);
    assert.match(html, /<a class="row test-step failed on" href="#\/tests\/view\?path=apps%2Fpolicy-management%2F[^"]*&amp;step=2" aria-current="step">/);
    assert.match(
      text,
      /Détails techniques Error: expect\(locator\)\.toHaveText\(\) at policy-detail-nominal\.spec\.ts:9 opened \/work\/\.oqas\/test-results\/trace\.zip$/,
    );
  });

  it("dates the run that ran it, and shows the page at the step the address asks for, whole width", () => {
    const html = render(
      createElement(TestScreen, {
        project: "lakeside-tests",
        path: DETAIL.path,
        step: 1,
        state: { reading: { ...READING, ranAt: "2026-11-19T00:29:03.488Z" } },
      }),
    );
    assert.match(textOf(html), /Échoue à l’étape 2 sur 2\. Exécution du \d{2}\/\d{2}\/2026 \d{2}:\d{2} /);
    assert.match(textOf(html), /Écran à l’étape 1 Détails/);
    assert.match(html, /<img class="test-capture" src="\/api\/tests\/capture\?path=apps%2Fpolicy-management%2F[^"]*&amp;step=1" alt="Capture de l’étape 1"\/>/);
    assert.match(html, /<a class="row test-step on" href="[^"]*&amp;step=1" aria-current="step">/);
    // A step the test does not have is no step to show: the one that failed is.
    assert.match(textOf(screen({ reading: READING })), /Écran à l’étape 2/);
    assert.match(
      textOf(render(createElement(TestScreen, { project: "lakeside-tests", path: DETAIL.path, step: 9, state: { reading: READING } }))),
      /Écran à l’étape 2/,
    );
  });

  it("says how a run that did not fail went, and shows the page at the last step it captured", () => {
    const { failedStep: _, expected: __, received: ___, ...rest } = READING.view!;
    const steps = rest.steps.map((step) => ({ ...step, state: "passed" as const }));
    const read = (status: "expected" | "flaky" | "skipped", shown = steps) =>
      textOf(screen({ reading: { ...READING, view: { ...rest, steps: shown, status } } }));
    assert.match(read("expected"), /réussi Réussit ses 2 étapes\. .* Écran à l’étape 1 /);
    assert.match(read("flaky", steps.slice(0, 1)), /réussi après une nouvelle tentative Réussit son étape après une nouvelle tentative\./);
    // Without any capture, the page shown is that of the first step.
    assert.match(
      read(
        "expected",
        steps.map(({ capture: _capture, ...step }) => step),
      ),
      /Écran à l’étape 1 Aucune capture pour cette étape\./,
    );
    assert.match(read("skipped", []), /ignoré A été ignoré\. .*Étapes · 0 étape L’exécution n’a rapporté aucune étape de ce test\. Détails techniques /);
  });

  it("says when the failed assertion does not say what it received", () => {
    const { expected: _, received: __, ...view } = READING.view!;
    assert.match(
      textOf(screen({ reading: { ...READING, view } })),
      /Échoue à l’étape 2 sur 2\. Exécution \S+ Le message de l’assertion en échec ne dit pas ce qu’elle a obtenu/,
    );
    // A failure the report tells without a step that failed is told as such.
    const { failedStep: ___, ...unplaced } = view;
    assert.match(textOf(screen({ reading: { ...READING, view: unplaced } })), /en échec Échoue\. Exécution/);
  });
});
