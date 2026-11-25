import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { RepositoryTest, TestExecution, TestVersion } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../../src/api/polled-state.ts";
import { HISTORY_SIZE, TestScreen } from "../../src/tests/test-screen.tsx";
import { at, linksOf, render, textOf } from "../render.ts";
import { nameApplications } from "../../src/applications/application-names.ts";
import { DETAIL, HANDMADE, SOURCE, TESTS } from "./tests-fixture.ts";

/** What came of the test of the policies in an execution, at an hour of the morning. */
const ran = (id: string, hour: number, verdict: TestExecution["result"]["verdict"], more: Partial<TestExecution> = {}): TestExecution => ({
  id,
  origin: "design",
  ranAt: `2026-11-19T${String(hour).padStart(2, "0")}:00:00.000Z`,
  result: { path: DETAIL.path, title: DETAIL.title, project: "policy-management", verdict, durationMs: 2140 },
  ...more,
});

/** Its executions, the latest first: a failure at a version not committed, then a flaky success at a version, then a success of another of its tests. */
const EXECUTIONS: readonly TestExecution[] = [
  {
    ...ran("e3", 11, "failed", { commit: "4f2a9c01d3b6e8a7f5c2d1e0b9a8c7d6e5f4a3b2" }),
    result: { ...ran("e3", 11, "failed").result, version: 3, committed: false },
  },
  { ...ran("e2", 10, "flaky", { commit: "4f2a9c01d3b6e8a7f5c2d1e0b9a8c7d6e5f4a3b2" }), result: { ...ran("e2", 10, "flaky").result, version: 2 } },
  { ...ran("e1", 9, "passed"), result: { ...ran("e1", 9, "passed").result, title: "Policies › Edit a policy" } },
];

/** A version of the test of the policies, first run at an hour of the morning. */
const version = (number: number, hour: number, more: Partial<TestVersion> = {}): TestVersion => ({
  path: DETAIL.path,
  title: DETAIL.title,
  number,
  digest: `d${number}`,
  since: `2026-11-19T${String(hour).padStart(2, "0")}:00:00.000Z`,
  executions: 1,
  ...more,
});

/** The card of a test of a path, in the states given, as HTML. */
const screen = (
  executions: PolledState<readonly TestExecution[]>,
  tests: PolledState<readonly RepositoryTest[]> = { value: TESTS },
  path = DETAIL.path,
  versions: PolledState<readonly TestVersion[]> = {},
  { source = {}, hash = "#/tests/view" }: { readonly source?: PolledState<string>; readonly hash?: string } = {},
): string =>
  render(
    createElement(TestScreen, {
      project: "lakeside-tests",
      path,
      route: at(hash),
      tests,
      executions,
      versions,
      source,
      saving: { pending: false },
      onChange: () => undefined,
    }),
  );

