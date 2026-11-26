import assert from "node:assert/strict";
import { createElement } from "react";
import { AGENT_KEYS, type AgentPrompt, type OqasConfig } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import type { ReadPrompts } from "../../src/configuration/agent-prompt-fields.tsx";
import { AgentsCard } from "../../src/configuration/agents-card.tsx";
import { at, linksOf, render, textOf } from "../render.ts";

/** The prompt of the writer, as the instance gives it. */
const WRITER: AgentPrompt = {
  agent: "writer",
  template: "Write with {{run_tool}}, then {{propose_tool}}.",
  variables: ["run_tool", "propose_tool"],
  digest: "b".repeat(64),
};

/** What the draft says of the agents, unless a test says otherwise. */
const AGENTS: OqasConfig["agents"] = { writer: { instructions: "Say policy, never contract." }, planner: { instructions: " " } };

/** The card, with a panel open or none, as HTML: the instance gave the prompts unless a test says otherwise. */
const card = (hash = "#/configuration", agents = AGENTS, ...given: [ReadPrompts?]): string => {
  const prompts = given.length === 0 ? [WRITER] : given[0];
  return render(createElement(AgentsCard, { agents, prompts, route: at(hash), wrong: (pointer) => pointer === "/agents/writer", footer: "Saved." }));
};

/** The panel of the writer, as HTML. */
const writer = (agents = AGENTS, ...given: [ReadPrompts?]): string => card("#/configuration?panel=agent%3Awriter", agents, ...given);

describe("what the team asks of the agents", () => {
  it("lists each agent, what the team asks of it, and whether it is wrong, each leading to its panel", () => {
    const html = card();
    assert.match(textOf(html), /Consignes des agents · ce que l’équipe demande à chacun Lecteur d’une source Son prompt seul Modifier/);
    assert.match(textOf(html), /Planificateur des tests Son prompt seul Modifier/);
    assert.match(textOf(html), /Rédacteur d’un test Suit des consignes de l’équipe À corriger Modifier/);
    assert.deepEqual(
      linksOf(html),
      AGENT_KEYS.map((agent) => `#/configuration?panel=${encodeURIComponent(`agent:${agent}`)}`),
    );
    const replaced = (basedOn: string) => textOf(card("#/configuration", { writer: { prompt: { text: "Write.", basedOn }, instructions: "Say policy." } }));
    assert.match(replaced(WRITER.digest), /Rédacteur d’un test Suit un prompt de l’équipe · Suit des consignes de l’équipe/);
    assert.match(replaced("c".repeat(64)), /Rédacteur d’un test Suit un prompt de l’équipe écrit sur un ancien prompt · /);
  });

  it("opens the panel of an agent on its instructions, empty for one the team asks nothing of, and none for an agent there is not", () => {
    assert.match(
      writer(),
      /<textarea id="config-agents-writer-instructions" name="\/agents\/writer\/instructions"[^>]*maxLength="4000"[^>]*>Say policy, never contract\.<\/textarea>/i,
    );
    assert.match(textOf(writer()), /Elles s’ajoutent à la fin du prompt de l’agent\..*Saved\./);
    assert.match(card("#/configuration?panel=agent%3Acode-reviewer"), /<textarea [^>]*><\/textarea>/);
    assert.doesNotMatch(card("#/configuration?panel=agent%3Arobot"), /<textarea/);
  });

  it("offers to replace the whole prompt with a copy of its own, once the instance gave it", () => {
    const html = writer();
    assert.match(textOf(html), /Prompt de l’agent L’agent suit son propre prompt, écrit dans le code\. Remplacer tout le prompt/);
    const copy = JSON.stringify({ text: WRITER.template, basedOn: WRITER.digest }).replaceAll('"', "&quot;");
    assert.ok(html.includes(`data-set="/agents/writer/prompt" data-value="${copy}"`), html);
    assert.match(textOf(writer(AGENTS, undefined)), /Lecture du prompt de l’agent…/);
    assert.match(textOf(writer(AGENTS, "failed")), /n’a pas pu être lu : rechargez la page/);
    assert.match(textOf(writer(AGENTS, [])), /n’a pas pu être lu/);
  });

  it("shows a prompt of the team with what it may break, the variables it leaves out, its own beside it, and a way back", () => {
    const html = writer({ writer: { prompt: { text: "Write with {{run_tool}}.", basedOn: WRITER.digest } } });
    assert.match(
      textOf(html),
      /Ce prompt remplace celui de l’agent\. Il ne profite plus des améliorations du prompt par défaut, et il peut casser ce que le harnais attend/,
    );
    assert.match(
      html,
      /<textarea id="config-agents-writer-prompt-text" name="\/agents\/writer\/prompt\/text"[^>]*maxLength="40000"[^>]*>Write with \{\{run_tool\}\}\.<\/textarea>/i,
    );
    assert.match(textOf(html), /chaque variable par sa valeur dans la session : \{\{run_tool\}\}, \{\{propose_tool\}\}\./);
    assert.match(textOf(html), /Il manque \{\{propose_tool\}\} : le harnais y écrit ce dont la session a besoin\. Vous pouvez enregistrer quand même\./);
    assert.match(
      html,
      /<details class="config-json"><summary>Prompt par défaut<\/summary><pre class="mono">Write with \{\{run_tool\}\}, then \{\{propose_tool\}\}\.<\/pre><\/details>/,
    );
    assert.match(html, /data-remove="\/agents\/writer\/prompt"[^>]*>Revenir au prompt par défaut</);
    assert.doesNotMatch(textOf(html), /a changé/);
    const whole = writer({ writer: { prompt: { text: WRITER.template, basedOn: WRITER.digest } } });
    assert.doesNotMatch(textOf(whole), /Il manque/);
  });

  it("tells a prompt of the team written on a former prompt of the agent, its current one open beside it, until the person took it in", () => {
    const html = writer({ writer: { prompt: { text: WRITER.template, basedOn: "c".repeat(64) } } });
    assert.match(
      textOf(html),
      /Le prompt par défaut a changé depuis que celui-ci a été écrit\. Comparez-le au prompt par défaut actuel, plus bas\. J’ai repris les changements/,
    );
    assert.ok(html.includes(`data-set="/agents/writer/prompt/basedOn" data-value="&quot;${WRITER.digest}&quot;"`));
    assert.match(html, /<details class="config-json" open=""><summary>Prompt par défaut actuel, qui a changé<\/summary>/);
  });
});
