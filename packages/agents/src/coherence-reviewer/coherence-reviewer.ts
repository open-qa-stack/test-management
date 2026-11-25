import type { PlannedScenario } from "@open-qa-stack/domain";
import { findingLine, reportedFindings, type ReviewSession } from "../common/reported-findings.ts";
import type { CoherenceJudge } from "../designer/coherence-judge.ts";
import type { CoherenceFinding } from "../designer/design-state.ts";
import { COHERENCE_REVIEWER_INSTRUCTIONS, FINDINGS_TOOL, coherenceRequest } from "./coherence-reviewer-prompt.ts";

/** Longest text of a finding, in characters. */
export const MAX_FINDING_LENGTH = 300;
/** Most findings kept of one review: past them, the test is to be written again rather than repaired. */
export const MAX_FINDINGS = 5;

/** Runs the session of one review of coherence. */
export type CoherenceSession = ReviewSession;

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
    return reportedFindings(this.run, {
      agent: "coherence-reviewer",
      instructions: COHERENCE_REVIEWER_INSTRUCTIONS,
      request: coherenceRequest(scenario, test),
      tool: FINDINGS_TOOL,
      description: "Reports what the test does not do or verify of its scenario; an empty list when it is coherent with it.",
      finding: {
        type: "object",
        properties: {
          where: { type: "string", description: "Where it is, such as step 2." },
          what: { type: "string", description: "What is wrong, in one sentence." },
        },
        required: ["where", "what"],
      },
      whenEmpty: "when the test is coherent with its scenario",
      parse: findingsOf,
    });
  }
}

/** The findings a call reports: its entries that give a place and a sentence, each on one line and cut, `MAX_FINDINGS` at most. */
function findingsOf(entries: readonly unknown[]): CoherenceFinding[] {
  return (entries as readonly (Partial<Record<keyof CoherenceFinding, unknown>> | null)[])
    .flatMap((entry) => {
      const { where, what } = entry ?? {};
      return typeof where !== "string" || typeof what !== "string"
        ? []
        : [{ where: findingLine(where, MAX_FINDING_LENGTH), what: findingLine(what, MAX_FINDING_LENGTH) }];
    })
    .slice(0, MAX_FINDINGS);
}