describe("the card of a test", () => {
  it("says the environment each execution ran against, when it is kept", () => {
    const text = textOf(screen({ value: [{ ...ran("e9", 11, "passed"), environment: "staging" }, ran("e8", 10, "passed")] }));
    assert.match(text, /Session de l’agent · staging 2 s .*Session de l’agent 2 s/);
  });

  it("says it reads the test until the instance told both the tests and its executions, and why it could not", () => {
    assert.equal(
      textOf(screen({}, {})),
      `lakeside-tests / Tests / ${DETAIL.path} ${DETAIL.path} Lecture du test Il apparaît dès que l’instance a répondu. Détails techniques ${DETAIL.path}`,
    );
    assert.match(textOf(screen({}, { unread: "L’instance ne répond pas." })), /Lecture du test L’instance ne répond pas\. Détails techniques /);
    assert.match(textOf(screen({ unread: "Down." })), /Lecture du test Down\. Détails techniques /);
  });

  it("says what the test is, by its tags and its steps as written, and that it never ran, its file under its technical details", () => {
    nameApplications([{ id: "policy-management", name: "Policy Management" }]);
    const text = textOf(screen({ value: [] }));
    nameApplications([]);
    assert.match(
      text,
      /^lakeside-tests \/ Tests \/ Display the detail of a policy Display the detail of a policy Modifier le titre Fonctionnel policies › policy-detail Policy Management /,
    );
    assert.match(
      text,
      /Pas encore exécuté Ses exécutions apparaissent ici dès qu’une session de l’agent, ou une exécution, l’a joué\. Étapes · 2 étapes, telles qu’écrites 1\. Open the policy of the customer Modifier 2\. Read its amounts Modifier Code · Le fichier tel qu’il est dans le dépôt de tests\. Voir le code du test Lecture du fichier… Détails techniques apps\/policy-management\/\S+\.spec\.ts$/,
    );
    assert.match(textOf(screen({ value: [] }, { value: TESTS }, HANDMADE.path)), /Étapes · 0 étape, telle qu’écrite Le fichier ne déclare aucune étape\. Code/);
  });

  it("says what came of it lately, then lists its executions, each leading to what came of it there", () => {
    const html = screen({ value: EXECUTIONS });
    const text = textOf(html);
    assert.match(text, / Échoué (Dernière exécution le \d+ nov\. 2026, \d\d:\d\d) 2 réussites sur les 3 dernières exécutions Voir le dernier résultat → /);
    assert.match(
      text,
      /Exécutions · 3 exécutions, la plus récente d’abord Échoué \d+ nov\. 2026, \d\d:\d\d Session de l’agent · v3 · Version de travail 2 s Instable \d+ nov\. 2026, \d\d:\d\d Session de l’agent · v2 2 s Réussi \d+ nov\. 2026, \d\d:\d\d · Policies › Edit a policy Session de l’agent 2 s Code · /,
    );
    // The commit a version ran at is told to the reader who looks for it, never shown.
    assert.match(html, /<span title="4f2a9c0">v2<\/span>/);
    const uncommitted = { ...ran("e4", 8, "passed"), result: { ...ran("e4", 8, "passed").result, version: 1 } };
    assert.match(screen({ value: [uncommitted] }), /<span>v1<\/span>/, "a version run at no commit names none");
    assert.doesNotMatch(text, /4f2a9c0/);
    // The dots tell the latest executions, the oldest on the left.
    assert.match(
      html,
      /<span class="test-dots" role="img" aria-label="Les dernières exécutions, la plus ancienne à gauche"><span class="test-dot passed" title="Réussi"><\/span><span class="test-dot flaky" title="Instable"><\/span><span class="test-dot failed" title="Échoué"><\/span><\/span>/,
    );
    const result = (id: string) => `#/executions/result?id=${id}&path=${encodeURIComponent(DETAIL.path)}`;
    const panel = (name: string) => `#/tests/view?panel=${encodeURIComponent(name)}`;
    assert.deepEqual(linksOf(html), ["#/tests", panel("title"), result("e3"), panel("step:1"), panel("step:2"), result("e3"), result("e2"), result("e1")]);
    assert.doesNotMatch(textOf(screen({ value: EXECUTIONS.slice(0, 1) })), /sur la dernière exécution/, "one execution says no rate");
  });

  it(`counts no more than the latest ${HISTORY_SIZE} executions`, () => {
    const many = Array.from({ length: HISTORY_SIZE + 2 }, (_, rank) => ran(`e${rank}`, rank, "passed"));
    assert.match(textOf(screen({ value: many })), new RegExp(`${HISTORY_SIZE} réussites sur les ${HISTORY_SIZE} dernières exécutions`));
  });

  it("says a test no longer in the repository is gone, and still lists its executions", () => {
    const text = textOf(screen({ value: EXECUTIONS }, { value: [] }));
    assert.match(
      text,
      /Ce test n’est plus dans le dépôt Son fichier a été renommé ou supprimé ; ses exécutions passées restent listées ici\. Exécutions · 3 exécutions/,
    );
    assert.doesNotMatch(text, /Étapes|Modifier|Code/);
  });

  it("lists its versions, the latest first, each with the commit it was first run committed at, or none", () => {
    const versions = [
      version(3, 11),
      version(2, 10, { commit: "4f2a9c01d3b6e8a7f5c2d1e0b9a8c7d6e5f4a3b2", executions: 2 }),
      version(1, 9, { title: "Policies › Edit a policy" }),
    ];
    const html = screen({ value: EXECUTIONS }, { value: TESTS }, DETAIL.path, { value: versions });
    assert.match(
      textOf(html),
      /Versions · 3 versions, la plus récente d’abord Version 3 Depuis le \d+ nov\. 2026, \d\d:\d\d · 1 exécution Version de travail Version 2 Depuis le \d+ nov\. 2026, \d\d:\d\d · 2 exécutions Version 1 · Policies › Edit a policy Depuis le \d+ nov\. 2026, \d\d:\d\d · 1 exécution Version de travail Exécutions/,
    );
    assert.match(html, /<b title="4f2a9c0">Version 2<\/b>/);
    assert.match(html, /<span title="Jouée avant d’être enregistrée dans le dépôt de tests, comme pendant une conception\.">/);
    assert.doesNotMatch(textOf(screen({ value: EXECUTIONS }, { value: TESTS }, DETAIL.path, { value: [] })), /Versions/);
  });

  it("shows the code of its file, folded, once the instance read it, or why it could not", () => {
    const shown = screen({ value: [] }, { value: TESTS }, DETAIL.path, {}, { source: { value: SOURCE } });
    assert.match(shown, /<details class="test-code"><summary class="row">Voir le code du test<\/summary><pre class="test-code-lines code mono">/);
    assert.match(textOf(shown), /await test\.step\("2\. Read its amounts", async \(\) => \{/);
    assert.match(
      textOf(screen({ value: [] }, { value: TESTS }, DETAIL.path, {}, { source: { unread: "Down." } })),
      /Voir le code du test Down\. Détails techniques /,
    );
  });

  it("opens the panel the route names, over the card", () => {
    const titled = screen({ value: [] }, { value: TESTS }, DETAIL.path, {}, { hash: "#/tests/view?panel=title" });
    assert.match(
      textOf(titled),
      /Titre du test Titre Ce que le test vérifie, en une phrase\. .* Display the detail of a policy .* Annuler Enregistrer Détails techniques /,
    );
    assert.doesNotMatch(screen({ value: [] }), /<dialog/);
  });
});
