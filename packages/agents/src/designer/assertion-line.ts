import type { ExpectedElement, PlannedExpect } from "@open-qa-stack/domain";
import { observed } from "./observed.ts";

/**
 * The assertions of the texts of an expect of a plan, as a test writes them: those it shows, then those it
 * no longer shows, each on the element the plan gives for it, if it gives one.
 *
 * @param expect - The expect.
 * @returns The lines of the assertions, one per text.
 */
export function assertionsOf(expect: PlannedExpect): string[] {
  const element = (text: string) => expect.elements.find((candidate) => candidate.text === text);
  return [...expect.shows.map((text) => assertionOf(text, false, element(text))), ...expect.absent.map((text) => assertionOf(text, true, element(text)))];
}

/**
 * The assertion of a planned text, as a test writes it: that the field a screen showed it in holds it as its
 * value, a text expected shown having no other element; that the element it showed it in is visible when its locator already names the
 * text, or holds it; that it is hidden for a text the screen no longer shows; for an element several share
 * the locator of, that one of them at least is there, or that none is left, by their number; the text
 * anywhere on the page when no screen gave its element.
 *
 * @param text - The text.
 * @param negative - Whether the screen no longer shows it.
 * @param element - The element the plan gives for it, if it gives one; never a field for a text the screen no longer shows.
 * @returns The line of the assertion.
 */
export function assertionOf(text: string, negative: boolean, element: ExpectedElement | undefined): string {
  const quoted = JSON.stringify(text);
  if (element?.field === true) return `await expect(${element.locator}).toHaveValue(${quoted});`;
  // Several elements share the locator: one at least shows the text, or none is left.
  if (element?.count !== undefined) return `await expect(${element.locator})${negative ? "" : ".not"}.toHaveCount(0);`;
  const subject = element?.locator ?? `page.getByText(${quoted})`;
  if (negative) return `await expect(${subject}).toBeHidden();`;
  return element === undefined || observed(text, [element.locator])
    ? `await expect(${subject}).toBeVisible();`
    : `await expect(${subject}).toContainText(${quoted});`;
}
