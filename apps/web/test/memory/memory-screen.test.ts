import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { MemoryList } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../../src/api/polled-state.ts";
import { applicationIds, nameApplications } from "../../src/applications/application-names.ts";
import { memoryHref, memoryPlaceOf } from "../../src/memory/memory-paths.ts";
import { MemoryScreen, type MemoryControls } from "../../src/memory/memory-screen.tsx";
import { parseRoute } from "../../src/routing/route.ts";
import { linksOf, render, textOf } from "../render.ts";
import { MEMORY } from "./memory-fixture.ts";

/** The screen of an address, with what the instance told, as HTML. */
const screen = (hash: string, memory: PolledState<MemoryList> = { value: MEMORY }, controls?: MemoryControls): string =>
  render(
    createElement(MemoryScreen, { project: "lakeside-tests", place: memoryPlaceOf(parseRoute(hash)), memory, ...(controls === undefined ? {} : { controls }) }),
  );

/** What the person does on the screen, which a static rendering never calls. */
const CONTROLS: MemoryControls = { save: () => assert.fail("nothing is saved"), pending: false };

describe("the place of the memory in the address", () => {
  it("is the active lines of every type without a panel by default, and is written back the same", () => {
    assert.deepEqual(memoryPlaceOf(parseRoute("#/memory")), { view: "active" });
    assert.deepEqual(memoryPlaceOf(parseRoute("#/memory?view=other&type=other&panel=")), { view: "active" });
    const place = memoryPlaceOf(parseRoute("#/memory?view=inactive&type=correction&panel=l2"));
    assert.deepEqual(place, { view: "inactive", type: "correction", panel: "l2" });
    assert.equal(memoryHref(place), "#/memory?view=inactive&type=correction&panel=l2");
    assert.equal(memoryHref({ view: "active" }), "#/memory");
  });
});

describe("the memory of the agents", () => {
  it("says it is read until the instance told it, and why it could not", () => {
    assert.equal(textOf(screen("#/memory", {})), "Mémoire Lecture de la mémoire Elle apparaît dès que l’instance a répondu.");
    assert.match(textOf(screen("#/memory", { unread: "L’instance ne répond pas." })), /Lecture de la mémoire L’instance ne répond pas\.$/);
    assert.match(
      textOf(screen("#/memory", { value: MEMORY, unread: "L’instance ne répond pas." })),
      /^Mémoire \+ Consigne Ce que les agents relisent .* sans supprimer\. L’instance ne répond pas\. Actives 2/,
    );
  });

  it("lists the lines of a view, narrowed to a type, each with where it comes from and the link that adjusts it", () => {
    nameApplications([{ id: "policy-management", name: "Policy Management" }]);
    const active = screen("#/memory");
    assert.match(
      textOf(active),
      /Actives 2 Mises de côté 1 Tous les types Consignes Corrections Déduites Consigne Create the customers by the API, never by the screens\. Policy Management · Conception \(concepteur, relecteurs\) · .* Ajuster Déduite The quote screens bear data-testid in quote-\*\. Noté par un agent · quotes, repère d’écran · .* Ajuster$/,
    );
    assert.ok(linksOf(active).includes("#/memory?panel=l1"));
    assert.ok(linksOf(active).includes("#/memory?panel=add"));
    assert.match(textOf(screen("#/memory?view=inactive")), /Correction Use the policy of Max Mustermann as reference data\. Tout le projet · Tout · /);
    assert.doesNotMatch(textOf(screen("#/memory?type=inferred")), /Create the customers/);
    assert.match(textOf(screen("#/memory?type=correction")), /Aucune leçon active Les leçons viennent de vos consignes/);
    nameApplications([]);
  });

  it("adds an instruction and adjusts a lesson in a panel, the scope, the work and the activity with it, and only the text and the activity of what an agent noted", () => {
    nameApplications([{ id: "policy-management", name: "Policy Management" }]);
    assert.deepEqual(applicationIds(), ["policy-management"]);
    const added = screen("#/memory?panel=add", { value: MEMORY }, CONTROLS);
    assert.match(
      textOf(added),
      /Nouvelle consigne Ce que les agents doivent retenir Formulez une règle.* Portée Projet · toutes les applications Application · Policy Management S’applique à Conception \(concepteur, relecteurs\) Découverte \(cartographe\) Tout Active Mise de côté, .* Annuler Enregistrer$/,
    );
    assert.match(added, /<input type="radio" name="target" checked="" value="design"\/>/);
    assert.match(added, /name="active" checked=""/);
    const adjusted = screen("#/memory?view=inactive&panel=l2", { value: MEMORY }, { ...CONTROLS, refusal: "Non." });
    assert.match(
      textOf(adjusted),
      /Ajuster une leçon Correction Ce que les agents doivent retenir Use the policy of Max Mustermann as reference data\. .* Non\. Annuler Enregistrer$/,
    );
    assert.match(adjusted, /<input type="radio" name="target" checked="" value="all"\/>/);
    assert.doesNotMatch(adjusted, /name="active" checked/);
    assert.match(adjusted, /<a class="side-panel-close" href="#\/memory\?view=inactive"/);
    const noted = textOf(screen("#/memory?panel=m1", { value: MEMORY }, CONTROLS));
    assert.match(noted, /Ajuster une leçon Déduite Ce que les agents doivent retenir The quote screens/);
    assert.doesNotMatch(noted, /Portée|S’applique à/);
    assert.match(screen("#/memory?panel=add", { value: MEMORY }, { ...CONTROLS, pending: true }), /disabled="">Enregistrement…<\/button>/);
    assert.match(screen("#/memory?panel=add"), /<button type="submit" form="memory-panel" class="btn primary" disabled="">/);
    assert.doesNotMatch(screen("#/memory?panel=nowhere"), /<dialog/);
    nameApplications([]);
  });
});
