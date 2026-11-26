import { Controller, Get, Header } from "@nestjs/common";
import { AgentPrompts } from "@open-qa-stack/engine";
import type { AgentPromptList } from "@open-qa-stack/domain/sessions";

/** `GET /configuration/agents`: the prompts of the agents as the code writes them, which the team may replace. */
@Controller("configuration/agents")
export class AgentsController {
  readonly #prompts: AgentPrompts;

  constructor(prompts: AgentPrompts) {
    this.#prompts = prompts;
  }

  /** @returns The prompt of each agent, with its variables and its digest, as the items of a list which no cache may keep. */
  @Get()
  @Header("Cache-Control", "no-store")
  list(): AgentPromptList {
    return { items: this.#prompts.list() };
  }
}
