import assert from "node:assert/strict";
import { createElement, type ReactNode } from "react";
import type { Session } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { AgentHomeScreen, type AgentHomeScreenProps } from "../../src/agent/agent-home-screen.tsx";
import { linksOf, render, textOf } from "../render.ts";
import { COMPLETED, QUEUED, RUNNING, SESSION_ID } from "./session-fixture.ts";

/** An earlier session that stopped without ending: nothing tells what it was asked. */
const INTERRUPTED: Session = {
  id: "oqas-2026-11-14T09-12-00-000Z",
  openedAt: "2026-11-14T09:12:00.000Z",
  lastEventAt: "2026-11-14T09:13:00.000Z",
  state: "interrupted",
};

/** A session whose agents work on a request the API has not told yet. */
const UNASKED: Session = {
  id: "oqas-2026-11-16T08-00-00-000Z",
  openedAt: "2026-11-16T08:00:00.000Z",
  lastEventAt: "2026-11-16T08:00:01.000Z",
  state: "running",
};

/**
 * The entry of the agent, as an element.
 *
 * @param props - What differs from an entry whose sessions are not listed and where nothing was asked.
 * @returns The element.
 */
function entry(props: Partial<AgentHomeScreenProps> = {}): ReactNode {
  return createElement(AgentHomeScreen, { project: "lakeside-tests", opening: { state: "idle" }, ...props });
}

/**
 * Renders the entry of the agent.
 *
 * @param sessions - The sessions the API listed; none before it answered.
 * @param props - What else differs from an entry where nothing was asked.
 * @returns Its HTML.
 */
function home(sessions?: readonly Session[], props: Partial<AgentHomeScreenProps> = {}): string {
  return render(entry({ ...props, ...(sessions === undefined ? {} : { sessions }) }));
}

