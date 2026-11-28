import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { CampaignDetails, CampaignList } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../../src/api/polled-state.ts";
import { campaignHref, declaredEnvironments } from "../../src/campaigns/campaigns-paths.ts";
import { CampaignsScreen, type PlanningState } from "../../src/campaigns/campaigns-screen.tsx";
import { linksOf, render, textOf } from "../render.ts";
import { OVERVIEWS } from "./campaigns-fixture.ts";

/** The screen of the campaigns, in the state given, as HTML. */
const screen = (
  state: PolledState<CampaignList>,
  environments: readonly string[] = ["local", "staging"],
  planning: PlanningState = { pending: false },
): string => render(createElement(CampaignsScreen, { project: "lakeside-tests", state, environments, planning, onPlan: () => undefined }));

describe("the screen of the campaigns", () => {
  it("lists the campaigns, the latest planned first, each with its environment, how far it went, its state, and a link to it", () => {
    const html = screen({ value: { items: OVERVIEWS } });
    assert.match(textOf(html), /^Campagnes Une campagne est faite des tests que vous choisissez/);
    assert.match(textOf(html), /Tout le dépôt local 3 tests choisis Planifiée .* Recette 4\.2 local 1 \/ 2 joués · 1 échoué En cours/);
    assert.deepEqual(linksOf(html), [campaignHref("c2"), campaignHref("c1")]);
    assert.match(textOf(html), /Planifiée \d+ nov\. .* En cours Échoué/);
    assert.equal(campaignHref("c1"), "#/campaigns/view?id=c1");
  });

  it("says the version, the days and who is in charge of a campaign when they were said", () => {
    const told = (details: CampaignDetails) => textOf(screen({ value: { items: [{ ...OVERVIEWS[1]!, ...details }] } }));
    assert.match(
      told({ targetVersion: "4.2", startsOn: "2026-12-01", endsOn: "2026-12-05", owner: "QA" }),
      / local · 4\.2 · du 1 déc\. 2026 au 5 déc\. 2026 · QA 1 \/ 2/,
    );
    assert.match(told({ startsOn: "2026-12-01" }), / local · à partir du 1 déc\. 2026 1 \/ 2/);
    assert.match(told({ endsOn: "2026-12-05" }), / local · jusqu’au 5 déc\. 2026 1 \/ 2/);
  });

  it("plans a campaign from a name and an environment the configuration declares, its tests chosen next", () => {
    const html = screen({ value: { items: [] } });
    assert.match(
      textOf(html),
      /Planifier une campagne Nom Environnement local staging En dire plus \(facultatif\) Objectif Version visée Premier jour Dernier jour Responsable Planifier Aucune campagne Planifiez-en une : un nom et un environnement, puis choisissez ses tests\./,
    );
    assert.ok(html.includes('<select name="environment">'));
    assert.match(screen({ value: { items: [] } }, []), /<input required="" name="environment"\/>/);
  });

  it("says the planning goes on, and why the instance refused it", () => {
    assert.match(textOf(screen({ value: { items: [] } }, ["local"], { pending: true })), /Planification…/);
    assert.match(textOf(screen({ value: { items: [] } }, ["local"], { pending: false, refusal: "Refusé." })), /Refusé\. Planifier/);
  });

  it("says it reads the campaigns until the instance answered, and why it could not", () => {
    assert.match(textOf(screen({})), /Lecture des campagnes Elles apparaissent dès que l’instance a répondu\.$/);
    assert.match(textOf(screen({ unread: "Down." })), /Lecture des campagnes Down\.$/);
  });
});

describe("the environments a campaign may run against", () => {
  it("are those the revision in force declares, each once, and none without a revision", () => {
    const application = (names: string[]) => ({ environments: names.map((name) => ({ name })) });
    const revision = { document: { applications: [application(["local", "staging"]), application(["local"])] } };
    assert.deepEqual(declaredEnvironments({ revision } as never), ["local", "staging"]);
    assert.deepEqual(declaredEnvironments({}), []);
  });
});
