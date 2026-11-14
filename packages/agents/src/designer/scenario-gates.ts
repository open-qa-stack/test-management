import type { PlannedScenario } from "@open-qa-stack/domain";
import type { SpecAssertion, SpecOutline } from "@open-qa-stack/tools";
import { assertionOf } from "./assertion-line.ts";
import { checkable, observed } from "./observed.ts";
import type { Refusal } from "./refusal.ts";
import type { ShownElement } from "./screen-watch.ts";
import { PROPOSE_TOOL } from "./test-proposals.ts";

/** The matchers whose first argument is a text the element must hold. */
const TEXT_MATCHERS = new Set(["toHaveText", "toContainText", "toHaveValue"]);

/** What the gates tell the agent would be accepted, once they refused the same reason three times. */
export interface ScenarioHelp {
  /** The skeleton of the test of the scenario. */
  readonly skeleton: string;
  /** The element the screens showed a text in, if one did; one it went from first, for a text expected gone. */
  readonly locatorOf: (text: string, gone: boolean) => ShownElement | undefined;
  /** The lines of code the browser tools returned last, the last first. */
  readonly codes: readonly string[];
}

/** The line a refusal of a step without an action gives as an example when the browser tools returned none. */
const ACTION_EXAMPLE = 'await page.getByRole("button", { name: "Search", exact: true }).click();';
/** A click on a field, which keeps an action in a step without typing. */
const CLICK_EXAMPLE = 'await page.getByRole("textbox", { name: "Search", exact: true }).click();';

/**
 * What the gates refuse in a test against the scenario it carries out: not exactly one test, steps that are
 * not those of the plan, in its order, a step that does nothing on the application, a text of an expect asserted in no `expect` of its step — its
 * message aside, and an `expect` on `.or(…)` holding none — or asserted the other way round, an assertion that can only pass, and a value typed that is none of the data.
 *
 * @param outline - The outline of the test.
 * @param scenario - The scenario of the plan.
 * @param help - What a refusal gives as accepted: the skeleton for the form of the test, an assertion of
 * each text for its texts.
 * @returns Every reason, in that order; none when the test keeps the plan.
 */
export function scenarioErrors(outline: SpecOutline, scenario: PlannedScenario, help: ScenarioHelp): Refusal[] {
  const refusals: Refusal[] = [];
  if (outline.tests !== 1)
    refusals.push({ code: "TEST-ONE", message: `the file must hold exactly one test, that of scenario ${scenario.id}.`, remedy: help.skeleton });
  const titles = outline.steps.map((step) => step.title ?? "");
  if (titles.length !== scenario.steps.length || titles.some((title, at) => !title.startsWith(`${at + 1}. `))) {
    const found = titles.length === 0 ? "none" : titles.map((title) => JSON.stringify(title)).join(", ");
    refusals.push({
      code: "TEST-STEPS",
      message: `the test must hold one test.step per step of the plan, in order, titled "1. …" to "${scenario.steps.length}. …". Found: ${found}. Start from the skeleton of the scenario.`,
      remedy: help.skeleton,
    });
  }
  scenario.steps.forEach((step, at) => {
    const number = at + 1;
    const range = outline.steps.find((candidate) => candidate.title?.startsWith(`${number}. `));
    const asserted = range === undefined ? [] : outline.assertions.filter((assertion) => range.start <= assertion.start && assertion.start < range.end);
    if (range !== undefined && !outline.actions.some((start) => range.start <= start && start < range.end))
      refusals.push(actionRefusal(number, step.action, help.codes));
    const planned = step.expects.flatMap((expect) => [
      ...expect.shows.map((text) => ({ text, negative: false })),
      ...expect.absent.map((text) => ({ text, negative: true })),
    ]);
    // The whole step, for a model that would keep only the lines it is given.
    const remedy = [
      `Step ${number} must hold all of these, with its actions:`,
      ...planned.map(({ text, negative }) => assertionOf(text, negative, help.locatorOf(text, negative))),
    ].join("\n");
    step.expects.forEach((expect, k) => {
      const texts = [...expect.shows.map((text) => ({ text, negative: false })), ...expect.absent.map((text) => ({ text, negative: true }))].filter(
        ({ text }) => checkable(text),
      );
      for (const { text, negative } of texts) {
        // An assertion on either of two elements may pass on the one that does not hold the text.
        const holding = asserted.filter((assertion) => !assertion.alternative && observed(text, [...assertion.subject, ...assertion.expected]));
        if (holding.length === 0) {
          refusals.push({
            code: "TEST-VALUE",
            message: `step ${number} must assert "${text}": expect ${number}.${k + 1} of the plan names it (${expect.result}). No await expect of that step holds it. An expected text is never changed or dropped; when the application shows something else, keep the assertion and call ${PROPOSE_TOOL} with diagnosis.`,
            remedy,
          });
        } else if (holding.every((assertion) => assertion.negative !== negative)) {
          refusals.push({
            code: "TEST-POLARITY",
            message: `expect ${number}.${k + 1} says the screen ${negative ? "no longer shows" : "shows"} "${text}", and step ${number} asserts the opposite. An expect is never reversed to pass. If the application does the opposite of the plan, call ${PROPOSE_TOOL} with diagnosis.`,
            remedy,
          });
        }
      }
    });
  });
  return [...refusals, ...outline.assertions.flatMap(tautology), ...typedErrors(outline, scenario)];
}

