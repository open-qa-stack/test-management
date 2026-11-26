import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ExitCode,
  MAX_REPLACED_PROMPT,
  missingVariables,
  replacedPrompt,
  teamInstructions,
  type AgentKey,
  type AgentPrompt,
  type AgentSettings,
  type ExitCodeValue,
  type OqasConfig,
} from "@open-qa-stack/domain";
import { AgentPrompts, type Configuration } from "@open-qa-stack/engine";
import type { Command } from "../arguments/command.ts";
import { UsageError } from "../errors/usage-error.ts";
import type { Asked } from "./asked.ts";
import { print } from "./print.ts";

/** What `oqas agents` is given. */
type AgentsAsked = Omit<Asked<"agents">, "sessions" | "command"> & { configuration: Configuration; command: Extract<Command, { name: "agents" }> };

/** The configuration with one part of what the team asks of an agent set; without it when it is `undefined`. */
function settled<Part extends keyof AgentSettings>(document: OqasConfig, agent: AgentKey, part: Part, value: AgentSettings[Part]): OqasConfig {
  const { [agent]: own = {}, ...others } = document.agents ?? {};
  const { [part]: _, ...kept } = own;
  const settings = value === undefined ? kept : { ...kept, [part]: value };
  return { ...document, agents: Object.keys(settings).length === 0 ? others : { ...others, [agent]: settings } };
}

/** The text of the file a prompt is replaced with. */
async function promptFile(cwd: string, file: string): Promise<string> {
  const text = await readFile(resolve(cwd, file), "utf8").catch(() => {
    throw new UsageError(`${file} cannot be read.`);
  });
  if (text.trim() === "" || text.length > MAX_REPLACED_PROMPT)
    throw new UsageError(`The prompt of an agent is a text of 1 to ${MAX_REPLACED_PROMPT} characters.`);
  return text;
}

/** What is told of a prompt of the team: what it may break, the variables it leaves out, a prompt of the agent changed since. */
function warnings(prompt: AgentPrompt, text: string, basedOn: string): string[] {
  const { agent } = prompt;
  const missing = missingVariables(text, prompt.variables);
  return [
    `The prompt of the ${agent} is that of the team: it no longer follows the changes of its own, and may break what the harness expects of it. oqas agents reset ${agent} gives it its own back.`,
    ...(missing.length === 0
      ? []
      : [`It leaves out ${missing.map((name) => `{{${name}}}`).join(", ")}, which the harness fills in with what the session needs.`]),
    ...(basedOn === prompt.digest
      ? []
      : [`The prompt of the ${agent} changed since this one was written on it: oqas agents default ${agent} prints it as it is now.`]),
  ];
}

/** How each prompt in force is told in the list: an agent with its own says nothing of it. */
const PROMPT_STATES = {
  own: undefined,
  team: "a prompt of the team",
  "team-on-former": "a prompt of the team, written on a former prompt of its own",
} as const;

/** Writes what is told of the prompt of the team an agent follows, if it follows one, to the standard error; and gives it. */
function warned({ io }: Pick<AgentsAsked, "io">, prompt: AgentPrompt, agents: OqasConfig["agents"]): string[] {
  const replaced = replacedPrompt(agents, prompt.agent);
  const told = replaced === undefined ? [] : warnings(prompt, replaced.text, replaced.basedOn);
  for (const line of told) io.stderr.write(`${line}\n`);
  return told;
}

/**
 * `oqas agents`: lists what the team asks of each agent; with `instruct` or `clear`, `replace` or `reset`, records it as
 * a revision of origin `command` first; with `prompt` or `default`, prints the prompt of one agent, in force or as the
 * code writes it.
 */
export async function instructed({ configuration, command, options, io }: AgentsAsked): Promise<ExitCodeValue> {
  const prompts = new AgentPrompts().list();
  const own = (agent: AgentKey) => prompts.find((prompt) => prompt.agent === agent)!;
  if (command.action === "default") {
    print({ options, io }, own(command.agent).template, own(command.agent));
    return ExitCode.passed;
  }
  if (command.action === "prompt") {
    const { agents } = (await configuration.current()).document;
    const replaced = replacedPrompt(agents, command.agent);
    const text = replaced?.text ?? own(command.agent).template;
    const told = warned({ io }, own(command.agent), agents);
    print({ options, io }, text, { agent: command.agent, text, replaced: replaced !== undefined, warnings: told });
    return ExitCode.passed;
  }
  if (command.action === "instruct" || command.action === "replace") {
    const inForce = await configuration.current();
    const { agent } = command;
    const changed =
      command.action === "instruct"
        ? settled(inForce.document, agent, "instructions", command.instructions)
        : settled(
            inForce.document,
            agent,
            "prompt",
            command.file === undefined ? undefined : { text: await promptFile(io.cwd, command.file), basedOn: own(agent).digest },
          );
    await configuration.save(changed, inForce.number, "command");
    if (command.action === "replace") warned({ io }, own(agent), changed.agents);
  }
  const { agents } = (await configuration.current()).document;
  const items = prompts.map(({ agent, digest }) => {
    const replaced = replacedPrompt(agents, agent);
    const prompt: keyof typeof PROMPT_STATES = replaced === undefined ? "own" : replaced.basedOn === digest ? "team" : "team-on-former";
    return { agent, prompt, instructions: teamInstructions(agents, agent) };
  });
  const lines = items.map(({ agent, prompt, instructions }) => {
    const said = [PROMPT_STATES[prompt], instructions].filter((part) => part !== undefined);
    return `${agent}: ${said.length === 0 ? "its own prompt alone" : said.join(", then: ")}`;
  });
  print({ options, io }, lines.join("\n"), { items });
  return ExitCode.passed;
}
