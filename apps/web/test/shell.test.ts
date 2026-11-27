import assert from "node:assert/strict";
import { createElement } from "react";
import type { Project } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { NAVIGATION } from "../src/shell/navigation.ts";
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
 * Lists the entries of the navigation the shell marks as the place the console is in.
 *
 * @param hash - The address the console is at.
 * @returns Where each marked entry leads.
 */
function marked(hash: string): string[] {
  return [...shell(hash).matchAll(/<a href="([^"]+)" class="on" aria-current="page">/g)].map((match) => match[1]!);
}

describe("the shell", () => {
  it("frames the page between the top bar and the navigation", () => {
    const html = shell("#/");
    assert.match(textOf(html), /^✓ Open QA Stack Agent Menu Travail Agent /);
    assert.match(
      html,
      /<aside id="shell-sidebar" class="shell-sidebar"><nav class="nav" aria-label="Navigation principale">.*<\/aside><main class="shell-page"><p>page<\/p><\/main><\/div>$/,
    );
    assert.match(html, /<a class="brand" href="#\/agent">/);
  });

  it("lists the agent, the discovery, the review, the tests, the executions, the campaigns, the applications, the knowledge and the configuration as links, and what is coming as a name without one", () => {
    const html = shell("#/");
    assert.match(
      textOf(html),
      /Travail Agent Référentiel Découverte À relire Tests Couverture bientôt Exécution Exécutions Campagnes Anomalies Projet Applications Connaissances Configuration page$/,
    );
    assert.deepEqual(linksOf(html), [
      "#/agent",
      "#/?nav=open",
      "#/agent",
      "#/discovery",
      "#/review",
      "#/tests",
      "#/executions",
      "#/campaigns",
      "#/defects",
      "#/applications",
      "#/knowledge",
      "#/configuration",
    ]);
    const coming = NAVIGATION.flatMap((group) => group.entries).filter((entry) => entry.path === undefined);
    assert.equal((html.match(/<span class="nav-soon">/g) ?? []).length, coming.length);
    assert.equal(coming.length, 1);
  });

  it("marks the agent at the home, at its entry and under it, the tests, the executions, the campaigns and the configuration at their own, and nowhere else", () => {
    assert.deepEqual(marked("#/"), ["#/agent"]);
    assert.deepEqual(marked("#/configuration"), ["#/configuration"]);
    assert.deepEqual(marked("#/knowledge/manuals"), ["#/knowledge"]);
    assert.deepEqual(marked("#/agent"), ["#/agent"]);
    assert.deepEqual(marked("#/agent/sessions/oqas-2026-11-15T14-44-06-348Z"), ["#/agent"]);
    assert.deepEqual(marked("#/tests"), ["#/tests"]);
    assert.deepEqual(marked("#/executions"), ["#/executions"]);
    assert.deepEqual(marked("#/campaigns/view?id=c1"), ["#/campaigns"]);
    assert.deepEqual(marked("#/coverage"), []);
    assert.match(shell("#/coverage"), /<a href="#\/agent"><svg /);
  });

  it("has a button that folds the menu to its icons and unfolds it, when it is given one, and none otherwise", () => {
    const toggle = (): void => undefined;
    const unfolded = shell("#/", { menu: { folded: false, toggle } });
    assert.match(
      unfolded,
      /^<div class="shell"><header class="top"><button type="button" class="menu-toggle" aria-controls="shell-sidebar" aria-expanded="true" aria-label="Replier le menu" title="Replier le menu">/,
    );
    const folded = shell("#/", { menu: { folded: true, toggle } });
    assert.match(folded, /^<div class="shell folded"><header class="top"><button [^>]*aria-expanded="false" aria-label="Déplier le menu"/);
    assert.doesNotMatch(shell("#/"), /menu-toggle/);
  });

  it("names the screen in the top bar by the entry it is under, and by the product at an address that leads nowhere", () => {
    const named = (hash: string): string => /<span class="top-screen">([^<]*)<\/span>/.exec(shell(hash))![1]!;
    assert.equal(named(""), "Agent");
    assert.equal(named("#/agent/sessions/oqas-2026-11-15T14-44-06-348Z"), "Agent");
    assert.equal(named("#/tests/view?id=t1"), "Tests");
    assert.equal(named("#/knowledge/manuals"), "Connaissances");
    assert.equal(named("#/coverage"), "Open QA Stack");
    assert.equal(named("#/nowhere"), "Open QA Stack");
  });

  it("opens the navigation in a panel over the screen from the button of the top bar, keeping where the screen is", () => {
    const closed = shell("#/agent/sessions/s1?show=talk");
    assert.match(closed, /<a class="btn top-menu" href="#\/agent\/sessions\/s1\?show=talk&amp;nav=open" aria-haspopup="dialog">Menu<\/a>/);
    assert.doesNotMatch(closed, /<dialog/);
    const open = shell("#/agent/sessions/s1?show=talk&nav=open", { project: projectWith(1) });
    const panel = /<dialog class="side-panel" aria-labelledby="shell-menu">.*<\/dialog>/.exec(open)?.[0] ?? "";
    assert.match(panel, /<h2 id="shell-menu">Menu<\/h2><a class="side-panel-close" href="#\/agent\/sessions\/s1\?show=talk" aria-label="Fermer">/);
    assert.match(
      textOf(panel),
      /^Menu LA lakeside-tests 1 application · projet Travail Agent Référentiel Découverte À relire Tests Couverture bientôt Exécution Exécutions Campagnes Anomalies Projet Applications Connaissances Configuration$/,
    );
    assert.match(panel, /<a href="#\/agent" class="on" aria-current="page">/);
    assert.match(shell("#/?nav=open"), /<a class="side-panel-close" href="#\/" aria-label="Fermer">/);
  });

  it("says the instance no longer answers only when it cannot be reached", () => {
    assert.doesNotMatch(shell("#/"), /Hors ligne|role="alert"/);
    assert.doesNotMatch(shell("#/", { unreachable: false }), /Hors ligne/);
    const html = shell("#/", { unreachable: true });
    assert.match(html, /^<div class="shell"><div class="env" role="alert">/);
    assert.match(textOf(html), /^● Hors ligne — l’instance ne répond plus ; la page reprendra seule dès son retour ✓ Open QA Stack/);
  });

  it("names the project over the navigation, once the API described it", () => {
    const html = shell("#/", { project: projectWith(2) });
    assert.match(textOf(html), /^✓ Open QA Stack Agent Menu LA lakeside-tests 2 applications · projet Travail Agent/);
    assert.match(html, /<span class="proj-avatar">LA<\/span>/);
    assert.doesNotMatch(shell("#/"), /class="proj"/);
  });

  it("does not name a project that has no name yet", () => {
    const html = shell("#/", { project: { applications: projectWith(2).applications } });
    assert.doesNotMatch(html, /class="chip mono"|class="proj"|undefined/);
    assert.match(textOf(html), /^✓ Open QA Stack Agent Menu Travail Agent /);
  });

  it("counts the applications of the project as French does, in the singular below two", () => {
    assert.match(textOf(shell("#/", { project: projectWith(0) })), /lakeside-tests 0 application · projet/);
    assert.match(textOf(shell("#/", { project: projectWith(2) })), /lakeside-tests 2 applications · projet/);
  });

  it("is written in English when the console speaks it", async () => {
    await inEnglish();
    const text = textOf(shell("#/", { project: projectWith(1), unreachable: true }));
    assert.match(text, /● Offline — the instance no longer answers; the page picks up by itself once it is back ✓ Open QA Stack Agent Menu/);
    assert.match(text, /lakeside-tests 1 application · project Work Agent Repository Discovery To review Tests Coverage soon/);
  });
});
