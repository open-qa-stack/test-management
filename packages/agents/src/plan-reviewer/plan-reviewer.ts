import type { TerminalEvent, ToolDefinition } from "@open-qa-stack/domain";
import type { AgentTask } from "../common/agent-task.ts";
import type { DuplicateJudge, JudgedDuplicate, JudgedItem } from "../designer/duplicate-judge.ts";
import { PLAN_REVIEWER_INSTRUCTIONS, REPORT_TOOL, reviewRequest } from "./plan-reviewer-prompt.ts";

/** Longest reason of a duplicate, in characters. */
export const MAX_REASON_LENGTH = 300;

/** Runs the session of one review, and gives how it ended. */
export type ReviewSession = (task: Pick<AgentTask, "instructions" | "tools" | "request" | "reminder">) => Promise<TerminalEvent>;

/**
 * The agent that reviews the scenarios of a test plan for duplicates.
 *
 * @remarks
 * It is an agent of its own: each review runs in a session of its own, with its own instructions and
 * `report_duplicates` as its only tool, which sees the scenarios as the harness describes them and nothing
 * of the session of the agent that plans. It is the second guard against duplicates, asked by the harness
 * about the scenarios its own comparison let through. It reviews no test: whether a test does what its plan
 * says is the matter of another agent.
 *
 * What it reports is taken as it is given, an entry that is not a duplicate with its two slugs and its
 * reason left out, each reason on one line: the harness checks the slugs against the plan. A review whose
 * session fails, reaches a limit or ends without a report throws.
 */
export class PlanReviewer implements DuplicateJudge {
  private readonly run: ReviewSession;

  /** @param run - Runs the session of a review, under the limits and with the trace of its caller. */
  public constructor(run: ReviewSession) {
    this.run = run;
  }

  /** {@inheritDoc DuplicateJudge.judge} */
  public async judge(kept: readonly JudgedItem[], candidates: readonly JudgedItem[]): Promise<readonly JudgedDuplicate[]> {
    let reported: JudgedDuplicate[] | undefined;
    const tool: ToolDefinition = {
      name: REPORT_TOOL,
      description: "Reports the candidates that are duplicates of a scenario before them; an empty list when there is none.",
      parameters: {
        type: "object",
        properties: {
          duplicates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "The slug of the candidate that is a duplicate." },
                of: { type: "string", description: "The slug of the scenario before it that already verifies it." },
                reason: { type: "string", description: "Why, in one sentence." },
              },
              required: ["id", "of", "reason"],
            },
          },
        },
        required: ["duplicates"],
      },
      execute: async (args) => {
        reported = duplicatesOf(args);
        return "Recorded. Answer with one word; call no more tools.";
      },
    };
    const reminder = () => (reported === undefined ? `Call ${REPORT_TOOL} now, with an empty list when no candidate is a duplicate.` : undefined);
    const last = await this.run({ instructions: PLAN_REVIEWER_INSTRUCTIONS, tools: [tool], request: reviewRequest(kept, candidates), reminder });
    if (reported !== undefined) return reported;
    if (last.type === "error") throw new Error(last.error.message);
    throw new Error(last.type === "stopped" ? `the review reached its ${last.reason.limit} limit.` : "the review ended without a report.");
  }
}

/** The duplicates a call reports: its entries that give two slugs and a reason, each reason on one line and cut to `MAX_REASON_LENGTH`. */
function duplicatesOf(args: unknown): JudgedDuplicate[] {
  const given = (args as { duplicates?: unknown } | null)?.duplicates;
  const entries = Array.isArray(given) ? (given as readonly (Partial<Record<keyof JudgedDuplicate, unknown>> | null)[]) : [];
  return entries.flatMap((entry) => {
    const { id, of, reason } = entry ?? {};
    if (typeof id !== "string" || typeof of !== "string" || typeof reason !== "string") return [];
    return [{ id, of, reason: reason.replace(/\s+/g, " ").trim().slice(0, MAX_REASON_LENGTH) }];
  });
}
