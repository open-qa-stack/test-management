import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import { ExecutionsScreen } from "../../src/executions/executions-screen.tsx";
import { INITIAL_EXECUTIONS, type ExecutionsState } from "../../src/executions/executions-state.ts";
import { linksOf, render, textOf } from "../render.ts";
import { DETAIL, EXECUTIONS } from "./executions-fixture.ts";

/** The screen in a state, as HTML. */
const screen = (state: ExecutionsState = { executions: EXECUTIONS }): string => render(createElement(ExecutionsScreen, { project: "lakeside-tests", state }));

describe("the executions of the tests", () => {
  it("says it reads the executions until the instance listed them, and why it could not", () => {
    assert.equal(
      textOf(screen(INITIAL_EXECUTIONS)),
      "lakeside-tests / Exécutions Exécutions Lecture des exécutions Elles apparaissent dès que l’instance a répondu.",
    );
    assert.match(textOf(screen({ unread: "L’instance ne répond pas." })), /Lecture des exécutions L’instance ne répond pas\.$/);
  });

  it("says the instance keeps no execution yet", () => {
    assert.match(
      textOf(screen({ executions: [] })),
      /Aucune exécution pour l’instant Les exécutions des tests apparaissent ici dès qu’une session de l’agent a lancé/,
    );
  });

  it("lists each execution the latest first, where it comes from, its version and its counts, then each of its tests with its verdict and its duration", () => {
    const text = textOf(screen());
    assert.match(text, /^lakeside-tests \/ Exécutions Exécutions 2 exécutions des tests, la plus récente d’abord\./);
    assert.match(text, / · conception · commit 4f2a9c0 2 réussis 1 en échec 1 instable 1 ignoré /);
    assert.match(
      text,
      /Réussi Display the detail of a policy apps\/policy-management\/\S+ 2 s En échec Policies › Edit a policy \S+ 5 s Instable Policies › Filter the policies \S+ 1 s Ignoré Policies › Delete a policy \S+ 0 s/,
    );
    // A past run kept no version, and may hold no test.
    assert.match(text, / · conception · version non conservée Aucun test n’a tourné dans cette exécution\.$/);
    assert.doesNotMatch(text, /1 réussis|0 en échec/);
  });

  it("leads from each test of an execution to the screen of the test", () => {
    const href = `#/tests/view?path=${encodeURIComponent(DETAIL)}`;
    assert.deepEqual(linksOf(screen()), [href, href, href, href, href]);
  });
});
