import { AGENT_KEYS, ExitCode, teamInstructions, type AgentKey, type ExitCodeValue, type OqasConfig } from "@open-qa-stack/domain";
import type { Configuration } from "@open-qa-stack/engine";
import type { Command } from "../arguments/command.ts";
import type { Asked } from "./asked.ts";
import { print } from "./print.ts";

/** The configuration with what the team asks of an agent; without it when it asks nothing. */
function asking(document: OqasConfig, agent: AgentKey, instructions: string | undefined): OqasConfig {
  const { [agent]: _, ...others } = document.agents ?? {};
  return { ...document, agents: instructions === undefined ? others : { ...others, [agent]: { instructions } } };
}

/**
 * `oqas agents`: lists what the team asks of each agent; with `instruct` or `clear`, records it as a revision of origin
 * `command` first.
 */
export async function instructed({
  configuration,
  command,
  options,
  io,
}: Omit<Asked<"agents">, "sessions" | "command"> & { configuration: Configuration; command: Extract<Command, { name: "agents" }> }): Promise<ExitCodeValue> {
  if (command.action === "instruct") {
    const inForce = await configuration.current();
    await configuration.save(asking(inForce.document, command.agent, command.instructions), inForce.number, "command");
  }
  const { agents } = (await configuration.current()).document;
  const items = AGENT_KEYS.map((agent) => ({ agent, instructions: teamInstructions(agents, agent) }));
  const lines = items.map(({ agent, instructions }) => `${agent}: ${instructions ?? "its own prompt alone"}`);
  print({ options, io }, lines.join("\n"), { items });
  return ExitCode.passed;
}
