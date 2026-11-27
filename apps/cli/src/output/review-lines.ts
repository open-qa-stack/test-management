import type { ReviewedTest, TestProposal } from "@open-qa-stack/domain";

/** How each status of the review is told. */
const STATUSES = { in_review: "to review", in_correction: "in correction", validated: "validated", set_aside: "set aside" } as const;

/** @returns The line of a test of the queue: its identifier, its status, its title, then where it comes from and how it went. */
export function reviewLine(test: ReviewedTest): string {
  const reviewed = test.reviewed ? `reviewed, ${test.remarkCount} ${test.remarkCount === 1 ? "remark" : "remarks"}` : "not reviewed";
  return `${test.id}  ${STATUSES[test.status]}  ${test.title}  (${test.application} › ${test.domain}, ${test.level}; ${test.verdict} after ${test.runs} ${test.runs === 1 ? "run" : "runs"}; ${reviewed})`;
}

/** @returns The lines of a test to review: its line, why it was written, what it does and verifies, the remarks on it, and its files. */
export function proposalLines(proposal: TestProposal): string[] {
  return [
    reviewLine(proposal),
    `${proposal.path}, on ${proposal.branch}`,
    ...(proposal.brief === undefined ? [] : [`Asked: ${proposal.brief}`]),
    ...(proposal.decision?.status === "in_correction"
      ? [`Correction asked of the session ${proposal.decision.session}: ${proposal.decision.instruction}`]
      : []),
    `Why: ${proposal.intent}`,
    `Sources: ${proposal.sources.map(({ source, item }) => (item === undefined ? source : `${source} — ${item}`)).join(", ") || "none"}`,
    ...proposal.steps.flatMap(({ action, expects }, at) => [`${at + 1}. ${action}`, ...expects.map((expected) => `   expects: ${expected}`)]),
    `Stands so: ${proposal.reason}`,
    ...proposal.remarks.map(({ about, where, what, rule }) => `Remark on its ${about}, ${where}${rule === undefined ? "" : ` (${rule})`}: ${what}`),
    `Files: ${proposal.files.map(({ path, added }) => `${path} (+${added})`).join(", ")}`,
  ];
}
