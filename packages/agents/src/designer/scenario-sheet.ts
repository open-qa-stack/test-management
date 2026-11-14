import type { PlannedScenario } from "@open-qa-stack/domain";
import { assertionOf } from "./assertion-line.ts";
import type { DesignCursor } from "./design-cursor.ts";
import type { ShownElement } from "./screen-watch.ts";

/** The element the screens showed a text in, if one did; one it went from first, for a text expected gone. */
export type ElementFinder = (text: string, gone: boolean) => ShownElement | undefined;

/**
 * The skeleton of the test of a scenario: one test, one `test.step` per step of the plan, titled by its
 * number then its action, with what to do as a comment, then, for each expect, an assertion of each text
 * it names: that the page shows it, or no longer does.
 *
 * @remarks
 * It parses and keeps the charter as it is. Its assertions find each text on the element a screen showed
 * it in — a field holds a value typed in it — or anywhere on the page when no screen gave its element: the
 * agent keeps each text, and may find its element better, from what the browser tools return.
 *
 * @param scenario - The scenario.
 * @param screenshots - Whether each step ends with a screenshot attached to the report, as the charter may ask.
 * @param find - The element the screens showed a text in.
 * @returns The text of the file.
 */
export function skeleton(scenario: PlannedScenario, screenshots: boolean, find: ElementFinder): string {
  const steps = scenario.steps.map((step, at) => {
    const number = at + 1;
    const expects = step.expects.flatMap((expect, k) => [
      `    // Expect ${number}.${k + 1}: ${oneLine(expect.result)}.`,
      ...expect.shows.map((text) => `    ${assertionOf(text, false, find(text, false))}`),
      ...expect.absent.map((text) => `    ${assertionOf(text, true, find(text, true))}`),
    ]);
    const attach = screenshots
      ? [`    await testInfo.attach(${JSON.stringify(String(number))}, { body: await page.screenshot(), contentType: "image/png" });`]
      : [];
    return [
      `  await test.step(${JSON.stringify(`${number}. ${oneLine(step.action)}`)}, async () => {`,
      `    // Do: ${oneLine(step.action)}. Copy the code lines the browser tools returned.`,
      ...expects,
      ...attach,
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
 * @param find - The element the screens showed a text in.
 * @returns The text the agent is told.
 */
export function scenarioSheet(cursor: DesignCursor, screenshots: boolean, find: ElementFinder): string {
  const scenario = cursor.scenario!;
  const data = scenario.data.length === 0 ? "none" : scenario.data.map((entry) => `${JSON.stringify(entry.value)} (${entry.from})`).join("; ");
  return [
    `Scenario ${cursor.rank} of ${cursor.plan.scenarios.length}: ${scenario.id} — ${scenario.title} (${scenario.kind}, ${scenario.case}), application ${scenario.application}.`,
    `Data: ${data}.`,
    `File: ${cursor.path}`,
    "",
    skeleton(scenario, screenshots, find),
    cursor.next(),
  ].join("\n");
}

/** A text on one line, as a comment or a title holds it. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/\.$/, "");
}
