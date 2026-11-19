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

  it("gives the steps of its latest run, each with its state, its duration and its capture, where it failed, what it expected and what it found", () => {
    const html = screen({ reading: READING });
    const text = textOf(html);
    assert.match(text, /^lakeside-tests \/ Tests \/ Display the detail of a policy Display the detail of a policy /);
    assert.match(text, /Exécution run-2026-11-19T00-29-03-488Z : en échec\. Échec à l’étape 2 Attendu "1500 CHF" Obtenu "250 CHF"/);
    assert.match(
      text,
      /Étapes · 2 étapes 1\. Open the policy of the customer Fill the search Réussie 224 ms 2\. Read its amounts Aucune capture pour cette étape\. En échec 5,0 s/,
    );
    assert.match(
      html,
      /<img class="test-capture" src="\/api\/tests\/capture\?path=apps%2Fpolicy-management%2F[^"]*&amp;step=1" alt="Capture de l’étape 1" loading="lazy"\/>/,
    );
    assert.match(html, /<div class="row test-step failed">/);
    assert.match(
      text,
      /Détails techniques Error: expect\(locator\)\.toHaveText\(\) at policy-detail-nominal\.spec\.ts:9 opened \/work\/\.oqas\/test-results\/trace\.zip$/,
    );
  });

  it("says when the failed assertion does not say what it received, and when the run reported no step", () => {
    const { expected: _, received: __, ...view } = READING.view!;
    assert.match(textOf(screen({ reading: { ...READING, view } })), /Échec à l’étape 2 Le message de l’assertion en échec ne dit pas ce qu’elle a obtenu/);
    const empty = { ...view, steps: [], uncaptured: [], details: { stdout: [], stderr: [], screenshots: [] } };
    const { failedStep: ___, ...passed } = empty;
    assert.match(
      textOf(screen({ reading: { ...READING, view: { ...passed, status: "expected" } } })),
      /: réussi\. Étapes · 0 étape L’exécution n’a rapporté aucune étape de ce test\. Détails techniques$/,
    );
  });
});
