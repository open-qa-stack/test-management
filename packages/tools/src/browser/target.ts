import type { Locator, Page } from "playwright-core";

/**
 * How a browser tool designates an element: by the locators the test charter recommends, and nothing
 * else, so that what the agent explores is what a test can write.
 */
export type Target = { readonly role: string; readonly name?: string } | { readonly label: string } | { readonly testId: string } | { readonly text: string };

const text = { type: "string", minLength: 1 } as const;

/** JSON Schema of a `Target`, for the parameters of the tools. */
export const TARGET_SCHEMA = {
  description: "The element, as the page snapshot recommends: by role and accessible name, by label, by test id, or by text.",
  oneOf: [
    { type: "object", properties: { role: text, name: { type: "string" } }, required: ["role"], additionalProperties: false },
    { type: "object", properties: { label: text }, required: ["label"], additionalProperties: false },
    { type: "object", properties: { testId: text }, required: ["testId"], additionalProperties: false },
    { type: "object", properties: { text }, required: ["text"], additionalProperties: false },
  ],
} as const;

type AriaRole = Parameters<Page["getByRole"]>[0];

/**
 * Builds the Playwright locator of a target, matching names, labels and texts exactly.
 *
 * @param page - The page to search.
 * @param target - The element, by role and name, label, test id or text.
 * @returns A locator for it.
 */
export function locate(page: Page, target: Target): Locator {
  if ("role" in target) {
    return page.getByRole(target.role as AriaRole, target.name === undefined ? {} : { name: target.name, exact: true });
  }
  if ("label" in target) return page.getByLabel(target.label, { exact: true });
  if ("testId" in target) return page.getByTestId(target.testId);
  return page.getByText(target.text, { exact: true });
}

/**
 * Writes the Playwright code of a target, for the agent to reuse in a test.
 *
 * @param target - The element.
 * @returns The code that locates it, as a test would write it.
 */
export function targetCode(target: Target): string {
  const quote = (value: string) => JSON.stringify(value);
  if ("role" in target) {
    return target.name === undefined
      ? `page.getByRole(${quote(target.role)})`
      : `page.getByRole(${quote(target.role)}, { name: ${quote(target.name)}, exact: true })`;
  }
  if ("label" in target) return `page.getByLabel(${quote(target.label)}, { exact: true })`;
  if ("testId" in target) return `page.getByTestId(${quote(target.testId)})`;
  return `page.getByText(${quote(target.text)}, { exact: true })`;
}
