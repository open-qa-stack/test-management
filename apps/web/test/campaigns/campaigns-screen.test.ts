import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { CampaignList } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../../src/api/polled-state.ts";
import { campaignHref, declaredEnvironments, typedTags } from "../../src/campaigns/campaigns-paths.ts";
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
  it("lists the campaigns, the latest planned first, each with its environment, its tags, its state, and a link to it", () => {
    const html = screen({ value: { items: OVERVIEWS } });
    assert.match(textOf(html), /^lakeside-tests \/ Campagnes Campagnes Une campagne prend les tests/);
    assert.match(
      textOf(html),
      /Tout le dépôt local · tous les tests 3 tests pris planifiée .* Recette 4\.2 local · @p0 @domain-policies 1 \/ 2 joués · 1 échoué en cours/,
    );
    assert.deepEqual(linksOf(html), [campaignHref("c2"), campaignHref("c1")]);
    assert.equal(campaignHref("c1"), "#/campaigns/view?id=c1");
  });

  it("plans a campaign from a name, an environment the configuration declares, and tags", () => {
    const html = screen({ value: { items: [] } });
    assert.match(
      textOf(html),
      /Planifier une campagne Nom Environnement local staging Tags des tests Séparés par des espaces.* Planifier Aucune campagne Planifiez-en une/,
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

describe("the tags a person types", () => {
  it("are separated by spaces or commas, each once, with its @", () => {
    assert.deepEqual(typedTags(" @p0, p1  @p0 "), ["@p0", "@p1"]);
    assert.deepEqual(typedTags("   "), []);
  });
});
