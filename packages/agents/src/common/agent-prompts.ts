import type { AgentKey } from "@open-qa-stack/domain";
import { APPLICATION_EXPLORER_PROMPT } from "../application-explorer/application-explorer-prompt.ts";
import { CARTOGRAPHER_PROMPT } from "../cartographer/cartographer-prompt.ts";
import { CODE_REVIEWER_PROMPT } from "../code-reviewer/code-reviewer-prompt.ts";
import { COHERENCE_REVIEWER_PROMPT } from "../coherence-reviewer/coherence-reviewer-prompt.ts";
import { PLANNER_PROMPT } from "../designer/planner-prompt.ts";
import { WRITER_PROMPT } from "../designer/writer-prompt.ts";
import { DOCUMENT_CARTOGRAPHER_PROMPT } from "../document-cartographer/document-cartographer-prompt.ts";
import { PLAN_REVIEWER_PROMPT } from "../plan-reviewer/plan-reviewer-prompt.ts";
import { SOURCE_CARTOGRAPHER_PROMPT } from "../source-cartographer/source-cartographer-prompt.ts";
import { GROUPING_PROMPT } from "../source-workflow/grouping-prompt.ts";
import { WRITING_PROMPT } from "../source-workflow/writing-prompt.ts";
import type { PromptTemplate } from "./prompt-template.ts";

/** The prompt of each agent, as it is when nothing changes it: what a session of the agent is given, before what the harness adds to it. */
export const AGENT_PROMPTS: Readonly<Record<AgentKey, PromptTemplate>> = {
  "source-cartographer": SOURCE_CARTOGRAPHER_PROMPT,
  "source-grouping": GROUPING_PROMPT,
  "domain-writer": WRITING_PROMPT,
  "document-cartographer": DOCUMENT_CARTOGRAPHER_PROMPT,
  "application-explorer": APPLICATION_EXPLORER_PROMPT,
  "cartography-orchestrator": CARTOGRAPHER_PROMPT,
  planner: PLANNER_PROMPT,
  "plan-reviewer": PLAN_REVIEWER_PROMPT,
  writer: WRITER_PROMPT,
  "coherence-reviewer": COHERENCE_REVIEWER_PROMPT,
  "code-reviewer": CODE_REVIEWER_PROMPT,
};
