import type { ReactNode } from "react";
import { AGENT_KEYS, MAX_TEAM_INSTRUCTIONS, type AgentKey, type OqasConfig } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { withPanel, type Route } from "../routing/route.ts";
import { Card } from "../ui/card.tsx";
import { SidePanel } from "../ui/side-panel.tsx";
import { TextField } from "./configuration-fields.tsx";
import { PartRow } from "./part-row.tsx";

/** What the card of the agents is drawn from. */
export interface AgentsCardProps {
  /** What the draft says of the agents. */
  readonly agents: OqasConfig["agents"];
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

/**
 * What the team asks of each agent: the agents, with whether the team asks something of each, and the panel of the one
 * the route opens, where its instructions are written.
 *
 * @param props - The agents of the draft, the route, the errors and the foot of the panel.
 * @returns The card.
 */
export function AgentsCard({ agents, route, wrong, footer }: AgentsCardProps): ReactNode {
  const opened = openedOn(route);
  return (
    <Card title={t("configuration.agents.title")} hint={t("configuration.agents.hint")}>
      {AGENT_KEYS.map((agent) => (
        <PartRow
          key={agent}
          name={t(`configuration.agents.names.${agent}`)}
          facts={t((agents?.[agent]?.instructions ?? "").trim() === "" ? "configuration.agents.none" : "configuration.agents.some")}
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
        </SidePanel>
      )}
    </Card>
  );
}
