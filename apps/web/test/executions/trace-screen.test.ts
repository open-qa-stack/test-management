import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { TestReading } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../../src/api/polled-state.ts";
import { traceViewerSrc } from "../../src/executions/executions-paths.ts";
import { TraceScreen } from "../../src/executions/trace-screen.tsx";
import { linksOf, render, textOf } from "../render.ts";
import { DETAIL, READING } from "../tests/tests-fixture.ts";

/** The test of the policies in the execution, read from its run, which kept a trace of it. */
const TRACED: TestReading = { ...READING, ranAt: "2026-11-19T00:29:03.488Z", traced: true };

/** The screen of the trace of the test of the policies in the execution, in the state given, as HTML. */
const screen = (state: PolledState<TestReading>): string =>
  render(createElement(TraceScreen, { project: "lakeside-tests", id: "e1", path: DETAIL.path, state }));

describe("the screen of the trace of a test", () => {
  it("opens the trace viewer of Playwright the instance serves on the trace of the run, over the page, and in a tab of its own", () => {
    const html = screen({ value: TRACED });
    assert.match(
      textOf(html),
      /^\d+ nov\. 2026, \d\d:\d\d lakeside-tests \/ Exécutions \/ \d+ nov\. 2026, \d\d:\d\d \/ Trace Trace Ouvrir dans un onglet ↗ ← Display the detail of a policy$/,
    );
    const src = traceViewerSrc("e1", DETAIL.path);
    assert.equal(src, `/trace-viewer/index.html?trace=${encodeURIComponent(`/api/tests/trace?path=${encodeURIComponent(DETAIL.path)}&execution=e1`)}`);
    const escaped = src.replaceAll("&", "&amp;");
    assert.ok(html.includes(`<iframe class="trace-frame" src="${escaped}" title="Trace de « Display the detail of a policy »"></iframe>`));
    assert.ok(html.includes(`<a class="btn" href="${escaped}" target="_blank" rel="noopener">`));
    assert.deepEqual(linksOf(html).slice(0, 3), ["#/executions/view?id=e1", "#/executions", "#/executions/view?id=e1"]);
    assert.match(linksOf(html).at(-1)!, /^#\/executions\/result\?id=e1&path=apps%2Fpolicy-management%2F/);
  });

  it("says it reads the test until the instance read it, and why it could not", () => {
    assert.match(textOf(screen({})), /\/ Trace Trace ← apps\/\S+ Lecture du test Il apparaît dès que l’instance a répondu\.$/);
    assert.match(textOf(screen({ unread: "Down." })), /Lecture du test Down\.$/);
  });

  it("says the run kept no trace of the test, nor read it, and leads back to the result", () => {
    for (const reading of [{ ...TRACED, traced: false }, { path: DETAIL.path }]) {
      const html = screen({ value: reading });
      assert.match(textOf(html), /Trace ← .+ Aucune trace de ce test Cette exécution ne l’a pas gardée : .* Revenir au résultat$/);
      assert.doesNotMatch(html, /iframe|_blank/);
    }
  });
});
