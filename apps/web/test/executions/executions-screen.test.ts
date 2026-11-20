import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { ExecutionList, Session } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../../src/api/polled-state.ts";
import { ExecutionsScreen, type ExecutionsScreenProps } from "../../src/executions/executions-screen.tsx";
import { linksOf, render, textOf } from "../render.ts";
import { DETAIL, EXECUTIONS } from "./executions-fixture.ts";

/** The session that ran the first execution. */
const SESSION = { id: "8d3f1a52-0c4e-4b8a-9e61-7f2a5c9d0b13", request: "Test the policies", openedAt: "", lastEventAt: "", state: "completed" } as Session;

/** The screen in a state, narrowed as the address says, as HTML. */
const screen = (state: PolledState<ExecutionList> = { value: { items: EXECUTIONS } }, more: Partial<ExecutionsScreenProps> = {}): string =>
  render(createElement(ExecutionsScreen, { project: "lakeside-tests", sessions: [SESSION], state, ...more }));

describe("the executions of the tests", () => {
  it("says it reads the executions until the instance listed them, and why it could not", () => {
    assert.equal(textOf(screen({})), "lakeside-tests / Exécutions Exécutions Lecture des exécutions Elles apparaissent dès que l’instance a répondu.");
    assert.match(textOf(screen({ unread: "L’instance ne répond pas." })), /Lecture des exécutions L’instance ne répond pas\.$/);
  });

  it("says the instance keeps no execution yet, and none of an outcome once narrowed to it", () => {
    assert.match(
      textOf(screen({ value: { items: [] } })),
      /Aucune exécution pour l’instant Les exécutions des tests apparaissent ici dès qu’une session de l’agent a lancé/,
    );
    assert.match(
      textOf(screen({ value: { items: [] } }, { outcome: "failing" })),
      /Avec un échec Sans échec Aucune exécution ne correspond Aucune exécution gardée n’a cette issue\.$/,
    );
    assert.match(textOf(screen({ value: { items: [] } }, { before: "e1" })), /Aucune exécution ne correspond/);
  });

  it("shows each execution as a line: its date, its origin, the session that ran it or how many tests, its counts, its duration and its version", () => {
    const text = textOf(screen());
    assert.match(
      text,
      /^lakeside-tests \/ Exécutions Exécutions Les exécutions des tests, la plus récente d’abord\. Toutes Avec un échec Sans échec Date Origine Contenu Résultat Durée Version /,
    );
    assert.match(text, / conception Session « Test the policies » 1 en échec 1 instable 9 s 4f2a9c0 /);
    assert.match(text, / conception 0 test 0 s — Aucun test n’a tourné dans cette exécution\. Ouvrir l’exécution →$/);
  });

  it("says at a glance what came of the tests of an execution: a bar of their verdicts, the failures and the retries in words, or how many passed", () => {
    const html = screen();
    assert.match(
      html,
      /<span class="verdict-bar" aria-hidden="true"><span class="verdict-part passed" style="flex-grow:2"><\/span><span class="verdict-part flaky" style="flex-grow:1"><\/span><span class="verdict-part skipped" style="flex-grow:1"><\/span><span class="verdict-part failed" style="flex-grow:1"><\/span><\/span><span class="verdict-words failed">1 en échec<\/span><span class="verdict-words flaky">1 instable<\/span>/,
    );
    const [latest] = EXECUTIONS;
    const passed = { ...latest!, results: latest!.results.filter((result) => result.verdict === "passed") };
    assert.match(screen({ value: { items: [passed] } }), /<span class="verdict-words passed">2 réussis<\/span>/);
  });

  it("unfolds an execution into its tests, the failures first, each leading to what came of it there, then leads to the execution", () => {
    const text = textOf(screen());
    assert.match(
      text,
      /En échec Policies › Edit a policy · policy-management 5 s Instable Policies › Filter the policies · policy-management 1 s Réussi Display the detail of a policy · policy-management 2 s Réussi Policies › Print a policy · policy-management 1 s Ignoré Policies › Delete a policy · policy-management 0 s Ouvrir l’exécution →/,
    );
    const [first, second] = EXECUTIONS;
    const result = `#/executions/result?id=${first!.id}&path=${encodeURIComponent(DETAIL)}`;
    assert.deepEqual(linksOf(screen()), [
      "#/executions",
      "#/executions?outcome=failing",
      "#/executions?outcome=passing",
      `#/executions/view?id=${first!.id}`,
      result,
      result,
      result,
      result,
      result,
      `#/executions/view?id=${first!.id}`,
      `#/executions/view?id=${second!.id}`,
      `#/executions/view?id=${second!.id}`,
    ]);
  });

  it("marks the outcome chosen, and leads to the older executions and back to the latest ones, keeping the outcome", () => {
    const html = screen({ value: { items: EXECUTIONS, next: "e9" } }, { outcome: "failing", before: "e0" });
    assert.match(html, /<a class="chip on" href="#\/executions\?outcome=failing" aria-current="page">/);
    assert.deepEqual(linksOf(html).slice(-2), ["#/executions?outcome=failing", "#/executions?outcome=failing&before=e9"]);
    assert.match(textOf(html), /← Les plus récentes Plus anciennes →$/);
    // The first page leads to no latest ones, and the last one to no older ones.
    assert.doesNotMatch(textOf(screen()), /Les plus récentes|Plus anciennes/);
  });
});
