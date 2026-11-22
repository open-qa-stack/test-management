import assert from "node:assert/strict";
import { createElement, type FormEvent } from "react";
import type { Project } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { AgentHomeScreen } from "../src/agent/agent-home-screen.tsx";
import { Console, documentTitleOf, isEntry, isTrace, sessionAt, type ConsoleProps } from "../src/console.tsx";
import { COMPLETED, liveOf, RUNNING, SESSION_ID } from "./agent/session-fixture.ts";
import { at, elementsOf, linksOf, render, textOf } from "./render.ts";

const SESSION = `#/agent/sessions/${SESSION_ID}`;

/** The identifier of a session other than the one of the fixtures. */
const OTHER = "oqas-2026-11-16T08-00-00-000Z";

/** A project as the API describes it. */
const PROJECT: Project = { name: "lakeside-tests", applications: [{ id: "customer-management", name: "Customer Management" }] };

/**
 * Renders the console at an address.
 *
 * @param hash - The address.
 * @param told - What the API told so far.
 * @returns Its HTML.
 */
function consoleAt(hash: string, told: Omit<ConsoleProps, "route"> = {}): string {
  return render(createElement(Console, { route: at(hash), ...told }));
}

/**
 * Reads the page the console shows, the shell around it left out.
 *
 * @param html - The HTML of the console.
 * @returns The text of its main area.
 */
function pageOf(html: string): string {
  return textOf(html.slice(html.indexOf('<main class="shell-page">')));
}

describe("the session a route opens", () => {
  it("is the identifier at the address of a session, and none anywhere else", () => {
    assert.equal(sessionAt(at(SESSION)), SESSION_ID);
    assert.equal(sessionAt(at(`${SESSION}?show=talk`)), SESSION_ID);
    assert.equal(sessionAt(at("#/")), undefined);
    assert.equal(sessionAt(at("#/agent")), undefined);
    assert.equal(sessionAt(at("#/agent/sessions")), undefined);
    assert.equal(sessionAt(at(`${SESSION}/batch`)), undefined);
    assert.equal(sessionAt(at(`#/agent/runs/${SESSION_ID}`)), undefined);
    assert.equal(sessionAt(at(`#/tests/sessions/${SESSION_ID}`)), undefined);
  });
});

describe("the entry of the agent", () => {
  it("is at the home and at the address of the agent, whatever the address keeps, and nowhere else", () => {
    assert.deepEqual(
      ["", "#/", "#/agent", "#/agent?show=talk"].map((hash) => isEntry(at(hash))),
      [true, true, true, true],
    );
    assert.deepEqual(
      ["#/agents", "#/agent/sessions", SESSION, "#/nowhere"].map((hash) => isEntry(at(hash))),
      [false, false, false, false],
    );
  });
});

describe("the title of the page", () => {
  /**
   * The title of the page at an address.
   *
   * @param hash - The address.
   * @param told - What the API told so far.
   * @returns The title.
   */
  const titleAt = (hash: string, told: Omit<ConsoleProps, "route"> = {}): string => documentTitleOf({ route: at(hash), ...told });

  it("names the screen, then the product", () => {
    assert.equal(titleAt("#/agent"), "Agent · Open QA Stack");
    assert.equal(titleAt(""), "Agent · Open QA Stack");
    assert.equal(titleAt("#/nowhere", { live: liveOf() }), "Page introuvable · Open QA Stack");
  });

  it("names a session by what was asked once the API told it, and says before that it opens, or that there is none", () => {
    assert.equal(titleAt(SESSION), "Ouverture de la session… · Open QA Stack");
    assert.equal(titleAt(`#/agent/sessions/${OTHER}`, { live: liveOf() }), "Ouverture de la session… · Open QA Stack");
    assert.equal(titleAt(`${SESSION}?show=talk`, { live: liveOf() }), "tester la recherche d'un client · Open QA Stack");
    assert.equal(titleAt(SESSION, { missing: true }), "Session introuvable · Open QA Stack");
  });
});

