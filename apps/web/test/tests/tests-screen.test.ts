import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import { levelHref, TestsScreen, type TestsControls } from "../../src/tests/tests-screen.tsx";
import { INITIAL_TESTS, type TestsState } from "../../src/tests/tests-state.ts";
import { parseRoute } from "../../src/routing/route.ts";
import { linksOf, render, textOf } from "../render.ts";
import { nameApplications } from "../../src/applications/application-names.ts";
import { TESTS } from "./tests-fixture.ts";

/** What the person does on the screen, which a static rendering never calls. */
const CONTROLS: TestsControls = { search: () => assert.fail("nothing is searched") };

/** The screen of an address in a state, as HTML. */
const screen = (hash: string, state: TestsState = { tests: TESTS }): string =>
  render(createElement(TestsScreen, { project: "lakeside-tests", route: parseRoute(hash), state, controls: CONTROLS }));

describe("the tests of the repository", () => {
  it("says it reads the tests until the instance listed them, and why it could not", () => {
    assert.equal(textOf(screen("#/tests", INITIAL_TESTS)), "lakeside-tests / Tests Tests Lecture des tests Ils apparaissent dès que l’instance a répondu.");
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
    assert.match(text, /^lakeside-tests \/ Tests Tests 4 tests du dépôt de tests, tels que leurs fichiers sont maintenant\./);
    assert.match(text, /customer-management · 1 test Customer Management answers Vérification rapide 1 étape/);
    assert.match(
      text,
      /Policy Management · 2 tests Display the detail of a policy policies › policy-detail Fonctionnel 2 étapes Compare the edit form of a policy policies › policy-edit Fonctionnel Visuel 1 étape/,
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

  it("links a level and the words of a search, and none of empty words", () => {
    assert.deepEqual(
      [levelHref(undefined, undefined), levelHref("smoke", ""), levelHref(undefined, "a b")],
      ["#/tests", "#/tests?level=smoke", "#/tests?q=a+b"],
    );
  });

  it("gives a level the console does not know as its tag says it", () => {
    assert.match(textOf(screen("#/tests", { tests: [{ ...TESTS[0]!, level: "exploratory" }] })), /exploratory/);
  });
});
