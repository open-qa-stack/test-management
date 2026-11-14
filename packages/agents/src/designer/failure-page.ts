import type { PlannedExpect, PlannedScenario } from "@open-qa-stack/domain";
import { checkable, observed } from "./observed.ts";
import { besideFields } from "./screen-watch.ts";

/** Most lines told for one text the page showed at a failure. */
const MAX_TOLD_LINES = 3;
/** The role a line of a snapshot starts with; `text` for a text outside any element. */
const ROLE = /^- '?([a-z]+)\b/;
/** What the error of an assertion whose locator found no element says. */
const NOT_FOUND = "element(s) not found";

/** A text the step that failed expects shown, with the lines of the page at the failure that hold it beside the fields. */
export interface ShownAtFailure {
  /** The text. */
  readonly text: string;
  /** The lines that hold it, none when the page did not show it beside the fields. */
  readonly lines: readonly string[];
}

/**
 * What the page at the failure of a run showed of each text the step that failed expects shown.
 *
 * @param scenario - The scenario of the test.
 * @param failedStep - The title of the step that failed, as the runner gives it: `2. …`, then the steps it
 * holds after ` › `.
 * @param page - The lines of the page at the failure.
 * @returns Each text that step expects shown, long enough to be checked, with the lines that hold it beside
 * the fields; none when no step of the plan failed.
 */
export function shownAtFailure(scenario: PlannedScenario, failedStep: string | undefined, page: readonly string[]): ShownAtFailure[] {
  const lines = besideFields(page);
  return expectsOf(scenario, failedStep)
    .flatMap((expect) => expect.shows)
    .filter(checkable)
    .map((text) => ({ text, lines: lines.filter((line) => observed(text, [line])) }));
}

/**
 * The texts the step that failed expects shown that the assertion that failed looked for in an element it
 * found nowhere, though the page at the failure showed each beside the fields: the application shows them,
 * and the assertion looked in another element.
 *
 * @param scenario - The scenario of the test.
 * @param failedStep - The title of the step that failed, as `shownAtFailure` takes it.
 * @param page - The lines of the page at the failure.
 * @param error - The error the run failed on.
 * @returns Those texts with the lines that hold them; none when the assertion found an element, as a matcher
 * of the page or a negative one does, when it names none of the texts the step expects shown, when the page
 * did not show one it names, and when the page still showed a text the step expects gone.
 */
export function misplacedAtFailure(scenario: PlannedScenario, failedStep: string | undefined, page: readonly string[], error: string): ShownAtFailure[] {
  if (!error.includes(NOT_FOUND)) return [];
  const lines = besideFields(page);
  const kept = expectsOf(scenario, failedStep)
    .flatMap((expect) => expect.absent)
    .some((text) => checkable(text) && observed(text, lines));
  const sought = shownAtFailure(scenario, failedStep, page).filter(({ text }) => observed(text, [error]));
  return !kept && sought.every((shown) => shown.lines.length > 0) ? sought : [];
}

/**
 * What the agent is told of the page at the failure: the elements that held each text the step expects
 * shown, and the texts it showed nowhere beside the fields.
 *
 * @param shown - What the page showed of those texts, as `shownAtFailure` gives it.
 * @returns The lines to tell, none when the step expects no text shown.
 */
export function failurePageText(shown: readonly ShownAtFailure[]): string[] {
  return shown.flatMap(({ text, lines }) =>
    lines.length === 0
      ? [`At the failure, the page showed "${text}" nowhere beside the fields.`]
      : [`At the failure, the page showed "${text}" in:`, ...lines.slice(0, MAX_TOLD_LINES), "Assert it on one of these elements."],
  );
}

/** The expects of the step that failed; none when no step of the plan did. */
function expectsOf(scenario: PlannedScenario, failedStep: string | undefined): readonly PlannedExpect[] {
  const number = /^(\d+)\. /.exec(failedStep ?? "")?.[1];
  return (number === undefined ? undefined : scenario.steps[Number(number) - 1])?.expects ?? [];
}

/**
 * An assertion of a text the page showed at a failure, on the first element that held it: by its role and
 * the text it holds, or by the text alone when it is in no element.
 *
 * @param shown - A text the page showed, with one line at least.
 * @returns The assertion, as a test writes it.
 */
export function assertionAt(shown: ShownAtFailure): string {
  const role = ROLE.exec(shown.lines[0]!)?.[1] ?? "text";
  const text = JSON.stringify(shown.text);
  const locator = role === "text" ? `page.getByText(${text})` : `page.getByRole(${JSON.stringify(role)}).filter({ hasText: ${text} })`;
  return `await expect(${locator}).toBeVisible();`;
}
