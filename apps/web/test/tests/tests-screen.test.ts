import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import { TestsScreen, testsHref, verdictOf, type TestsControls } from "../../src/tests/tests-screen.tsx";
import type { LastVerdict } from "@open-qa-stack/domain/sessions";
import { INITIAL_TESTS, type TestsState } from "../../src/tests/tests-state.ts";
import { parseRoute } from "../../src/routing/route.ts";
import { linksOf, render, textOf } from "../render.ts";
import { nameApplications } from "../../src/applications/application-names.ts";
import { TESTS } from "./tests-fixture.ts";

/** What the person does on the screen, which a static rendering never calls. */
const CONTROLS: TestsControls = { search: () => assert.fail("nothing is searched") };

/** What came of the tests last: the detail of a policy failed, the home page of the customers passed, the edit form was flaky. */
const VERDICTS: readonly LastVerdict[] = [
  { path: TESTS[1]!.path, title: TESTS[1]!.title, verdict: "failed" },
  { path: TESTS[0]!.path, title: TESTS[0]!.title, verdict: "passed" },
  { path: TESTS[2]!.path, title: TESTS[2]!.title, verdict: "flaky" },
];

/** The screen of an address in a state, as HTML, with what came of the tests last when given. */
const screen = (hash: string, state: TestsState = { tests: TESTS }, verdicts?: readonly LastVerdict[]): string =>
  render(
    createElement(TestsScreen, {
      project: "lakeside-tests",
      route: parseRoute(hash),
      state,
      controls: CONTROLS,
      ...(verdicts === undefined ? {} : { verdicts }),
    }),
  );

