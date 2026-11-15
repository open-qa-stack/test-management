import type { PlannedScenario, TerminalEvent, ToolDefinition } from "@open-qa-stack/domain";
import type { AgentTask } from "../common/agent-task.ts";
import type { CoherenceJudge } from "../designer/coherence-judge.ts";
import type { CoherenceFinding } from "../designer/design-state.ts";
import { COHERENCE_REVIEWER_INSTRUCTIONS, FINDINGS_TOOL, coherenceRequest } from "./coherence-reviewer-prompt.ts";

/** Longest text of a finding, in characters. */
export const MAX_FINDING_LENGTH = 300;
/** Most findings kept of one review: past them, the test is to be written again rather than repaired. */
export const MAX_FINDINGS = 5;

/** Runs the session of one review, and gives how it ended. */
export type CoherenceSession = (task: Pick<AgentTask, "instructions" | "tools" | "request" | "reminder">) => Promise<TerminalEvent>;

/**
 * The agent that reviews a test against the scenario of its plan.
 *
 * @remarks
 * It is an agent of its own: each review runs in a session of its own, with its own instructions and
 * `report_findings` as its only tool, which sees the scenario and the test and nothing of the session of the
 * agent that wrote the test. It judges whether the test does and verifies what its scenario says, which no
 * rule of the harness measures; it reviews neither duplicates, the matter of the reviewer of plans, nor the
 * quality of the code, the matter of another agent.
 *
 * What it reports is taken as it is given, an entry without a place and a sentence left out, each on one
 * line. A review whose session fails, reaches a limit or ends without a report throws.
 */
export class CoherenceReviewer implements CoherenceJudge {
  private readonly run: CoherenceSession;

  /** @param run - Runs the session of a review, under the limits and with the trace of its caller. */
  public constructor(run: CoherenceSession) {
    this.run = run;
  }

  /** {@inheritDoc CoherenceJudge.judge} */
  public async judge(scenario: PlannedScenario, test: string): Promise<readonly CoherenceFinding[]> {
    let reported: CoherenceFinding[] | undefined;
    const tool: ToolDefinition = {
      name: FINDINGS_TOOL,
      description: "Reports what the test does not do or verify of its scenario; an empty list when it is coherent with it.",
      parameters: {
        type: "object",
        properties: {
          findings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                where: { type: "string", description: "Where it is, such as step 2." },
                what: { type: "string", description: "What is wrong, in one sentence." },
              },
              required: ["where", "what"],
            },
          },
        },
        required: ["findings"],
      },
      execute: async (args) => {
        reported = findingsOf(args);
        return "Recorded. Answer with one word; call no more tools.";
      },
    };
    const reminder = () => (reported === undefined ? `Call ${FINDINGS_TOOL} now, with an empty list when the test is coherent with its scenario.` : undefined);
    const last = await this.run({ instructions: COHERENCE_REVIEWER_INSTRUCTIONS, tools: [tool], request: coherenceRequest(scenario, test), reminder });
    if (reported !== undefined) return reported;
    if (last.type === "error") throw new Error(last.error.message);
    throw new Error(last.type === "stopped" ? `the review reached its ${last.reason.limit} limit.` : "the review ended without a report.");
  }
}

/** The findings a call reports: its entries that give a place and a sentence, each on one line and cut, `MAX_FINDINGS` at most. */
function findingsOf(args: unknown): CoherenceFinding[] {
  const given = (args as { findings?: unknown } | null)?.findings;
  const entries = Array.isArray(given) ? (given as readonly (Partial<Record<keyof CoherenceFinding, unknown>> | null)[]) : [];
  const line = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, MAX_FINDING_LENGTH);
  return entries
    .flatMap((entry) => {
      const { where, what } = entry ?? {};
      return typeof where !== "string" || typeof what !== "string" ? [] : [{ where: line(where), what: line(what) }];
    })
    .slice(0, MAX_FINDINGS);
}