describe("the entry of the agent", () => {
  it("is headed by the name of the project, and asks what to test", () => {
    const html = home();
    assert.match(textOf(html), /^lakeside-tests \/ Agent Qu’est-ce qu’on teste \? Dites aux agents quoi tester Démarrer une session Sessions /);
    assert.match(html, /<h1 class="agent-home-title" tabindex="-1">Qu’est-ce qu’on teste \?<\/h1><form class="agent-home-prompt">/);
  });

  it("offers a form that opens a session: a labelled request, required, and a button to send it, idle while the request is empty", () => {
    const html = home();
    assert.match(html, /<label class="sr-only" for="agent-home-request">Dites aux agents quoi tester<\/label>/);
    assert.match(html, /<textarea id="agent-home-request" name="request" required="" placeholder="[^"]+"><\/textarea>/);
    assert.match(html, /<button type="submit" class="btn primary" disabled="" aria-keyshortcuts="Control\+Enter Meta\+Enter">Démarrer une session<\/button>/);
    assert.doesNotMatch(html, /role="alert"|Ouverture…/);
  });

  it("lets the request the address writes be sent at once, but not one of blanks", () => {
    assert.match(
      home([], { request: "tester la recherche" }),
      /<button type="submit" class="btn primary" aria-keyshortcuts="[^"]+">Démarrer une session<\/button>/,
    );
    assert.match(home([], { request: "   " }), /<button type="submit" class="btn primary" disabled=""/);
  });

  it("asks under the request what of the project to keep the session to, once the configuration was read", () => {
    assert.doesNotMatch(home([]), /scope-picker/);
    const choices = {
      environments: ["local"],
      applications: [{ id: "shop", name: "Shop" }],
      domains: [{ id: "quotes", label: "Devis", description: "Les demandes de devis.", sources: [] }],
      levels: ["functional" as const],
    };
    const html = home([], { choices });
    assert.match(
      textOf(html),
      /Environnement : local Applications : toutes toutes Shop Domaines : tous tous Devis — Les demandes de devis\. Niveaux : tous tous Fonctionnel/,
    );
    assert.match(html, /<input type="hidden" name="environment" value="local"\/>/);
  });

  it("locks the form and says it opens the session while the request is sent", () => {
    const html = home([], { opening: { state: "sending" } });
    assert.match(html, /<textarea id="agent-home-request" name="request" required="" disabled="" /);
    assert.match(html, /<button type="submit" class="btn primary" disabled="" aria-keyshortcuts="[^"]+">Ouverture…<\/button>/);
    assert.doesNotMatch(html, /Démarrer une session|role="alert"/);
  });

  it("says why the instance refused to open a session, and lets the person ask again", () => {
    const html = home([], { request: "tester la recherche", opening: { state: "refused", message: "Une session est déjà en cours." } });
    assert.match(
      html,
      /<span class="small agent-home-refused" role="alert">Une session est déjà en cours\.<\/span><button type="submit" class="btn primary" aria-keyshortcuts/,
    );
    assert.doesNotMatch(html, /disabled/);
  });

  it("says why the API could not list the sessions, in place of saying it reads them, until they are listed", () => {
    const html = home(undefined, { unlisted: "The folder of the sessions cannot be read." });
    assert.match(html, /<div class="row small muted" role="status">The folder of the sessions cannot be read\.<\/div><\/section>/);
    assert.doesNotMatch(html, /Lecture des sessions/);
    assert.doesNotMatch(home([COMPLETED], { unlisted: "The folder of the sessions cannot be read." }), /cannot be read|role="status"/);
  });

  it("says it reads the sessions before they are listed, as a status a screen reader announces", () => {
    const html = home();
    assert.match(textOf(html), /Sessions · chaque demande ouvre une session Lecture des sessions…$/);
    assert.match(html, /<div class="row small muted" role="status">Lecture des sessions…<\/div>/);
    assert.deepEqual(linksOf(html), []);
    assert.doesNotMatch(html, /class="state"/);
  });

  it("says a project has no session yet, and when the first will show", () => {
    const html = home([]);
    assert.match(
      textOf(html),
      /Sessions · chaque demande ouvre une session Aucune session pour l’instant La première apparaîtra ici dès qu’une demande sera faite\.$/,
    );
    assert.doesNotMatch(html, /Lecture des sessions/);
  });

  it("starts from what the project holds: the tests that failed, those to review, the domains to cover, each that holds nothing left out", () => {
    const html = home([], { existing: { failing: 12, toReview: 1, domains: 11 } });
    assert.match(
      textOf(html),
      /Démarrer une session Repartir de l’existant Corriger les 12 tests échoués Leur dernier passage a échoué\. Relire le nouveau test Écrit par les agents, en attente de votre décision\. Couvrir un domaine 11 domaines cartographiés dans Découverte\. Sessions/,
    );
    assert.deepEqual(linksOf(html), ["#/tests?outcome=failed", "#/review", "#/discovery"]);
    assert.match(html, /<a class="agent-home-way ko" href="#\/tests\?outcome=failed">/);
    assert.deepEqual(linksOf(home([], { existing: { failing: 0, toReview: 2, domains: 0 } })), ["#/review"]);
    assert.doesNotMatch(home([], { existing: { failing: 0, toReview: 0, domains: 0 } }), /Repartir/);
  });

  it("lists a session per row, with what was asked, its facts and its state", () => {
    const text = textOf(home([RUNNING, COMPLETED, INTERRUPTED]));
    assert.match(text, /Sessions · 1 en direct tester la recherche d'un client En direct 15 nov. 2026, 14:44:06 /);
    assert.match(text, /tester la recherche d'un client Réussi 15 nov. 2026, 14:44:06 · local · 1 min 54 s 1 \/ 1 test réussi /);
    assert.match(text, /Session sans demande Interrompue 14 nov. 2026, 09:12:00$/);
    assert.doesNotMatch(text, /Lecture des sessions|Aucune session/);
  });

  it("says a queued session waits for an agent, where its facts go, without marking it as live", () => {
    const html = home([QUEUED, COMPLETED]);
    assert.match(
      textOf(html),
      /Sessions · chaque demande ouvre une session tester la recherche d'un client En file 15 nov. 2026, 14:44:06 · en attente d’un agent/,
    );
    assert.match(html, new RegExp(`<a class="row run-row" href="#/agent/sessions/${SESSION_ID}">`));
    assert.match(html, /<span class="badge outline">En file<\/span>/);
    assert.match(textOf(home([{ ...UNASKED, state: "queued" }])), /Session sans demande En file 16 nov. 2026, 08:00:00 · en attente d’un agent$/);
  });

  it("names a session nothing was asked of by whether its agents still work, or as the mapping it is", () => {
    const text = textOf(home([UNASKED, { ...UNASKED, state: "completed" }]));
    assert.match(text, /Session en cours En direct 16 nov. 2026, 08:00:00 Session sans demande Terminée 16 nov. 2026, 08:00:00$/);
    assert.match(textOf(home([{ ...UNASKED, purpose: "map" }])), /^.*Cartographie des connaissances En direct 16 nov. 2026, 08:00:00$/);
  });

  it("tells the facts of a result even when it holds no test, and how each session stands", () => {
    const stopped: Session = { ...COMPLETED, result: { outcome: "stopped", durationMs: 42_000, modelRequests: 3, tests: [] } };
    const html = home([stopped, { ...RUNNING, state: "interrupted" }]);
    assert.match(textOf(html), /Arrêté 15 nov. 2026, 14:44:06 · local · 42 s/);
    assert.match(html, /<span class="badge neutral">Arrêté<\/span>/);
    assert.match(html, /<span class="badge warn">Interrompue<\/span>/);
  });

  it("leads from each session to its thread", () => {
    assert.deepEqual(linksOf(home([COMPLETED, INTERRUPTED])), [`#/agent/sessions/${SESSION_ID}`, `#/agent/sessions/${INTERRUPTED.id}`]);
  });

  it("marks the session whose agents work, and counts the live ones in the header of the list", () => {
    const html = home([RUNNING, UNASKED, INTERRUPTED, { ...COMPLETED, id: "oqas-2026-11-13T10-00-00-000Z" }]);
    assert.match(html, new RegExp(`<a class="row run-row live" href="#/agent/sessions/${SESSION_ID}">`));
    assert.match(html, new RegExp(`<a class="row run-row" href="#/agent/sessions/${INTERRUPTED.id}">`));
    assert.match(html, /<a class="row run-row" href="#\/agent\/sessions\/oqas-2026-11-13T10-00-00-000Z">/);
    assert.match(html, /<span class="badge info">En direct<\/span>/);
    assert.match(textOf(html), /Sessions · 2 en direct /);
    assert.match(textOf(home([COMPLETED])), /Sessions · chaque demande ouvre une session tester la recherche/);
  });
});
