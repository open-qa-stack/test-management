import { findingLine, reportedFindings, type ReviewSession } from "../common/reported-findings.ts";
import type { QualityFinding } from "../designer/design-state.ts";
import type { QualityJudge } from "../designer/quality-judge.ts";

/** Name of the tool the reviewer of the code of a test reports its findings with. */
export const QUALITY_TOOL = "report_quality";
/** Longest text of a finding, in characters. */
export const MAX_FINDING_LENGTH = 300;
/** Most findings kept of one review. */
export const MAX_FINDINGS = 5;

/**
 * The agent that reviews the quality of the code of a test.
 *
 * @remarks
 * It is an agent of its own: each review runs in a session of its own, with the instructions its caller
 * composes from the test charter — such as `reviewerInstructions` of the harness — and `report_quality` as
 * its only tool. It sees the test and nothing else: neither its plan, whose coherence with the test is the
 * matter of another agent, nor the session of the agent that wrote it.
 *
 * A finding concerns the test, which the agent that wrote it can repair, or the plan, which it cannot: a
 * value asserted that changes with time or with the data of the environment is kept for a person. What it
 * reports is taken as it is given, an entry without a place and a sentence left out. A review whose session
 * fails, reaches a limit or ends without a report throws.
 */
export class CodeReviewer implements QualityJudge {
  private readonly run: ReviewSession;
  private readonly instructions: string;

  /**
   * @param run - Runs the session of a review, under the limits and with the trace of its caller.
   * @param instructions - The system instructions of the reviewer, with the charter it reviews against.
   */
  public constructor(run: ReviewSession, instructions: string) {
    this.run = run;
    this.instructions = instructions;
  }

  /** {@inheritDoc QualityJudge.judge} */
  public async judge(test: string): Promise<readonly QualityFinding[]> {
    return reportedFindings(this.run, {
      instructions: this.instructions,
      request: `The test:\n\`\`\`ts\n${test.trimEnd()}\n\`\`\`\n\nNext: call ${QUALITY_TOOL} with what you found, or with an empty list.`,
      tool: QUALITY_TOOL,
      description: "Reports what the code of the test lacks in quality; an empty list when it needs nothing.",
      finding: {
        type: "object",
        properties: {
          where: { type: "string", description: "Where it is: the line, or the step by its number." },
          what: { type: "string", description: "What is wrong and what to write instead, in one sentence." },
          rule: { type: "string", description: "The identifier of the rule of the charter it breaks, when it breaks one." },
          concerns: {
            type: "string",
            enum: ["test", "plan"],
            description: "test for what the agent that wrote the test can change; plan for what its plan fixed, such as a value asserted.",
          },
        },
        required: ["where", "what", "concerns"],
      },
      whenEmpty: "when the code needs nothing",
      parse: findingsOf,
    });
  }
}

/** The findings a call reports: its entries that give a place, a sentence and what they concern, each on one line and cut, `MAX_FINDINGS` at most. */
function findingsOf(entries: readonly unknown[]): QualityFinding[] {
  return (entries as readonly (Partial<Record<keyof QualityFinding, unknown>> | null)[])
    .flatMap((entry): QualityFinding[] => {
      const { where, what, rule, concerns } = entry ?? {};
      if (typeof where !== "string" || typeof what !== "string" || (concerns !== "test" && concerns !== "plan")) return [];
      const named = typeof rule === "string" && rule.trim() !== "" ? { rule: findingLine(rule, MAX_FINDING_LENGTH) } : {};
      return [{ where: findingLine(where, MAX_FINDING_LENGTH), what: findingLine(what, MAX_FINDING_LENGTH), concerns, ...named }];
    })
    .slice(0, MAX_FINDINGS);
}
