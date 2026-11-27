import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { DefectList } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../../src/api/polled-state.ts";
import { defectsHref, defectViewOf } from "../../src/defects/defects-paths.ts";
import { DefectsScreen, type DefectsControls } from "../../src/defects/defects-screen.tsx";
import { parseRoute } from "../../src/routing/route.ts";
import { elementsOf, linksOf, render, textOf } from "../render.ts";
import { DEFECTS } from "./defects-fixture.ts";

/** The screen of an address, with what the instance told, as HTML. */
const screen = (hash: string, defects: PolledState<DefectList> = { value: DEFECTS }, controls?: DefectsControls): string =>
  render(
    createElement(DefectsScreen, { project: "lakeside-tests", view: defectViewOf(parseRoute(hash)), defects, ...(controls === undefined ? {} : { controls }) }),
  );

/** What the person does on the screen, which a static rendering never calls. */
const CONTROLS: DefectsControls = { change: () => assert.fail("nothing is moved") };

describe("the views of the defects in the address", () => {
  it("are those to deal with by default, and are written back the same", () => {
    assert.deepEqual(
      ["#/defects", "#/defects?view=to_replay", "#/defects?view=closed", "#/defects?view=other"].map((hash) => defectViewOf(parseRoute(hash))),
      ["open", "to_replay", "closed", "open"],
    );
    assert.deepEqual([defectsHref(), defectsHref("to_replay"), defectsHref("closed")], ["#/defects", "#/defects?view=to_replay", "#/defects?view=closed"]);
  });
});

describe("the defects reported from tests that failed", () => {
  it("say they are read until the instance told them, and why it could not", () => {
    assert.equal(
      textOf(screen("#/defects", {})),
      "lakeside-tests / Anomalies Anomalies Lecture des anomalies Elles apparaissent dès que l’instance a répondu.",
    );
    assert.match(textOf(screen("#/defects", { unread: "L’instance ne répond pas." })), /Lecture des anomalies L’instance ne répond pas\.$/);
    assert.match(
      textOf(screen("#/defects", { value: DEFECTS, unread: "L’instance ne répond pas." })),
      /ce qu’il faut rejouer\. L’instance ne répond pas\. Ouvertes 1/,
    );
  });

  it("list each view with how many it holds, each defect with its severity, where it stands, its test and what can be done of it", () => {
    const html = screen("#/defects", { value: DEFECTS }, CONTROLS);
    assert.match(
      textOf(html),
      /Ouvertes 1 À rejouer 1 Fermées 2 Réf\. Titre Sévérité État Test lié Signalée le Gestes D-3 The premium shows 0 S1 · bloquante à traiter Display the detail of a policy 26 nov\. 2026, 10:00 Marquer corrigée Fermer$/,
    );
    assert.ok(linksOf(html).includes("#/tests/view?path=apps%2Fpolicy-management%2Ftests%2Fpolicies%2Fpolicy-detail%2Fpolicy-detail.spec.ts"));
    assert.match(
      textOf(screen("#/defects?view=to_replay", { value: DEFECTS }, CONTROLS)),
      /D-2 The dates are swapped S3 · mineure corrigée · à rejouer .* Fermer Rouvrir$/,
    );
    assert.match(
      textOf(screen("#/defects?view=closed", { value: DEFECTS }, CONTROLS)),
      /D-1 The name is cut S4 · cosmétique corrigée · rejouée au vert .* Fermer Rouvrir D-0 A typo S2 · majeure fermée .* Rouvrir$/,
    );
    // Without what makes them, or while one is under way, the gestures wait; a refusal says why.
    assert.match(screen("#/defects"), /<button type="button" class="btn sm" disabled="">Marquer corrigée<\/button>/);
    assert.match(screen("#/defects", { value: DEFECTS }, { ...CONTROLS, pending: "D-3" }), /<button type="button" class="btn sm" disabled="">Fermer<\/button>/);
    assert.match(
      textOf(screen("#/defects", { value: DEFECTS }, { ...CONTROLS, refusal: "L’instance ne garde plus cette anomalie." })),
      /rejouer\. L’instance ne garde plus cette anomalie\. Ouvertes/,
    );
  });

  it("say when a view holds none", () => {
    const none = { items: [], counts: { open: 0, toReplay: 0, closed: 0 } };
    assert.match(textOf(screen("#/defects", { value: none })), /Aucune anomalie ouverte Une anomalie se signale depuis la fiche d’un test en échec\.$/);
    assert.match(textOf(screen("#/defects?view=to_replay", { value: none })), /Rien à rejouer /);
    assert.match(textOf(screen("#/defects?view=closed", { value: none })), /Aucune anomalie fermée /);
  });

  it("moves the defect a gesture is of, to where the gesture says", () => {
    const moved: [string, string][] = [];
    const node = createElement(DefectsScreen, {
      project: "lakeside-tests",
      view: "open",
      defects: { value: DEFECTS },
      controls: { change: (id, status) => moved.push([id, status]) },
    });
    for (const button of elementsOf(node, "button")) (button["onClick"] as () => void)();
    assert.deepEqual(moved, [
      ["D-3", "fixed"],
      ["D-3", "closed"],
    ]);
  });
});
