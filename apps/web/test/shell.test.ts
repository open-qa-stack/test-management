import assert from "node:assert/strict";
import { createElement } from "react";
import type { Project } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { MorePage } from "../src/shell/more-page.tsx";
import { Shell, type ShellMenu } from "../src/shell/shell.tsx";
import { at, linksOf, render, textOf } from "./render.ts";
import { speaking } from "./i18n/in-language.ts";

const inEnglish = speaking("en");

/**
 * A project as the API describes it.
 *
 * @param applications - How many applications it has.
 * @returns The project.
 */
function projectWith(applications: number): Project {
  return {
    name: "lakeside-tests",
    applications: Array.from({ length: applications }, (_, rank) => ({ id: `application-${rank}`, name: `Application ${rank}` })),
  };
}

/**
 * Renders the shell around a page.
 *
 * @param hash - The address the console is at.
 * @param props - The project, and whether the instance no longer answers.
 * @returns Its HTML.
 */
function shell(hash: string, props: { readonly project?: Project; readonly unreachable?: boolean; readonly menu?: ShellMenu } = {}): string {
  return render(createElement(Shell, { route: at(hash), ...props }, createElement("p", null, "page")));
}

/**
 * Lists the entries of the menu, then the tabs, the shell marks as the place the console is in.
 *
 * @param hash - The address the console is at.
 * @returns Where each marked entry leads.
 */
function marked(hash: string): string[] {
  return [...shell(hash).matchAll(/<a href="([^"]+)" class="on" aria-current="page">/g)].map((match) => match[1]!);
}

