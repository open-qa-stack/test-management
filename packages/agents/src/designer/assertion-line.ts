import { observed } from "./observed.ts";
import type { ShownElement } from "./screen-watch.ts";

/**
 * The assertion of a planned text, as a test writes it: that the field a screen showed it in holds it as its
 * value, a text expected shown having no other element; that the element it showed it in is visible when its locator already names the
 * text, or holds it; that it is hidden for a text the screen no longer shows; the text anywhere on the page
 * when no screen gave its element.
 *
 * @param text - The text.
 * @param negative - Whether the screen no longer shows it.
 * @param element - The element a screen showed it in, if one did; never a field for a text the screen no longer shows.
 * @returns The line of the assertion.
 */
export function assertionOf(text: string, negative: boolean, element: ShownElement | undefined): string {
  const quoted = JSON.stringify(text);
  if (element?.field === true) return `await expect(${element.locator}).toHaveValue(${quoted});`;
  const subject = element?.locator ?? `page.getByText(${quoted})`;
  if (negative) return `await expect(${subject}).toBeHidden();`;
  return element === undefined || observed(text, [element.locator])
    ? `await expect(${subject}).toBeVisible();`
    : `await expect(${subject}).toContainText(${quoted});`;
}
