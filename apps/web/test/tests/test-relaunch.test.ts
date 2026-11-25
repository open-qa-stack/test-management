import assert from "node:assert/strict";
import { createElement, type FormEvent } from "react";
import { describe, it } from "vitest";
import { TestRelaunch, type RelaunchState } from "../../src/tests/test-relaunch.tsx";
import { TestScreen } from "../../src/tests/test-screen.tsx";
import { at, elementsOf, render, textOf } from "../render.ts";
import { DETAIL, TESTS } from "./tests-fixture.ts";

/** The relaunch of the test of the policies, in the state given, as HTML. */
const relaunch = (state: RelaunchState): string => render(createElement(TestRelaunch, { state, onLaunch: () => undefined }));

const LAUNCH = { startedAt: "2026-11-20T10:00:00.000Z", environment: "local", paths: [DETAIL.path] };

describe("the relaunch of a test", () => {
  it("is a button, with the environment to choose when the configuration declares several", () => {
    assert.equal(textOf(relaunch({ environments: ["local"], pending: false })), "Relancer ce test");
    const html = relaunch({ environments: ["local", "staging"], pending: false });
    assert.match(html, /<select name="environment">.*<option value="local" selected="">local<\/option><option value="staging">staging<\/option><\/select>/);
  });

  it("says it is asked, that the test runs, then that it ran, and why the instance refused it", () => {
    assert.match(relaunch({ environments: [], pending: true }), /disabled="">Envoi…<\/button>/);
    assert.match(textOf(relaunch({ environments: [], pending: false, launch: LAUNCH })), /Relance en cours : installation, puis exécution…$/);
    const ran = { ...LAUNCH, progress: { total: 1, finished: [{ path: DETAIL.path, title: DETAIL.title, verdict: "passed" as const }] } };
    assert.match(textOf(relaunch({ environments: [], pending: false, launch: ran })), /Test joué, son résultat arrive…$/);
    assert.match(textOf(relaunch({ environments: [], pending: false, launch: { ...LAUNCH, progress: { finished: [] } } })), /Relance en cours/);
    assert.match(textOf(relaunch({ environments: [], pending: false, refusal: "Une session tourne." })), /Une session tourne\.$/);
  });

  it("leads to the execution the launch kept once it ended, or says why it kept none", () => {
    assert.match(relaunch({ environments: [], pending: false, ended: { execution: "e9" } }), /<a href="#\/executions\/view\?id=e9">Voir le résultat →<\/a>/);
    assert.match(textOf(relaunch({ environments: [], pending: false, ended: { failure: "No report." } })), /No report\.$/);
    assert.match(textOf(relaunch({ environments: [], pending: false, ended: {} })), /Relancer ce test$/);
  });

  it("says how many of several tests ran, under the words of their button", () => {
    const several = { label: "Relancer les 2 échecs", note: "En entier." };
    const ran = { ...LAUNCH, progress: { finished: [{ path: DETAIL.path, title: DETAIL.title, verdict: "passed" as const }] } };
    const html = render(createElement(TestRelaunch, { state: { environments: [], pending: false, launch: ran }, onLaunch: () => undefined, several }));
    assert.match(html, /title="En entier\."/);
    assert.equal(textOf(html), "Relancer les 2 échecs 1 test joué…");
  });

  it("launches the test against the environment chosen, or the one of the project", () => {
    const asked: object[] = [];
    for (const environments of [["local"], ["local", "staging"]]) {
      const [form] = elementsOf(
        createElement(TestRelaunch, { state: { environments, pending: false }, onLaunch: (environment) => asked.push(environment) }),
        "form",
      );
      const currentTarget = { elements: { namedItem: () => ({ value: "staging" }) } };
      (form!["onSubmit"] as (event: FormEvent<HTMLFormElement>) => void)({
        preventDefault: () => undefined,
        currentTarget,
      } as unknown as FormEvent<HTMLFormElement>);
    }
    assert.deepEqual(asked, [{}, { environment: "staging" }]);
  });

  it("is an action of the card of a test when it is offered", () => {
    const card = render(
      createElement(TestScreen, {
        project: "lakeside-tests",
        path: DETAIL.path,
        tests: { value: TESTS },
        executions: { value: [] },
        versions: { value: [] },
        route: at("#/tests/view"),
        source: {},
        saving: { pending: false },
        onChange: () => undefined,
        relaunch: { environments: ["local"], pending: false },
        onRelaunch: () => undefined,
      }),
    );
    assert.match(card, /<div class="actions"><form class="test-relaunch">/);
  });
});
