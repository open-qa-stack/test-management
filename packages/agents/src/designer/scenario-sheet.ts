import { effectWords, scenarioTags } from "./scenario-tags.ts";
import type { PlannedScenario } from "@open-qa-stack/domain";
import { assertionsOf } from "./assertion-line.ts";
import type { DesignCursor } from "./design-cursor.ts";
import { oneLine } from "./one-line.ts";
import { onTab } from "./tab-variable.ts";
import { tabVariable } from "@open-qa-stack/shared";
import { fixturesFor, PLAYWRIGHT_ALONE, type FixturesFile, type TestFixtures } from "./test-fixtures.ts";

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
 * @param fixtures - What the test is given: the module of its `test`, and the tabs that module gives.
 * @returns The text of the file.
 */
export function skeleton(scenario: PlannedScenario, screenshots: boolean, fixtures: TestFixtures = PLAYWRIGHT_ALONE): string {
  const steps = scenario.steps.map((step, at) => {
    const number = at + 1;
    // The expects of a step done on another application are asserted on the tab of that application.
    const here = (line: string) => (step.application === undefined ? line : onTab(line, step.application));
    const doing = step.code.length === 0 ? [`// Do: ${oneLine(step.action)}. Copy the code lines the browser tools returned.`] : step.code;
    const expects = step.expects.flatMap((expect, k) => [`// Expect ${number}.${k + 1}: ${oneLine(expect.result)}.`, ...assertionsOf(expect).map(here)]);
    const attach = screenshots
      ? [here(`await testInfo.attach(${JSON.stringify(String(number))}, { body: await page.screenshot(), contentType: "image/png" });`)]
      : [];
    return [
      `  await test.step(${JSON.stringify(`${number}. ${oneLine(step.action)}`)}, async () => {`,
      ...[...doing, ...expects, ...attach].map((line) => `    ${line}`),
      "  });",
    ].join("\n");
  });
  // The tab of each other application the test acts on: a fixture where the repository gives one, or else a page the test opens.
  const tabs = (scenario.applications ?? []).map(tabVariable);
  const opened = tabs.filter((tab) => !fixtures.tabs.includes(tab));
  const given = `{ ${["page", ...tabs.filter((tab) => fixtures.tabs.includes(tab)), ...(opened.length === 0 ? [] : ["context"])].join(", ")} }`;
  return [
    `import { expect, test } from ${JSON.stringify(fixtures.module)};`,
    "",
    `test(${JSON.stringify(oneLine(scenario.title))}, { tag: ${JSON.stringify(scenarioTags(scenario))} }, async (${screenshots ? `${given}, testInfo` : given}) => {`,
    ...opened.map((tab) => `  const ${tab} = await context.newPage();`),
    ...steps,
    "});",
    "",
  ].join("\n");
}

/**
 * The sheet of the scenario open: what it is and what it is meant to verify, its data, the elements of the
 * sources it cites, its file and the skeleton of its test, then the line that names the next call.
 *
 * @param cursor - Where the design stands, with a scenario open.
 * @param screenshots - Whether each step ends with a screenshot attached to the report.
 * @param fixtures - The file of the fixtures the tests of the repository share, if any.
 * @returns The text the agent is told.
 */
export function scenarioSheet(cursor: DesignCursor, screenshots: boolean, fixtures?: FixturesFile): string {
  const scenario = cursor.scenario!;
  const data = scenario.data.length === 0 ? "none" : scenario.data.map((entry) => `${JSON.stringify(entry.value)} (${entry.from})`).join("; ");
  const others =
    scenario.applications === undefined ? "" : `; it also acts on ${scenario.applications.join(", ")}, each in a tab of its own, as the skeleton gives them`;
  const cited = scenario.sources.map(({ source, item }) => (item === undefined ? source : `${source}: ${oneLine(item)}`));
  return [
    `Scenario ${cursor.rank} of ${cursor.plan.scenarios.length}: ${scenario.id} — ${scenario.title} (${scenario.level} level, ${scenario.kind}, ${scenario.case}, ${effectWords(scenario.effect)}), application ${scenario.application}${others}.`,
    `Intent: ${oneLine(scenario.intent)}.`,
    `Data: ${data}.`,
    `Cited: ${cited.join("; ")}.`,
    `File: ${cursor.path}`,
    "",
    skeleton(scenario, screenshots, fixturesFor(cursor.path!, fixtures)),
    cursor.next(),
  ].join("\n");
}
