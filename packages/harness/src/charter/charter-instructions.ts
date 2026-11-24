import type { Repository } from "@open-qa-stack/domain";
import type { ActiveRule } from "./charter-rule.ts";

/**
 * Writes what the system instructions of the agent that writes a test say of the charter, after its own prompt.
 *
 * @param rules - The rules to apply, in order.
 * @param repository - The layout of the test repository.
 * @returns Every rule in one line, its identifier and its statement, then the folder of the tests. The example
 * of a rule comes with each finding that cites it.
 */
export function writerCharter(rules: readonly ActiveRule[], repository: Required<Repository>): string {
  const charter = rules.map((rule) => `- ${rule.id}: ${rule.statement}`);
  return [
    `Charter. Every test is checked against these rules before it runs; a finding names the rule and shows an example.\n${charter.join("\n")}`,
    `Tests of an application go in ${repository.appsDir}/<application id>/tests/<domain>/<functionality>/. The harness names the file.`,
  ].join("\n\n");
}

/**
 * Writes what the system instructions of the agent that reviews the code of a test say of the charter, after its own prompt.
 *
 * @param rules - The rules to apply, in order.
 * @param repository - The layout of the test repository.
 * @returns Every rule by its identifier, with its rationale and example, then the layout.
 */
export function reviewerCharter(rules: readonly ActiveRule[], repository: Required<Repository>): string {
  const charter = rules.map((rule) => {
    const lines = [`- ${rule.id}: ${rule.statement}`, `  Why: ${rule.rationale}`];
    if (rule.example !== undefined) lines.push("  Example:", ...rule.example.split("\n").map((line) => `    ${line}`));
    return lines.join("\n");
  });
  const layout = [
    `- Tests of an application: ${repository.appsDir}/<application id>/tests/<domain>/<functionality>/`,
    `- Blocks of an application: ${repository.appsDir}/<application id>/${repository.blocksDir}/`,
    `- Journeys across applications: ${repository.journeysDir}/`,
  ];
  return [`Charter:\n${charter.join("\n")}`, `Repository layout:\n${layout.join("\n")}`].join("\n\n");
}
