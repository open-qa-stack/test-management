import type { Repository } from "@open-qa-stack/shared";
import type { ActiveRule } from "./charter-rule.ts";
import { DESIGNER_METHOD } from "./designer-method.ts";

const DESIGNER_ROLE = `You are the test designer of a test platform. You write Playwright tests, in TypeScript with @playwright/test, for the applications the domain index describes. Every test you write follows each rule of the charter below.`;

const REVIEWER_ROLE = `You are the test reviewer of a test platform. You review the Playwright tests the designer proposes against the charter below. For each rule a test breaks, cite the identifier of the rule, exactly as listed, and the line that breaks it. A test that breaks no rule is accepted.`;

/**
 * Writes the system instructions of the test designer.
 *
 * @param rules - The rules to apply, in order.
 * @param repository - The layout of the test repository.
 * @returns The instructions: the role, then every rule by its identifier, then the layout, then the method.
 */
export function designerInstructions(rules: readonly ActiveRule[], repository: Required<Repository>): string {
  return `${instructions(DESIGNER_ROLE, rules, repository)}\n\n${DESIGNER_METHOD}`;
}

/**
 * Writes the system instructions of the test reviewer.
 *
 * @param rules - The rules to apply, in order.
 * @param repository - The layout of the test repository.
 * @returns The instructions: the role, then every rule by its identifier, then the layout.
 */
export function reviewerInstructions(rules: readonly ActiveRule[], repository: Required<Repository>): string {
  return instructions(REVIEWER_ROLE, rules, repository);
}

function instructions(role: string, rules: readonly ActiveRule[], repository: Required<Repository>): string {
  const charter = rules.map((rule) => {
    const lines = [`- ${rule.id}: ${rule.statement}`, `  Why: ${rule.rationale}`];
    if (rule.example !== undefined) lines.push("  Example:", ...rule.example.split("\n").map((line) => `    ${line}`));
    return lines.join("\n");
  });
  const layout = [
    `- Tests of an application: ${repository.appsDir}/<application id>/`,
    `- Blocks of an application: ${repository.appsDir}/<application id>/${repository.blocksDir}/`,
    `- Journeys across applications: ${repository.journeysDir}/`,
  ];
  return [role, `Charter:\n${charter.join("\n")}`, `Repository layout:\n${layout.join("\n")}`].join("\n\n");
}