describe("the console", () => {
  it("opens on the entry of the agent, at the home and at its own address", () => {
    for (const hash of ["", "#/", "#/agent", "#/agent?show=talk"]) {
      const html = consoleAt(hash);
      assert.match(pageOf(html), /^Projet \/ Agent Qu’est-ce qu’on teste \? .* Démarrer une session .* Lecture des sessions…$/, hash);
      assert.match(html, /^<div class="shell"><header class="top">/, hash);
    }
  });

  it("gives the entry of the agent the project and the sessions the API told", () => {
    const html = consoleAt("#/agent", { project: PROJECT, sessions: [COMPLETED] });
    assert.match(textOf(html), /^✓ Open QA Stack lakeside-tests LA lakeside-tests 1 application · projet/);
    assert.match(pageOf(html), /^lakeside-tests \/ Agent Qu’est-ce qu’on teste \?/);
    assert.ok(linksOf(html).includes(SESSION));
    assert.match(pageOf(consoleAt("#/", { sessions: [] })), /Aucune session pour l’instant/);
  });

  it("gives the entry of the agent where the opening of a session is, and what opens one", () => {
    assert.match(consoleAt("#/agent", { opening: { state: "sending" } }), /<button type="submit" class="btn primary" disabled="">Ouverture…<\/button>/);
    assert.match(consoleAt("#/", { opening: { state: "refused", message: "Demande vide." } }), /role="alert">Demande vide\.<\/span>/);
    const sent: FormEvent<HTMLFormElement>[] = [];
    assert.match(consoleAt("#/agent", { onOpen: () => undefined }), /<form class="agent-home-prompt">/);
    // The entry reads what a session may be kept to as it shows: its form is that of the screen it gives what opens a session.
    const [form] = elementsOf(createElement(AgentHomeScreen, { project: "lakeside", opening: { state: "idle" }, onOpen: (event) => sent.push(event) }), "form");
    const event = {} as FormEvent<HTMLFormElement>;
    (form!["onSubmit"] as (event: FormEvent<HTMLFormElement>) => void)(event);
    assert.equal(sent.length, 1);
    assert.equal(sent[0], event);
  });

  it("says why the API could not list the sessions on the entry of the agent", () => {
    assert.match(pageOf(consoleAt("#/agent", { unlisted: "The folder of the sessions cannot be read." })), /The folder of the sessions cannot be read\.$/);
  });

  it("shows a session once the API told it, whether the project lists it or not, under the name of the project", () => {
    for (const sessions of [[RUNNING], [], undefined]) {
      const html = consoleAt(SESSION, {
        live: liveOf(),
        project: { name: "lakeside-tests", applications: [] },
        ...(sessions === undefined ? {} : { sessions }),
      });
      assert.match(pageOf(html), /^lakeside-tests \/ Agent \/ tester la recherche d'un client tester la recherche d'un client en direct/);
      assert.match(html, /<section class="thread" aria-label="Fil de la session">/);
    }
    assert.match(pageOf(consoleAt(`${SESSION}?show=talk`, { live: liveOf(COMPLETED) })), /^Projet \/ Agent \/ tester la recherche d'un client/);
  });

  it("names the project by a word of its own while the instance has none", () => {
    assert.match(pageOf(consoleAt("#/agent", { project: { applications: [] } })), /^Projet \/ Agent /);
  });

  it("says it opens a session until the API told it, whatever the project lists", () => {
    const opening = new RegExp(
      `^Projet / Agent / ${SESSION_ID} Ouverture de la session… Lecture de la session Son fil apparaît dès que l’instance a répondu\\. Revenir aux sessions$`,
    );
    assert.match(pageOf(consoleAt(SESSION)), opening);
    assert.match(pageOf(consoleAt(SESSION, { sessions: [RUNNING] })), opening);
    assert.match(pageOf(consoleAt(SESSION, { sessions: [], missing: false })), opening);
    assert.deepEqual(linksOf(consoleAt(SESSION)).slice(-2), ["#/agent", "#/agent"]);
  });

  it("does not show another session than the one the address opens", () => {
    for (const told of [{ live: liveOf() }, { live: liveOf(), sessions: [RUNNING, { ...RUNNING, id: OTHER }] }]) {
      const html = consoleAt(`#/agent/sessions/${OTHER}`, told);
      assert.match(pageOf(html), new RegExp(`^Projet / Agent / ${OTHER} Ouverture de la session…`));
      assert.doesNotMatch(html, /class="thread"/);
    }
  });

  it("says a session is not found only once the instance said it keeps none of that name", () => {
    assert.equal(
      pageOf(consoleAt(SESSION, { missing: true, sessions: [RUNNING], project: { name: "lakeside-tests", applications: [] } })),
      "lakeside-tests / Session introuvable Session introuvable Le projet ne garde aucune session de ce nom Elle a peut-être été supprimée. Revenir aux sessions",
    );
  });

  it("shows the knowledge and its sources at their addresses, which read them from the instance", () => {
    assert.equal(
      pageOf(consoleAt("#/knowledge", { project: PROJECT })),
      "lakeside-tests / Connaissances Connaissances Configurer le projet Lecture des connaissances Elles apparaissent dès que l’instance a répondu.",
    );
    assert.match(
      pageOf(consoleAt("#/knowledge/manuals", { project: PROJECT })),
      /^lakeside-tests \/ Connaissances \/ manuals manuals Lecture des connaissances/,
    );
    assert.equal(documentTitleOf({ route: at("#/knowledge/manuals") }), "Connaissances · Open QA Stack");
    assert.match(pageOf(consoleAt("#/knowledge/manuals/more")), /Page introuvable/);
  });

  it("shows the tests at their address, which lists them from the instance", () => {
    assert.equal(
      pageOf(consoleAt("#/tests", { project: PROJECT })),
      "lakeside-tests / Tests Tests Lecture des tests Ils apparaissent dès que l’instance a répondu.",
    );
    assert.equal(documentTitleOf({ route: at("#/tests?level=smoke") }), "Tests · Open QA Stack");
    assert.match(pageOf(consoleAt("#/tests/more")), /Page introuvable/);
    // A test is opened by its path; without one, the address leads nowhere.
    assert.match(
      pageOf(consoleAt("#/tests/view?path=apps%2Fshop%2Forders.spec.ts", { project: PROJECT })),
      /^lakeside-tests \/ Tests \/ apps\/shop\/orders\.spec\.ts .* Lecture du test/,
    );
    assert.equal(documentTitleOf({ route: at("#/tests/view?path=apps%2Fshop%2Forders.spec.ts") }), "Test · Open QA Stack");
    for (const hash of ["#/tests/view", "#/tests/view?path="]) assert.match(pageOf(consoleAt(hash)), /Page introuvable/);
  });

  it("shows the executions at their address, which lists them from the instance", () => {
    assert.equal(
      pageOf(consoleAt("#/executions", { project: PROJECT })),
      "lakeside-tests / Exécutions Exécutions Lecture des exécutions Elles apparaissent dès que l’instance a répondu.",
    );
    assert.equal(documentTitleOf({ route: at("#/executions") }), "Exécutions · Open QA Stack");
    // A page is narrowed to an outcome and a period the console knows, and starts after the execution the address names.
    for (const query of ["outcome=failing", "outcome=passing", "outcome=other", "period=week", "period=year", "before=e1", "before="])
      assert.match(pageOf(consoleAt(`#/executions?${query}`)), /Lecture des exécutions/);
    for (const hash of [
      "#/executions/more",
      "#/executions/view",
      "#/executions/view?id=",
      "#/executions/result?id=e1",
      "#/executions/result?path=a.spec.ts",
      "#/executions/view/e1",
    ])
      assert.match(pageOf(consoleAt(hash)), /Page introuvable/, hash);
  });

  it("shows the campaigns and one campaign at their addresses, which read them from the instance", () => {
    assert.match(
      pageOf(consoleAt("#/campaigns", { project: PROJECT })),
      /^lakeside-tests \/ Campagnes Campagnes .* Planifier une campagne .* Lecture des campagnes/,
    );
    assert.equal(documentTitleOf({ route: at("#/campaigns") }), "Campagnes · Open QA Stack");
    assert.equal(
      pageOf(consoleAt("#/campaigns/view?id=c1", { project: PROJECT })),
      "lakeside-tests / Campagnes / c1 c1 Lecture de la campagne Elle apparaît dès que l’instance a répondu.",
    );
    assert.equal(documentTitleOf({ route: at("#/campaigns/view?id=c1") }), "Campagne · Open QA Stack");
    for (const hash of ["#/campaigns/view", "#/campaigns/view?id=", "#/campaigns/c1", "#/campaigns/view/c1"])
      assert.match(pageOf(consoleAt(hash)), /Page introuvable/, hash);
  });

  it("shows an execution, and what came of a test in it, at their addresses", () => {
    assert.equal(
      pageOf(consoleAt("#/executions/view?id=e1", { project: PROJECT })),
      "lakeside-tests / Exécutions / e1 e1 Lecture de l’exécution Elle apparaît dès que l’instance a répondu.",
    );
    assert.equal(documentTitleOf({ route: at("#/executions/view?id=e1") }), "Exécution · Open QA Stack");
    assert.match(
      pageOf(consoleAt("#/executions/result?id=e1&path=apps%2Fshop%2Forders.spec.ts", { project: PROJECT })),
      /^lakeside-tests \/ Exécutions \/ e1 \/ apps\/shop\/orders\.spec\.ts .* Lecture du test/,
    );
    assert.equal(documentTitleOf({ route: at("#/executions/result?id=e1&path=a.spec.ts") }), "Résultat d’un test · Open QA Stack");
    // The trace of a test in an execution has its own screen; an address that does not name both leads nowhere.
    assert.match(
      pageOf(consoleAt("#/executions/trace?id=e1&path=apps%2Fshop%2Forders.spec.ts", { project: PROJECT })),
      /^lakeside-tests \/ Exécutions \/ e1 \/ Trace Trace ← apps\/shop\/orders\.spec\.ts Lecture du test/,
    );
    assert.equal(documentTitleOf({ route: at("#/executions/trace?id=e1&path=a.spec.ts") }), "Trace d’un test · Open QA Stack");
    for (const hash of ["#/executions/trace?id=e1", "#/executions/trace?path=a.spec.ts"]) assert.match(pageOf(consoleAt(hash)), /Page introuvable/, hash);
    assert.deepEqual(
      ["#/executions/trace?id=e1&path=a", "#/executions/trace", "#/executions/result?id=e1&path=a", "#/executions/trace/more", "#/tests/trace"].map((hash) =>
        isTrace(at(hash)),
      ),
      [true, true, false, false, false],
    );
    // The step the address names is shown when it is a number from 1; another word is no step, and the screen chooses.
    for (const step of ["2", "0", "two"]) assert.match(pageOf(consoleAt(`#/executions/result?id=e1&path=a.spec.ts&step=${step}`)), /Lecture du test/);
  });

  it("frames every screen with the menu it is given, which the shell folds", () => {
    assert.match(consoleAt("#/executions", { menu: { folded: true, toggle: () => undefined } }), /^<div class="shell folded">/);
  });

  it("shows the configuration at its address, which reads it from the instance", () => {
    const html = consoleAt("#/configuration", { project: PROJECT });
    assert.equal(pageOf(html), "lakeside-tests / Configuration Configuration Lecture de la configuration Elle apparaît dès que l’instance a répondu.");
    assert.equal(documentTitleOf({ route: at("#/configuration") }), "Configuration · Open QA Stack");
    assert.match(pageOf(consoleAt("#/configuration/more")), /Page introuvable/);
    assert.match(
      pageOf(consoleAt("#/configuration/applications/shop", { project: PROJECT })),
      /^lakeside-tests \/ Configuration \/ shop shop Lecture de la configuration/,
    );
    assert.match(pageOf(consoleAt("#/configuration/applications?add=application")), /Nouvelle application/);
    assert.match(pageOf(consoleAt("#/configuration/applications/shop/more")), /Page introuvable/);
    // Told what reads the project again once a change is saved, the screen shows the same until one is.
    assert.equal(pageOf(consoleAt("#/configuration", { project: PROJECT, onConfigured: () => undefined })), pageOf(html));
  });

  it("says an address leads nowhere, and how to come back", () => {
    for (const hash of ["#/nowhere", "#/agent/sessions", `${SESSION}/batch`, "#/agent/nowhere"]) {
      const html = consoleAt(hash, { sessions: [RUNNING] });
      assert.equal(
        pageOf(html),
        "Projet / Page introuvable Page introuvable Cette adresse ne mène à aucun écran Le lien est peut-être ancien, ou l’écran n’existe pas encore. Revenir aux sessions",
        hash,
      );
      assert.equal(linksOf(html).at(-1), "#/agent", hash);
      assert.match(html, /^<div class="shell">/, hash);
    }
  });

  it("says the instance cannot be reached over whatever it shows", () => {
    assert.doesNotMatch(consoleAt("#/agent"), /Hors ligne/);
    assert.match(textOf(consoleAt("#/agent", { unreachable: true, sessions: [COMPLETED] })), /^● Hors ligne — l’instance ne répond plus/);
    assert.match(textOf(consoleAt(SESSION, { unreachable: true, live: liveOf() })), /^● Hors ligne /);
    assert.match(textOf(consoleAt("#/nowhere", { unreachable: true })), /^● Hors ligne /);
  });

  it("leads only to screens that exist", () => {
    const told = { live: liveOf(), sessions: [RUNNING] };
    for (const from of ["#/agent", SESSION, "#/nowhere"]) {
      for (const link of linksOf(consoleAt(from, told))) {
        assert.doesNotMatch(consoleAt(link, told), /introuvable|Ouverture de la session/, `${link}, from ${from}`);
      }
    }
  });
});