describe("the tests of the repository", () => {
  it("says it reads the tests until the instance listed them, and why it could not", () => {
    assert.equal(textOf(screen("#/tests", INITIAL_TESTS)), "Tests Lecture des tests Ils apparaissent dès que l’instance a répondu.");
    assert.match(textOf(screen("#/tests", { unread: "L’instance ne répond pas." })), /Lecture des tests L’instance ne répond pas\.$/);
  });

  it("says the repository holds no test yet", () => {
    assert.match(
      textOf(screen("#/tests", { tests: [] })),
      /Aucun test pour l’instant Les tests du dépôt de tests apparaissent ici dès qu’une session de l’agent en a écrit/,
    );
  });

  it("lists every test application by application, each by its name, with its level, its kind, its domain and functionality, and its steps", () => {
    nameApplications([{ id: "policy-management", name: "Policy Management" }]);
    const text = textOf(screen("#/tests"));
    nameApplications([]);
    assert.match(text, /^Tests 4 tests du dépôt de tests, tels que leurs fichiers sont maintenant\./);
    assert.match(text, /customer-management · 1 test Customer Management answers Vérification rapide 1 étape Pas encore exécuté/);
    assert.match(
      text,
      /Policy Management · 2 tests Display the detail of a policy policies › policy-detail Fonctionnel 2 étapes Pas encore exécuté Compare the edit form of a policy policies › policy-edit Fonctionnel Visuel 1 étape/,
    );
    // A test without a tag is listed all the same, under no application.
    assert.match(text, /Sans application · 1 test A test by hand 0 étape/);
  });

  it("narrows the tests to a level and to the words of a search, which the address keeps, and says when none matches", () => {
    // Each test leads to its screen, by its path.
    assert.deepEqual(
      linksOf(screen("#/tests?q=detail")).filter((link) => link.startsWith("#/tests/view")),
      ["#/tests/view?path=apps%2Fpolicy-management%2Ftests%2Fpolicies%2Fpolicy-detail%2Fpolicy-detail-nominal.spec.ts"],
    );
    assert.deepEqual(
      linksOf(screen("#/tests?q=policy")).filter((link) => !link.startsWith("#/tests/view")),
      [
        "#/tests?q=policy",
        "#/tests?outcome=failed&q=policy",
        "#/tests?outcome=passed&q=policy",
        "#/tests?q=policy",
        "#/tests?level=smoke&q=policy",
        "#/tests?level=functional&q=policy",
        "#/tests?level=business&q=policy",
        "#/tests?level=cross-application&q=policy",
        "#/tests?level=end-to-end&q=policy",
      ],
    );
    const functional = textOf(screen("#/tests?level=functional"));
    assert.match(
      functional,
      /Tous les niveaux 4 Vérification rapide 1 Fonctionnel 2 Parcours métier 0 Entre applications 0 De bout en bout 0 policy-management · 2 tests/,
    );
    assert.doesNotMatch(functional, /Customer Management answers/);
    assert.match(screen("#/tests?level=functional"), /<a class="chip on" href="#\/tests\?level=functional" aria-current="page">/);
    const searched = textOf(screen("#/tests?q=EDIT%20visual"));
    assert.match(searched, /policy-management · 1 test Compare the edit form of a policy/);
    assert.match(textOf(screen("#/tests?q=nothing")), /Aucun test ne correspond Cherchez d’autres mots, ou choisissez un autre niveau\.$/);
  });

  it("links a level, an outcome and the words of a search, and none of empty words", () => {
    assert.deepEqual(
      [testsHref(), testsHref({ level: "smoke", search: "" }), testsHref({ search: "a b" }), testsHref({ level: "smoke", outcome: "failed", search: "a" })],
      ["#/tests", "#/tests?level=smoke", "#/tests?q=a+b", "#/tests?level=smoke&outcome=failed&q=a"],
    );
  });

  it("says what came of each test last, a failure in its tone, and counts the failures of each application", () => {
    const html = screen("#/tests", { tests: TESTS }, VERDICTS);
    const text = textOf(html);
    assert.match(text, /Tous 4 Échoués 1 Réussis 2 Tous les niveaux/);
    assert.match(text, /Customer Management answers Vérification rapide 1 étape Réussi /);
    assert.match(text, /policy-management · 2 tests 1 échoué Display the detail of a policy policies › policy-detail Fonctionnel 2 étapes Échoué /);
    assert.match(
      html,
      /<a class="row tests-row failed" href="#\/tests\/view\?path=[^"]+policy-detail[^"]+"><span class="tests-mark failed" role="img" aria-label="Échoué">/,
    );
    assert.match(html, /<span class="tests-mark flaky" role="img" aria-label="Instable">/);
    assert.match(html, /<span class="tests-mark never" role="img" aria-label="Pas encore exécuté"><\/span>/);
    assert.equal(verdictOf({ ...TESTS[1]!, title: "Another title" }, VERDICTS), undefined);
  });

  it("narrows the tests to those that failed last, or to those that passed, flaky or not", () => {
    const failed = textOf(screen("#/tests?outcome=failed", { tests: TESTS }, VERDICTS));
    assert.match(failed, /Display the detail of a policy/);
    assert.doesNotMatch(failed, /Customer Management answers|Compare the edit form|A test by hand/);
    const passed = textOf(screen("#/tests?outcome=passed", { tests: TESTS }, VERDICTS));
    assert.match(passed, /Customer Management answers.*Compare the edit form/);
    assert.doesNotMatch(passed, /Display the detail of a policy|A test by hand/);
    assert.match(screen("#/tests?outcome=failed", { tests: TESTS }, VERDICTS), /<a class="chip on" href="#\/tests\?outcome=failed" aria-current="page">/);
    assert.match(textOf(screen("#/tests?outcome=other", { tests: TESTS }, VERDICTS)), /A test by hand/);
  });

  it("offers to run the files of the tests that failed again, only when some did and the page can", () => {
    const relaunch = { environments: [], pending: false };
    const offered = render(
      createElement(TestsScreen, {
        project: "p",
        route: parseRoute("#/tests"),
        state: { tests: TESTS },
        controls: CONTROLS,
        verdicts: VERDICTS,
        relaunch,
        onRelaunch: () => {},
      }),
    );
    assert.match(textOf(offered), /Rejouer l’échec/);
    const none = render(
      createElement(TestsScreen, { project: "p", route: parseRoute("#/tests"), state: { tests: TESTS }, controls: CONTROLS, relaunch, onRelaunch: () => {} }),
    );
    assert.doesNotMatch(textOf(none), /Rejouer/);
    assert.doesNotMatch(textOf(screen("#/tests", { tests: TESTS }, VERDICTS)), /Rejouer/);
  });

  it("gives a level the console does not know as its tag says it", () => {
    assert.match(textOf(screen("#/tests", { tests: [{ ...TESTS[0]!, level: "exploratory" }] })), /exploratory/);
  });
});
