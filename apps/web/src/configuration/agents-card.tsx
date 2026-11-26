import type { ReactNode } from "react";
import { AGENT_KEYS, MAX_TEAM_INSTRUCTIONS, type AgentKey, type OqasConfig } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { withPanel, type Route } from "../routing/route.ts";
import { Card } from "../ui/card.tsx";
import { SidePanel } from "../ui/side-panel.tsx";
import { AgentPromptFields, type ReadPrompts } from "./agent-prompt-fields.tsx";
import { TextField } from "./configuration-fields.tsx";
import { PartRow } from "./part-row.tsx";

/** What the card of the agents is drawn from. */
export interface AgentsCardProps {
  /** What the draft says of the agents. */
  readonly agents: OqasConfig["agents"];
  /** The prompts of the agents as the code writes them, as the instance gave them. */
  readonly prompts: ReadPrompts;
  /** Where the console is, which tells the agent whose panel is open. */
  readonly route: Route;
  /** Whether a place of the draft, or a place in it, holds an error. */
  readonly wrong: (pointer: string) => boolean;
  /** What saves, or drops, what the person did in the panel. */
  readonly footer: ReactNode;
}

/** The agent whose panel a route opens, if any. */
function openedOn(route: Route): AgentKey | undefined {
  return AGENT_KEYS.find((agent) => route.query["panel"] === `agent:${agent}`);
}

/** What the row of an agent says the team asks of it: a prompt in place of its own, instructions, both, or nothing. */
function askedOf(agent: AgentKey, agents: OqasConfig["agents"], prompts: ReadPrompts): string {
  const replaced = agents?.[agent]?.prompt;
  const own = Array.isArray(prompts) ? prompts.find((prompt) => prompt.agent === agent) : undefined;
  const parts = [
    ...(replaced === undefined
      ? []
      : [t(own !== undefined && own.digest !== replaced.basedOn ? "configuration.agents.former" : "configuration.agents.replaced")]),
    ...((agents?.[agent]?.instructions ?? "").trim() === "" ? [] : [t("configuration.agents.some")]),
  ];
  return parts.length === 0 ? t("configuration.agents.none") : parts.join(" · ");
}

/**
 * What the team asks of each agent: the agents, with what the team asks of each, and the panel of the one the route
 * opens, where its instructions are written and its prompt may be replaced.
 *
 * @param props - The agents of the draft, their prompts, the route, the errors and the foot of the panel.
 * @returns The card.
 */
export function AgentsCard({ agents, prompts, route, wrong, footer }: AgentsCardProps): ReactNode {
  const opened = openedOn(route);
  return (
    <Card title={t("configuration.agents.title")} hint={t("configuration.agents.hint")}>
      {AGENT_KEYS.map((agent) => (
        <PartRow
          key={agent}
          name={t(`configuration.agents.names.${agent}`)}
          facts={askedOf(agent, agents, prompts)}
          wrong={wrong(`/agents/${agent}`)}
          href={withPanel(route, `agent:${agent}`)}
        />
      ))}
      {opened !== undefined && (
        <SidePanel key={opened} id="agent-panel-title" title={t(`configuration.agents.names.${opened}`)} close={withPanel(route)} footer={footer}>
          <p className="field-hint">{t("configuration.agents.note")}</p>
          <TextField
            pointer={`/agents/${opened}/instructions`}
            label={t("configuration.agents.instructions")}
            hint={t("configuration.agents.example")}
            value={agents?.[opened]?.instructions}
            max={MAX_TEAM_INSTRUCTIONS}
          />
          <h3 className="agent-prompt-title">{t("configuration.agents.prompt.title")}</h3>
          <AgentPromptFields
            agent={opened}
            prompt={Array.isArray(prompts) ? (prompts.find(({ agent }) => agent === opened) ?? "failed") : prompts}
            agents={agents}
          />
        </SidePanel>
      )}
    </Card>
  );
}