/** The refusal of a step that does nothing on the application, with the lines of code the browser tools returned last as what it would accept. */
function actionRefusal(number: number, action: string, codes: readonly string[]): Refusal {
  const told = action.replace(/\s+/g, " ").trim();
  const message = `step ${number} does nothing: do "${told}" with the browser tools and copy the line of code they return into it, such as ${codes[0] ?? ACTION_EXAMPLE}`;
  if (codes.length === 0) return { code: "TEST-ACTION", message };
  return {
    code: "TEST-ACTION",
    message,
    remedy: [`Step ${number} must do "${told}" before its assertions. The last lines of code the browser tools returned, the last first:`, ...codes].join("\n"),
  };
}

/**
 * The reasons values a test types are none of the data of its scenario: neither one of them, nor a part of
 * one long enough to be checked; an empty value clears a field. A scenario without data types nothing: the
 * plan is frozen, and the typing is out of it, a click on the field keeping an action in a step that had
 * no other.
 */
function typedErrors(outline: SpecOutline, scenario: PlannedScenario): Refusal[] {
  const values = scenario.data.map((entry) => entry.value);
  const listed = values.map((value) => JSON.stringify(value)).join(", ");
  return outline.typed
    .filter(({ text }) => text !== "" && !values.includes(text) && !(checkable(text) && observed(text, values)))
    .map(({ line, text }) => ({
      code: "TEST-TYPED",
      message:
        values.length === 0
          ? `line ${line} types "${text}", and the plan gives scenario ${scenario.id} no data: its test types nothing. Remove that line; when it is the only action of its step, click the same field in its place, such as ${CLICK_EXAMPLE}`
          : `line ${line} types "${text}", which is no value of the data of scenario ${scenario.id} (${listed}). Type a value of the data.`,
    }));
}

/** The reason an assertion can only pass, if it can: its matcher expects a text its own locator found the element by. */
function tautology(assertion: SpecAssertion): Refusal[] {
  if (!TEXT_MATCHERS.has(assertion.matcher)) return [];
  const text = assertion.expected.find((expected) => checkable(expected) && observed(expected, assertion.located));
  return text === undefined
    ? []
    : [
        {
          code: "TEST-TAUT",
          message: `line ${assertion.line} looks for "${text}" in an element found by that same text: it can only pass. Find the element by something else — its row, its label, its role — then expect the text.`,
        },
      ];
}