describe("the shell", () => {
  it("frames the page between the bar of a phone and the menu, the tabs of a phone after it", () => {
    const html = shell("#/");
    assert.match(textOf(html), /^✓ Open QA Stack ✓ Open QA Stack Travail Agent /);
    assert.match(
      html,
      /^<div class="shell"><header class="top"><a class="brand" href="#\/agent"><i>✓<\/i><span>Open QA Stack<\/span><\/a><span class="top-project"><\/span><\/header><aside id="shell-sidebar" class="shell-sidebar"><div class="side-head"><a class="brand" href="#\/agent">/,
    );
    assert.match(html, /<\/aside><main class="shell-page"><p>page<\/p><\/main><nav class="tabs" aria-label="Onglets">.*<\/nav><\/div>$/);
  });

  it("lists the agent, the discovery, the review, the tests, the executions, the campaigns, the defects, the applications, the knowledge, the memory and the configuration as links, then the help of the shortcuts, and the tabs of a phone", () => {
    const html = shell("#/");
    assert.match(
      textOf(html),
      /Travail Agent Référentiel Découverte À relire Tests Exécution Exécutions Campagnes Anomalies Projet Applications Connaissances Mémoire Configuration Raccourcis clavier page Agent À relire Tests Exécutions Plus$/,
    );
    assert.deepEqual(linksOf(html), [
      "#/agent",
      "#/agent",
      "#/agent",
      "#/discovery",
      "#/review",
      "#/tests",
      "#/executions",
      "#/campaigns",
      "#/defects",
      "#/applications",
      "#/knowledge",
      "#/memory",
      "#/configuration",
      "#/?keys=open",
      "#/agent",
      "#/review",
      "#/tests",
      "#/executions",
      "#/more",
    ]);
  });

  it("keeps the tabs of a phone to the screens of the navigation: a screen under one of them leads back to it instead", () => {
    assert.match(shell("#/tests"), /<nav class="tabs"/);
    assert.match(shell("#/more"), /<nav class="tabs"/);
    for (const hash of ["#/tests/view?path=a.spec.ts", "#/agent/sessions/s1", "#/knowledge/manuals"]) assert.doesNotMatch(shell(hash), /class="tabs"/, hash);
  });

  it("marks the entry and the tab the console is under, the tab of the other entries under any of them, and nothing elsewhere", () => {
    assert.deepEqual(marked("#/"), ["#/agent", "#/agent"]);
    assert.deepEqual(marked("#/agent"), ["#/agent", "#/agent"]);
    assert.deepEqual(marked("#/agent/sessions/oqas-2026-11-15T14-44-06-348Z"), ["#/agent"]);
    assert.deepEqual(marked("#/review"), ["#/review", "#/review"]);
    assert.deepEqual(marked("#/tests"), ["#/tests", "#/tests"]);
    assert.deepEqual(marked("#/executions"), ["#/executions", "#/executions"]);
    assert.deepEqual(marked("#/configuration"), ["#/configuration", "#/more"]);
    assert.deepEqual(marked("#/knowledge/manuals"), ["#/knowledge"]);
    assert.deepEqual(marked("#/campaigns/view?id=c1"), ["#/campaigns"]);
    assert.deepEqual(marked("#/memory"), ["#/memory", "#/more"]);
    assert.deepEqual(marked("#/more"), ["#/more"]);
    assert.deepEqual(marked("#/nowhere"), []);
  });

  it("opens the help of the shortcuts in a panel over the screen, keeping where the screen is, each named in the language of the console", async () => {
    const closed = shell("#/review?id=a");
    assert.match(
      closed,
      /<div class="side-foot"><a class="side-help" href="#\/review\?id=a&amp;keys=open" aria-haspopup="dialog" aria-keyshortcuts="\?" title="Raccourcis clavier"><svg [^>]*>.*?<\/svg><span class="nav-label">Raccourcis clavier<\/span><\/a><\/div>/,
    );
    assert.doesNotMatch(closed, /<dialog/);
    const open = shell("#/review?id=a&keys=open");
    assert.match(open, /<dialog class="side-panel" aria-labelledby="shell-shortcuts">/);
    assert.match(open, /<a class="side-panel-close" href="#\/review\?id=a"/);
    assert.match(
      textOf(open.slice(open.indexOf("<dialog"))),
      /^Raccourcis clavier Partout \? Ouvrir cette aide Échap Fermer le panneau ouvert Agent Ctrl Entrée Envoyer la demande \(⌘ \+ Entrée sur Mac\) Entrée Envoyer un message à une session Maj Entrée Aller à la ligne dans un message À relire J Test suivant K Test précédent V Valider le test affiché C Demander une correction du test affiché E Écarter le test affiché Fiche d’un test R Relancer le test Résultat d’une exécution ← Étape précédente → Étape suivante$/,
    );
    await inEnglish();
    assert.match(textOf(shell("#/?keys=open")), /Keyboard shortcuts Everywhere \? Open this help Esc Close the open panel Agent Ctrl Enter Send the request/);
  });

  it("has a button beside the mark of the menu that folds it to its icons and unfolds it, when it is given one, and none otherwise", () => {
    const toggle = (): void => undefined;
    const unfolded = shell("#/", { menu: { folded: false, toggle } });
    assert.match(
      unfolded,
      /<div class="side-head"><a class="brand" href="#\/agent"><i>✓<\/i><span>Open QA Stack<\/span><\/a><button type="button" class="menu-toggle" aria-controls="shell-sidebar" aria-expanded="true" aria-label="Replier le menu" title="Replier le menu">/,
    );
    const folded = shell("#/", { menu: { folded: true, toggle } });
    assert.match(folded, /^<div class="shell folded">/);
    assert.match(folded, /<button [^>]*aria-expanded="false" aria-label="Déplier le menu"/);
    assert.doesNotMatch(shell("#/"), /menu-toggle/);
  });

  it("says the instance no longer answers only when it cannot be reached", () => {
    assert.doesNotMatch(shell("#/"), /Hors ligne|role="alert"/);
    assert.doesNotMatch(shell("#/", { unreachable: false }), /Hors ligne/);
    const html = shell("#/", { unreachable: true });
    assert.match(html, /^<div class="shell"><div class="env" role="alert">/);
    assert.match(textOf(html), /^● Hors ligne — l’instance ne répond plus ; la page reprendra seule dès son retour ✓ Open QA Stack/);
  });

  it("names the project in the bar of a phone and over the menu, once the API described it", () => {
    const html = shell("#/", { project: projectWith(2) });
    assert.match(textOf(html), /^✓ Open QA Stack lakeside-tests ✓ Open QA Stack LA lakeside-tests 2 applications · projet Travail Agent/);
    assert.match(html, /<span class="top-project">lakeside-tests<\/span>/);
    assert.match(html, /<span class="proj-avatar">LA<\/span>/);
    assert.doesNotMatch(shell("#/"), /class="proj"/);
  });

  it("does not name a project that has no name yet", () => {
    const html = shell("#/", { project: { applications: projectWith(2).applications } });
    assert.doesNotMatch(html, /class="chip mono"|class="proj"|undefined/);
    assert.match(textOf(html), /^✓ Open QA Stack ✓ Open QA Stack Travail Agent /);
  });

  it("counts the applications of the project as French does, in the singular below two", () => {
    assert.match(textOf(shell("#/", { project: projectWith(0) })), /lakeside-tests 0 application · projet/);
    assert.match(textOf(shell("#/", { project: projectWith(2) })), /lakeside-tests 2 applications · projet/);
  });

  it("is written in English when the console speaks it", async () => {
    await inEnglish();
    const text = textOf(shell("#/", { project: projectWith(1), unreachable: true }));
    assert.match(text, /● Offline — the instance no longer answers; the page picks up by itself once it is back ✓ Open QA Stack lakeside-tests/);
    assert.match(text, /lakeside-tests 1 application · project Work Agent Repository Discovery To review Tests Execution/);
    assert.match(text, /Keyboard shortcuts page Agent To review Tests Executions More$/);
  });
});

describe("the screen of the other entries", () => {
  it("lists, under the heading of their group, the entries the tabs of a phone leave out, each a row that opens it", () => {
    const html = render(createElement(MorePage, { project: "lakeside-tests" }));
    assert.equal(
      textOf(html),
      "lakeside-tests / Plus Plus Référentiel Découverte Exécution Campagnes Anomalies Projet Applications Connaissances Mémoire Configuration",
    );
    assert.deepEqual(linksOf(html), ["#/discovery", "#/campaigns", "#/defects", "#/applications", "#/knowledge", "#/memory", "#/configuration"]);
    assert.match(
      html,
      /<section class="more-group" aria-labelledby="more-repository"><h2 id="more-repository" class="grp">Référentiel<\/h2><div class="more-list"><a class="more-link" href="#\/discovery">/,
    );
  });
});
