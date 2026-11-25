import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { ExecutionFailure, Execution, ExecutionResult, Session } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../../src/api/polled-state.ts";
import { EXECUTION_VIEWS, type ExecutionView } from "../../src/executions/execution-view.ts";
import { ExecutionScreen, failedPaths } from "../../src/executions/execution-screen.tsx";
import { linksOf, render, textOf } from "../render.ts";
import { nameApplications } from "../../src/applications/application-names.ts";
import { DETAIL, EXECUTIONS } from "./executions-fixture.ts";

const [LATEST, PAST] = EXECUTIONS as [Execution, Execution];

/** The session that ran the latest execution. */
const SESSION = { id: LATEST.sessionId, request: "Test the policies", openedAt: "", lastEventAt: "", state: "completed" } as Session;

/** The screen of an execution in a state, with the sessions the console knows, as HTML. */
const screen = (state: PolledState<Execution>, sessions: readonly Session[] = [SESSION], id = LATEST.id, view: ExecutionView = "all"): string =>
  render(
    createElement(ExecutionScreen, {
      view,
      project: "lakeside-tests",
      id,
      sessions,
      state,
      relaunch: { environments: [], pending: false },
      onRelaunch: () => undefined,
    }),
  );

describe("the screen of an execution", () => {
  it("says it reads the execution until the instance read it, and why it could not", () => {
    assert.equal(textOf(screen({}, [], "e9")), "lakeside-tests / Exécutions / e9 e9 Lecture de l’exécution Elle apparaît dès que l’instance a répondu.");
    assert.match(textOf(screen({ unread: "L’instance ne garde plus cette exécution." })), /Lecture de l’exécution L’instance ne garde plus cette exécution\.$/);
  });

  it("says what came of its tests, how long they took, the session that ran it and the version, then its tests by application, the failures first with where and why", () => {
    nameApplications([{ id: "policy-management", name: "Policy Management" }]);
    const text = textOf(screen({ value: LATEST }));
    nameApplications([]);
    assert.match(
      text,
      /^lakeside-tests \/ Exécutions \/ (\d+ nov\. 2026, \d\d:\d\d) Exécution du \1 Relancer l’échec Réussis 3 60 % · 1 instable Échoués 1 Ignorés 1 Corrigés 0 depuis leur dernier passage Durée 9 s Premier passage de ces tests\. Lancée par la session « Test the policies » Voir la session → À regarder · 1 Tous · 5 Nouveaux échecs · 0 Corrigés · 0 Instables · 1 Policy Management · 5 tests Résultat Depuis son dernier passage Test Domaine Durée /,
    );
    assert.match(text, / Détails techniques Version du dépôt de tests : 4f2a9c0$/);
    assert.match(
      text,
      /Domaine Durée Échoué Policies › Edit a policy Étape 3 · Save the policy Attendu "Saved", obtenu "Refused" 5 s Instable Policies › Filter the policies 1 s Réussi Display the detail/,
    );
    const result = `#/executions/result?id=${LATEST.id}&path=${encodeURIComponent(DETAIL)}`;
    assert.deepEqual(linksOf(screen({ value: LATEST })), [
      "#/executions",
      `#/agent/sessions/${LATEST.sessionId}`,
      ...EXECUTION_VIEWS.map((view) => `#/executions/view?id=${LATEST.id}&view=${view}`),
      result,
      result,
      result,
      result,
      result,
    ]);
    // A session the console did not list is named as a session of design all the same.
    assert.match(textOf(screen({ value: LATEST }, [])), /Lancée par une session de l’agent /);
  });

  it("says why a test failed in the first line of its error when its assertion does not say what it expected, and nothing when the failure is not known", () => {
    const failed = LATEST.results.find((result) => result.verdict === "failed")!;
    const told = (failure?: ExecutionFailure) => {
      const { failure: _kept, ...result } = failed;
      return textOf(screen({ value: { ...LATEST, results: [failure === undefined ? result : { ...result, failure }] } }));
    };
    assert.match(told({ message: "Test timeout of 30000ms exceeded." }), /Edit a policy Test timeout of 30000ms exceeded\. 5 s Détails techniques/);
    assert.match(told({ step: { number: 2, title: "Open the policy" } }), /Edit a policy Étape 2 · Open the policy 5 s Détails techniques/);
    assert.match(told(), /Edit a policy 5 s Détails techniques/);
  });

  it("says an execution was launched by hand, or for a campaign, which it leads to", () => {
    assert.match(textOf(screen({ value: { ...PAST, origin: "manual" } })), /Lancée à la main, sans agent\./);
    const html = screen({ value: { ...PAST, origin: "campaign", campaignId: "c1" } });
    assert.match(html, /<a href="#\/campaigns\/view\?id=c1">Lancée pour une campagne →<\/a>/);
  });

  it("says what changed for each test since its last run, and how many of each, or nothing when nothing changed", () => {
    const [passed, failed] = LATEST.results as [ExecutionResult, ExecutionResult];
    const results = [
      { ...passed, previous: "failed" as const },
      { ...failed, previous: "passed" as const },
      { ...failed, previous: "flaky" as const },
      { ...failed, previous: "failed" as const },
    ];
    const text = textOf(screen({ value: { ...LATEST, results } }));
    assert.match(text, /Réussis 1 25 % Échoués 3 dont 2 nouveaux Ignorés 0 Corrigés 1 /);
    assert.match(text, /Échoué Nouvel échec Policies › Edit a policy .*Échoué Déjà en échec Policies .*Réussi Corrigé Display the detail/);
    assert.doesNotMatch(text, /Premier passage/);
  });

  it("says the environment it ran against, and offers it first to run its failures again, while it is declared", () => {
    const html = render(
      createElement(ExecutionScreen, {
        project: "lakeside-tests",
        id: LATEST.id,
        sessions: [],
        state: { value: { ...LATEST, environment: "staging" } },
        relaunch: { environments: ["local", "staging"], pending: false },
        onRelaunch: () => undefined,
      }),
    );
    assert.match(html, /<option value="staging" selected="">staging<\/option><option value="local">/);
    assert.match(textOf(html), /staging Premier passage/);
  });

  it("opens on the tests to look at, shows those of another view, and says a view holds none", () => {
    const told = (view?: ExecutionView, value: Execution = LATEST) =>
      textOf(
        render(
          createElement(ExecutionScreen, {
            ...(view === undefined ? {} : { view }),
            project: "lakeside-tests",
            id: LATEST.id,
            sessions: [],
            state: { value },
            relaunch: { environments: [], pending: false },
            onRelaunch: () => undefined,
          }),
        ),
      );
    assert.match(told(), / Domaine Durée Échoué Policies › Edit a policy/);
    assert.match(told("flaky"), / Domaine Durée Instable Policies › Filter the policies/);
    assert.match(told("fixed"), /Instables · 1 Aucun test dans cette vue\./);
    const passed = { ...LATEST, results: LATEST.results.filter(({ verdict }) => verdict === "passed") };
    assert.match(told(undefined, passed), / Domaine Durée Réussi Display/);
  });

  it("tells the domain of each test, and narrows them to the words of a search, or says none matches", () => {
    const test = { path: DETAIL, title: "Display the detail of a policy", steps: [], tags: [], applications: [], domain: "contracts" };
    const told = (search: string) =>
      render(
        createElement(ExecutionScreen, {
          search,
          tests: [test],
          view: "all",
          project: "lakeside-tests",
          id: LATEST.id,
          sessions: [],
          state: { value: LATEST },
          relaunch: { environments: [], pending: false },
          onRelaunch: () => undefined,
        }),
      );
    assert.match(textOf(told("CONTRACTS  display")), / · 1 test .* Réussi Display the detail of a policy contracts 2 s Détails/);
    assert.ok(linksOf(told("print")).includes(`#/executions/view?id=${LATEST.id}&view=flaky&q=print`));
    assert.match(textOf(told("nowhere")), /Aucun test ne correspond à cette recherche\./);
  });

  it("runs the files of its failures again, each once, but not for a campaign nor without a failure", () => {
    const failed = LATEST.results.find((result) => result.verdict === "failed")!;
    const two = { ...LATEST, results: [failed, failed, ...LATEST.results] };
    assert.match(textOf(screen({ value: two })), /Relancer les 3 échecs/);
    assert.deepEqual(failedPaths(two), [DETAIL]);
    assert.deepEqual(failedPaths(undefined), []);
    for (const value of [{ ...LATEST, campaignId: "c1" }, PAST]) assert.doesNotMatch(textOf(screen({ value })), /Relancer/);
  });

  it("says a past run belongs to no session it keeps, kept no version, and ran no test", () => {
    assert.match(
      textOf(screen({ value: PAST })),
      /Réussis 0 Échoués 0 Ignorés 0 Corrigés 0 depuis leur dernier passage Durée 0 s La session qui l’a lancée n’est plus gardée\. Aucun test n’a tourné dans cette exécution\. Détails techniques Version du dépôt de tests non conservée\.$/,
    );
  });
});
