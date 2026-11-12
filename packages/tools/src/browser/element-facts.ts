/** What the page says about an element, beyond its role and name. */
export interface ElementFacts {
  /** Its `data-testid`. */
  readonly testId: string | null;
  /** Its first label, or its `aria-label`. */
  readonly label: string | null;
  /** Its text, with spaces collapsed as Playwright's text locator does. */
  readonly text: string;
}

/** What `readFacts` reads of an element; the package is typed without the DOM library. */
export interface PageElement {
  /** The value of an attribute, or `null`. */
  getAttribute(name: string): string | null;
  /** The labels of a form field; absent on other elements. */
  readonly labels?: ArrayLike<{ readonly textContent: string | null }> | null;
  /** The text of the element and its descendants. */
  readonly textContent: string | null;
}

/**
 * Reads what identifies an element besides its role and name. Runs in the page.
 *
 * @param element - The element.
 * @returns Its first label (or its `aria-label`), its test id and its text.
 */
export function readFacts(element: PageElement): ElementFacts {
  const label = element.labels?.[0]?.textContent?.trim() ?? element.getAttribute("aria-label");
  return {
    testId: element.getAttribute("data-testid"),
    label: label === "" ? null : label,
    text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
  };
}

/**
 * Tells whether a locator found the element of the snapshot rather than another one. Runs in the page.
 *
 * @param found - The element the locator found.
 * @param expected - The element of the snapshot.
 * @returns Whether they are the same element.
 */
export function sameElement(found: unknown, expected: unknown): boolean {
  return found === expected;
}
