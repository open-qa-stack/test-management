import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { TestReading } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../../src/api/polled-state.ts";
import { traceHref, traceViewerSrc } from "../../src/executions/executions-paths.ts";
import { TraceScreen } from "../../src/executions/trace-screen.tsx";
import { at, linksOf, render, textOf } from "../render.ts";
import { DETAIL, READING } from "../tests/tests-fixture.ts";

/** The test of the policies in the execution, read from its run, which kept a trace of it. */
const TRACED: TestReading = { ...READING, ranAt: "2026-11-19T00:29:03.488Z", traced: true };

/** The screen of the trace of the test of the policies in the execution, in the state given, as HTML. */
const screen = (state: PolledState<TestReading>, context?: "hidden"): string =>
  render(createElement(TraceScreen, { route: at(traceHref("e1", DETAIL.path, context)), id: "e1", path: DETAIL.path, state }));

describe("the screen of the trace of a test", () => {
  it("takes the window under a bar that leads back to the result, names the test, its execution and where it failed", () => {
    const html = screen({ value: TRACED });
    assert.match(
      html,
      /^<div class="trace-screen"><header class="trace-bar"><a class="trace-bar-back" href="#\/executions\/result\?id=e1&amp;path=[^"]+" aria-label="Revenir au résultat">/,
    );
    assert.match(
      textOf(html),
      /^Résultat Trace · Display the detail of a policy Exécution du 19 nov\. 2026, \d\d:\d\d Échoué à l’étape 2 Contexte du test Ouvrir dans un onglet ↗ /,
    );
    assert.match(html, /<h1 tabindex="-1">Trace · Display the detail of a policy<\/h1>/);
  });

  it("opens the trace viewer of Playwright the instance serves on the trace of the run, as it is, and in a tab of its own", () => {
    const html = screen({ value: TRACED });
    const src = traceViewerSrc("e1", DETAIL.path);
    assert.equal(src, `/trace-viewer/index.html?trace=${encodeURIComponent(`/api/tests/trace?path=${encodeURIComponent(DETAIL.path)}&execution=e1`)}`);
    const escaped = src.replaceAll("&", "&amp;");
    assert.ok(html.includes(`<iframe class="trace-frame" src="${escaped}" title="Trace de « Display the detail of a policy »" loading="lazy"></iframe>`));
    assert.ok(html.includes(`<a class="btn sm trace-bar-tab" href="${escaped}" target="_blank" rel="noopener">`));
  });

  it("keeps the context of the test beside the viewer: what it expected and received, its steps, and the report of a defect", () => {
    const html = screen({ value: TRACED });
    assert.match(html, /<aside class="trace-context" aria-label="Contexte du test">/);
    assert.match(
      textOf(html),
      /Ce que le test attendait Attendu "1500 CHF" Obtenu "250 CHF" Étapes du test 1\. Open the policy of the customer Fill the search Réussi · 224 ms 2\. Read its amounts Échoué · 5,0 s · attendu "1500 CHF", obtenu "250 CHF" Signaler une anomalie /,
    );
    assert.ok(linksOf(html).includes(`#/tests/view?path=${encodeURIComponent(DETAIL.path)}&panel=report`));
    assert.match(
      html,
      new RegExp(
        `<a class="btn sm primary trace-bar-context" href="${traceHref("e1", DETAIL.path, "hidden").replaceAll("&", "&amp;").replace(/[?.]/g, "\\$&")}" aria-pressed="true">`,
      ),
    );
    const { failedStep: _failed, ...view } = TRACED.view!;
    const passed = screen({ value: { ...TRACED, view: { ...view, status: "expected" } } });
    assert.doesNotMatch(passed, /Ce que le test attendait|Signaler une anomalie|Échoué à l’étape/);
  });

  it("hides the context of the test when the address asks, and offers to show it again", () => {
    const html = screen({ value: TRACED }, "hidden");
    assert.match(html, /^<div class="trace-screen without-context">/);
    assert.doesNotMatch(html, /trace-context/);
    assert.match(
      html,
      new RegExp(
        `<a class="btn sm trace-bar-context" href="${traceHref("e1", DETAIL.path).replaceAll("&", "&amp;").replace(/[?.]/g, "\\$&")}" aria-pressed="false">`,
      ),
    );
  });

  it("leads a phone back to the result, and offers the link of the trace to copy, or the viewer anyway", () => {
    const html = screen({ value: TRACED });
    assert.match(
      textOf(html),
      /La trace Playwright s’ouvre mieux sur un grand écran .* Revenir au résultat Échoue à l’étape 2 sur 2\. Copier le lien de la trace L’ouvrir quand même, en plein écran Le lien ouvre la même trace sur un ordinateur relié à cette instance\.$/,
    );
    assert.match(html, /<button type="button" class="btn primary copy-button">/);
    const { view: _view, ...unread } = TRACED;
    const reading = screen({ value: unread });
    assert.match(textOf(reading), /Revenir au résultat Copier le lien/);
  });

  it("says it reads the test until the instance read it, and why it could not", () => {
    assert.match(textOf(screen({})), /^Résultat Trace · apps\/\S+ e1 Lecture du test Il apparaît dès que l’instance a répondu\.$/);
    assert.match(textOf(screen({ unread: "Down." })), /Lecture du test Down\.$/);
  });

  it("says the run kept no trace of the test, nor read it, and leads back to the result", () => {
    for (const reading of [{ ...TRACED, traced: false }, { path: DETAIL.path }]) {
      const html = screen({ value: reading });
      assert.match(textOf(html), /Aucune trace de ce test Cette exécution ne l’a pas gardée : .* Revenir au résultat$/);
      assert.doesNotMatch(html, /iframe|_blank|trace-bar-context/);
    }
  });
});
