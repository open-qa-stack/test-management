import assert from "node:assert/strict";
import { createElement } from "react";
import { AGENT_KEYS } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { AgentsCard } from "../../src/configuration/agents-card.tsx";
import { at, linksOf, render, textOf } from "../render.ts";

/** The card, with a panel open or none, as HTML. */
const card = (hash = "#/configuration"): string =>
  render(
    createElement(AgentsCard, {
      agents: { writer: { instructions: "Say policy, never contract." }, planner: { instructions: " " } },
      route: at(hash),
      wrong: (pointer) => pointer === "/agents/writer",
      footer: "Saved.",
    }),
  );

describe("what the team asks of the agents", () => {
  it("lists each agent, whether the team asks something of it, and whether it is wrong, each leading to its panel", () => {
    const html = card();
    assert.match(textOf(html), /Consignes des agents · ce que l’équipe demande à chacun Lecteur d’une source Son prompt seul Modifier/);
    assert.match(textOf(html), /Planificateur des tests Son prompt seul Modifier/);
    assert.match(textOf(html), /Rédacteur d’un test Suit des consignes de l’équipe À corriger Modifier/);
    assert.deepEqual(
      linksOf(html),
      AGENT_KEYS.map((agent) => `#/configuration?panel=${encodeURIComponent(`agent:${agent}`)}`),
    );
  });

  it("opens the panel of an agent on its instructions, empty for one the team asks nothing of, and none for an agent there is not", () => {
    const writer = card("#/configuration?panel=agent%3Awriter");
    assert.match(
      writer,
      /<textarea id="config-agents-writer-instructions" name="\/agents\/writer\/instructions"[^>]*maxLength="4000"[^>]*>Say policy, never contract\.<\/textarea>/i,
    );
    assert.match(textOf(writer), /Elles s’ajoutent à la fin du prompt de l’agent.*Saved\./);
    assert.match(card("#/configuration?panel=agent%3Acode-reviewer"), /<textarea [^>]*><\/textarea>/);
    assert.doesNotMatch(card("#/configuration?panel=agent%3Arobot"), /<textarea/);
  });
});
