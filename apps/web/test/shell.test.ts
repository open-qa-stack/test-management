import assert from "node:assert/strict";
import { createElement } from "react";
import type { Project } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { NAVIGATION } from "../src/shell/navigation.ts";
import { Shell } from "../src/shell/shell.tsx";
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
function shell(hash: string, props: { readonly project?: Project; readonly unreachable?: boolean } = {}): string {
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
    assert.match(textOf(html), /^✓ Open QA Stack Travail Agent /);
    assert.match(
      html,
      /<aside class="shell-sidebar"><nav class="nav" aria-label="Navigation principale">.*<\/aside><main class="shell-page"><p>page<\/p><\/main><\/div>$/,
    );
    assert.match(html, /<a class="brand" href="#\/agent">/);
  });

  it("lists the agent and the configuration as links, and what is coming as a name without one", () => {
    const html = shell("#/");
    assert.match(
      textOf(html),
      /Travail Agent Référentiel Découverte bientôt À relire bientôt Tests bientôt Couverture bientôt Exécution Campagnes bientôt Anomalies bientôt Projet Configuration page$/,
    );
    assert.deepEqual(linksOf(html), ["#/agent", "#/agent", "#/configuration"]);
    const coming = NAVIGATION.flatMap((group) => group.entries).filter((entry) => entry.path === undefined);
    assert.equal((html.match(/<span class="nav-soon">/g) ?? []).length, coming.length);
    assert.equal(coming.length, 6);
  });

  it("marks the agent at the home, at its entry and under it, the configuration at its own, and nowhere else", () => {
    assert.deepEqual(marked("#/"), ["#/agent"]);
    assert.deepEqual(marked("#/configuration"), ["#/configuration"]);
    assert.deepEqual(marked("#/agent"), ["#/agent"]);
    assert.deepEqual(marked("#/agent/sessions/oqas-2026-11-15T14-44-06-348Z"), ["#/agent"]);
    assert.deepEqual(marked("#/tests"), []);
    assert.match(shell("#/tests"), /<a href="#\/agent"><svg /);
  });

  it("says the instance no longer answers only when it cannot be reached", () => {
    assert.doesNotMatch(shell("#/"), /Hors ligne|role="alert"/);
    assert.doesNotMatch(shell("#/", { unreachable: false }), /Hors ligne/);
    const html = shell("#/", { unreachable: true });
    assert.match(html, /^<div class="shell"><div class="env" role="alert">/);
    assert.match(textOf(html), /^● Hors ligne — l’instance ne répond plus ; la page reprendra seule dès son retour ✓ Open QA Stack/);
  });

  it("names the project in the top bar and over the navigation, once the API described it", () => {
    const html = shell("#/", { project: projectWith(2) });
    assert.match(textOf(html), /^✓ Open QA Stack lakeside-tests LA lakeside-tests 2 applications · projet Travail Agent/);
    assert.match(html, /<span class="proj-avatar">LA<\/span>/);
    assert.doesNotMatch(shell("#/"), /class="chip mono"|class="proj"/);
  });

  it("does not name a project that has no name yet", () => {
    const html = shell("#/", { project: { applications: projectWith(2).applications } });
    assert.doesNotMatch(html, /class="chip mono"|class="proj"|undefined/);
    assert.match(textOf(html), /^✓ Open QA Stack Travail Agent /);
  });

  it("counts the applications of the project as French does, in the singular below two", () => {
    assert.match(textOf(shell("#/", { project: projectWith(0) })), /lakeside-tests 0 application · projet/);
    assert.match(textOf(shell("#/", { project: projectWith(2) })), /lakeside-tests 2 applications · projet/);
  });

  it("is written in English when the console speaks it", async () => {
    await inEnglish();
    const text = textOf(shell("#/", { project: projectWith(1), unreachable: true }));
    assert.match(text, /● Offline — the instance no longer answers; the page picks up by itself once it is back/);
    assert.match(text, /lakeside-tests 1 application · project Work Agent Repository Discovery soon To review soon Tests soon Coverage soon/);
  });
});
