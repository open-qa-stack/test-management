import type { PlannedScenario } from "@open-qa-stack/domain";
import type { SpecAssertion, SpecOutline } from "@open-qa-stack/tools";
import { checkable, observed } from "./observed.ts";
import type { Refusal } from "./refusal.ts";
import { PROPOSE_TOOL } from "./test-proposals.ts";

/** The matchers whose first argument is a text the element must hold. */
const TEXT_MATCHERS = new Set(["toHaveText", "toContainText", "toHaveValue"]);

/** What the gates tell the agent would be accepted, once they refused the same reason three times. */
export interface ScenarioHelp {
  /** The skeleton of the test of the scenario. */
  readonly skeleton: string;
  /** The locator of an element the screens showed a text in, if one did. */
  readonly locatorOf: (text: string) => string | undefined;
}

/**
 * What the gates refuse in a test against the scenario it carries out: not exactly one test, steps that are
 * not those of the plan, in its order, a text of an expect asserted in no `expect` of its step or asserted
 * the other way round, and an assertion that can only pass.
 *
 * @param outline - The outline of the test.
 * @param scenario - The scenario of the plan.
 * @param help - What a refusal gives as accepted: the skeleton for the form of the test, an assertion of
 * each text for its texts.
 * @returns Every reason, in that order; none when the test keeps the plan.
 */
export function scenarioErrors(outline: SpecOutline, scenario: PlannedScenario, help: ScenarioHelp): Refusal[] {
  const refusals: Refusal[] = [];
    if (outline.tests !== 1) refusals.push({ code: "TEST-ONE", message: `the file must hold exactly one test, that of scenario ${scenario.id}.`, remedy: help.skeleton });
  const titles = outline.steps.map((step) => step.title ?? "");
  if (titles.length !== scenario.steps.length || titles.some((title, at) => !title.startsWith(`${at + 1}. `))) {
    const found = titles.length === 0 ? "none" : titles.map((title) => JSON.stringify(title)).join(", ");
    refusals.push({ code: "TEST-STEPS", message: `the test must hold one test.step per step of the plan, in order, titled "1. …" to "${scenario.steps.length}. …". Found: ${found}. Start from the skeleton of the scenario.`, remedy: help.skeleton });
  }
  scenario.steps.forEach((step, at) => {
    const number = at + 1;
    const range = outline.steps.find((candidate) => candidate.title?.startsWith(`${number}. `));
    const asserted = range === undefined ? [] : outline.assertions.filter((assertion) => range.start <= assertion.start && assertion.start < range.end);
    step.expects.forEach((expect, k) => {
      const texts = [...expect.shows.map((text) => ({ text, negative: false })), ...expect.absent.map((text) => ({ text, negative: true }))].filter(({ text }) => checkable(text));
      for (const { text, negative } of texts) {
        const holding = asserted.filter((assertion) => observed(text, [...assertion.subject, ...assertion.expected]));
        const remedy = `In step ${number}: ${assertionOf(text, negative, help.locatorOf(text))}`;
        if (holding.length === 0) {
          refusals.push({ code: "TEST-VALUE", message: `step ${number} must assert "${text}": expect ${number}.${k + 1} of the plan names it (${expect.result}). No await expect of that step holds it. An expected text is never changed or dropped; when the application shows something else, keep the assertion and call ${PROPOSE_TOOL} with diagnosis.`, remedy });
        } else if (holding.every((assertion) => assertion.negative !== negative)) {
          refusals.push({ code: "TEST-POLARITY", message: `expect ${number}.${k + 1} says the screen ${negative ? "no longer shows" : "shows"} "${text}", and step ${number} asserts the opposite. An expect is never reversed to pass. If the application does the opposite of the plan, call ${PROPOSE_TOOL} with diagnosis.`, remedy });
        }
      }
    });
  });
  return [...refusals, ...outline.assertions.flatMap(tautology)];
}

/**
 * The assertion of a text: that the element the screens showed it in holds it, or is visible when its
 * locator already names the text; that it is hidden for a text the screen no longer shows; the text
 * anywhere on the page when no screen gave its element.
 */
function assertionOf(text: string, negative: boolean, locator: string | undefined): string {
  const subject = locator ?? `page.getByText(${JSON.stringify(text)})`;
  if (negative) return `await expect(${subject}).toBeHidden();`;
  return locator === undefined || observed(text, [locator]) ? `await expect(${subject}).toBeVisible();` : `await expect(${subject}).toContainText(${JSON.stringify(text)});`;
}

/** The reason an assertion can only pass, if it can: its matcher expects a text its own locator found the element by. */
function tautology(assertion: SpecAssertion): Refusal[] {
  if (!TEXT_MATCHERS.has(assertion.matcher)) return [];
  const text = assertion.expected.find((expected) => checkable(expected) && observed(expected, assertion.located));
  return text === undefined ? [] : [{ code: "TEST-TAUT", message: `line ${assertion.line} looks for "${text}" in an element found by that same text: it can only pass. Find the element by something else — its row, its label, its role — then expect the text.` }];
}
