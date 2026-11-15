import type { ExpectedElement, PlannedExpect, PlannedScenario } from "@open-qa-stack/domain";
import { checkable, observed } from "./observed.ts";

/**
 * The values a test of a scenario writes in the environment: those of its data, for a scenario that writes.
 *
 * @param scenario - The scenario.
 * @returns The values long enough to be told in a text; none for a scenario that only reads.
 */
export function writtenValues(scenario: Pick<PlannedScenario, "effect" | "data">): string[] {
  return scenario.effect === "write" ? scenario.data.map((entry) => entry.value).filter(checkable) : [];
}

/**
 * The assertions of the texts of an expect of a plan, as a test writes them: those it shows, then those it
 * no longer shows, each on the element the plan gives for it, if it gives one.
 *
 * @param expect - The expect.
 * @param written - The values the test writes in the environment, as `writtenValues` gives them.
 * @returns The lines of the assertions, one per text.
 */
export function assertionsOf(expect: PlannedExpect, written: readonly string[] = []): string[] {
  const element = (text: string) => expect.elements.find((candidate) => candidate.text === text);
  // What a test writes stays in the environment, in a history or a list, and each run may add to it: such a text is counted.
  const repeats = (text: string) => written.some((value) => observed(value, [text]));
  const line = (text: string, negative: boolean) => assertionOf(text, negative, element(text), repeats(text));
  return [...expect.shows.map((text) => line(text, false)), ...expect.absent.map((text) => line(text, true))];
}

/**
 * The assertion of a planned text, as a test writes it: that the field a screen showed it in holds it as its
 * value, a text expected shown having no other element; that the element it showed it in is visible when its locator already names the
 * text, or holds it; that it is hidden for a text the screen no longer shows; for an element several share
 * the locator of, that one of them at least is there, or that none is left, by their number; when no
 * screen gave its element, that the page holds the text in one place at least, whatever the number of elements that
 * hold it, or that it is hidden for a text the screen no longer shows.
 *
 * @param text - The text.
 * @param negative - Whether the screen no longer shows it.
 * @param element - The element the plan gives for it, if it gives one; never a field for a text the screen no longer shows.
 * @param repeats - Whether the text holds a value the test writes: the page may then hold it in several places, more with each
 * run, whatever it held when the plan was made, and the elements it shows are counted.
 * @returns The line of the assertion.
 */
export function assertionOf(text: string, negative: boolean, element: ExpectedElement | undefined, repeats = false): string {
  const quoted = JSON.stringify(text);
  if (element?.field === true) return `await expect(${element.locator}).toHaveValue(${quoted});`;
  if (repeats && (element === undefined || observed(text, [element.locator]))) {
    const located = shown(element?.locator ?? `page.getByText(${quoted})`);
    return negative ? `await expect(${located}).toHaveCount(0);` : `await expect(${located}).not.toHaveCount(0);`;
  }
  // Several elements share the locator: one at least is shown, or none is left.
  if (element?.count !== undefined)
    return negative ? `await expect(${element.locator}).toHaveCount(0);` : `await expect(${shown(element.locator)}).not.toHaveCount(0);`;
  const subject = element?.locator ?? `page.getByText(${quoted})`;
  if (negative) return `await expect(${subject}).toBeHidden();`;
  // No screen gave its element: the page may hold the text in several places, and one a user sees is enough.
  if (element === undefined) return `await expect(${shown(subject)}).not.toHaveCount(0);`;
  return observed(text, [element.locator]) ? `await expect(${element.locator}).toBeVisible();` : `await expect(${element.locator}).toContainText(${quoted});`;
}

/** A locator held to the elements the page shows: one it holds hidden, off the screen or folded away is none a user sees. */
function shown(locator: string): string {
  return `${locator}.filter({ visible: true })`;
}
