import type { Locator, Page } from "playwright-core";

/** The part of the page an element is looked for in, such as the row of a table that holds it: by role, and a part of its accessible name. */
export interface TargetScope {
  readonly role: string;
  readonly name?: string;
}

/**
 * How a browser tool designates an element: by the locators the test charter recommends, and nothing
 * else, so that what the agent explores is what a test can write; inside a part of the page when the
 * element repeats, such as a button on each row. `exact` is what the locators of a snapshot end with: a
 * model that copies it changes nothing, names being matched exactly either way.
 */
export type Target = (
  { readonly role: string; readonly name?: string } | { readonly label: string } | { readonly testId: string } | { readonly text: string }
) & { readonly within?: TargetScope; readonly exact?: true };

const text = { type: "string", minLength: 1 } as const;
const within = {
  type: "object",
  description:
    'The part of the page that holds the element, when the locator of the snapshot starts with one: for a locator that starts with page.getByRole("row", { name: "…" }), the role row and that name, copied from the snapshot. It holds the element, it is never the element itself: to click the button Show Details of a row, the target is the button and within is the row.',
  properties: { role: text, name: { type: "string" } },
  required: ["role"],
  additionalProperties: false,
} as const;

/** What a model copies from the locators of a snapshot, which all end with it: names, labels and texts are always matched exactly, so it changes nothing. */
const exact = { const: true, description: "Names, labels and texts are always matched exactly: may be left out." } as const;

/** JSON Schema of a `Target`, for the parameters of the tools. */
export const TARGET_SCHEMA = {
  description:
    "The element, as the page snapshot recommends: by role and accessible name, by label, by test id, or by text; with within, inside the target, for the part of the page that holds it, when the snapshot names one.",
  oneOf: [
    { type: "object", properties: { role: text, name: { type: "string" }, exact, within }, required: ["role"], additionalProperties: false },
    { type: "object", properties: { label: text, exact, within }, required: ["label"], additionalProperties: false },
    { type: "object", properties: { testId: text, within }, required: ["testId"], additionalProperties: false },
    { type: "object", properties: { text, exact, within }, required: ["text"], additionalProperties: false },
  ],
} as const;

type AriaRole = Parameters<Page["getByRole"]>[0];

/**
 * How the accessible name of a target found by role is matched: exactly, for an element to act on, or as a
 * part of its name, for a part of the page, such as a row whose name is the text of all its cells.
 */
export type NameMatch = "exact" | "part";

/**
 * Builds the Playwright locator of a target, matching names, labels and texts exactly, and the name of the
 * part that holds it as a part of its name.
 *
 * @param page - The page to search.
 * @param target - The element, by role and name, label, test id or text, inside a part of the page or not.
 * @param match - How the name of a target found by role is matched; exactly by default.
 * @returns A locator for it.
 */
export function locate(page: Page, target: Target, match: NameMatch = "exact"): Locator {
  const scope = target.within;
  const base: Page | Locator = scope === undefined ? page : page.getByRole(scope.role as AriaRole, scope.name === undefined ? {} : { name: scope.name });
  if ("role" in target) {
    return base.getByRole(target.role as AriaRole, target.name === undefined ? {} : { name: target.name, ...(match === "exact" ? { exact: true } : {}) });
  }
  if ("label" in target) return base.getByLabel(target.label, { exact: true });
  if ("testId" in target) return base.getByTestId(target.testId);
  return base.getByText(target.text, { exact: true });
}

/**
 * Writes the Playwright code of a target, for the agent to reuse in a test.
 *
 * @param target - The element.
 * @param match - How the name of a target found by role is matched; exactly by default.
 * @returns The code that locates it, as a test would write it.
 */
export function targetCode(target: Target, match: NameMatch = "exact"): string {
  const quote = (value: string) => JSON.stringify(value);
  const scope = target.within;
  const base =
    scope === undefined
      ? "page"
      : scope.name === undefined
        ? `page.getByRole(${quote(scope.role)})`
        : `page.getByRole(${quote(scope.role)}, { name: ${quote(scope.name)} })`;
  if ("role" in target) {
    return target.name === undefined
      ? `${base}.getByRole(${quote(target.role)})`
      : `${base}.getByRole(${quote(target.role)}, { name: ${quote(target.name)}${match === "exact" ? ", exact: true" : ""} })`;
  }
  if ("label" in target) return `${base}.getByLabel(${quote(target.label)}, { exact: true })`;
  if ("testId" in target) return `${base}.getByTestId(${quote(target.testId)})`;
  return `${base}.getByText(${quote(target.text)}, { exact: true })`;
}
