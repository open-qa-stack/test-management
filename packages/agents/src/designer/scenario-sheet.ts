import type { PlannedScenario } from "@open-qa-stack/domain";
import { assertionsOf } from "./assertion-line.ts";
import type { DesignCursor } from "./design-cursor.ts";
import { oneLine } from "./one-line.ts";

/**
 * The skeleton of the test of a scenario: one test, one `test.step` per step of the plan, titled by its
 * number then its action, with the lines of code the plan gives for it, then, for each expect, an assertion
 * of each text it names: that the page shows it, or no longer does.
 *
 * @remarks
 * It parses and keeps the charter as it is. A step the plan gives no code for, such as one of an application
 * without a user interface, holds what to do as a comment instead. Its assertions find each text on the
 * element the plan gives for it — a field holds a value typed in it — or anywhere on the page when the plan
 * gives none.
 *
 * @param scenario - The scenario.
 * @param screenshots - Whether each step ends with a screenshot attached to the report, as the charter may ask.
 * @returns The text of the file.
 */
export function skeleton(scenario: PlannedScenario, screenshots: boolean): string {
  const steps = scenario.steps.map((step, at) => {
    const number = at + 1;
    const doing = step.code.length === 0 ? [`// Do: ${oneLine(step.action)}. Copy the code lines the browser tools returned.`] : step.code;
    const expects = step.expects.flatMap((expect, k) => [`// Expect ${number}.${k + 1}: ${oneLine(expect.result)}.`, ...assertionsOf(expect)]);
    const attach = screenshots
      ? [`await testInfo.attach(${JSON.stringify(String(number))}, { body: await page.screenshot(), contentType: "image/png" });`]
      : [];
    return [
      `  await test.step(${JSON.stringify(`${number}. ${oneLine(step.action)}`)}, async () => {`,
      ...[...doing, ...expects, ...attach].map((line) => `    ${line}`),
      "  });",
    ].join("\n");
  });
  const fixtures = screenshots ? "{ page }, testInfo" : "{ page }";
  return [
    `import { expect, test } from "@playwright/test";`,
    "",
    `test(${JSON.stringify(oneLine(scenario.title))}, async (${fixtures}) => {`,
    ...steps,
    "});",
    "",
  ].join("\n");
}

/**
 * The sheet of the scenario open: what it is, its data, its file and the skeleton of its test, then the
 * line that names the next call.
 *
 * @param cursor - Where the design stands, with a scenario open.
 * @param screenshots - Whether each step ends with a screenshot attached to the report.
 * @returns The text the agent is told.
 */
export function scenarioSheet(cursor: DesignCursor, screenshots: boolean): string {
  const scenario = cursor.scenario!;
  const data = scenario.data.length === 0 ? "none" : scenario.data.map((entry) => `${JSON.stringify(entry.value)} (${entry.from})`).join("; ");
  return [
    `Scenario ${cursor.rank} of ${cursor.plan.scenarios.length}: ${scenario.id} — ${scenario.title} (${scenario.kind}, ${scenario.case}), application ${scenario.application}.`,
    `Data: ${data}.`,
    `File: ${cursor.path}`,
    "",
    skeleton(scenario, screenshots),
    cursor.next(),
  ].join("\n");
}
