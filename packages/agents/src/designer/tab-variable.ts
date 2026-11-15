/**
 * The variable of the tab a test of several applications opens for one of the others: the application of the
 * test keeps its `page`, and each other one has a page of its own in the same browser context, so that what
 * is under way on one stays as it is while the test acts on another.
 *
 * @param application - Identifier of the application, such as `customer-management`.
 * @returns The name of the variable, such as `customerManagementPage`.
 */
export function tabVariable(application: string): string {
  const [first = "", ...rest] = application.split(/[^a-zA-Z0-9]+/).filter((part) => part !== "");
  const name = [first.toLowerCase(), ...rest.map((part) => `${part[0]!.toUpperCase()}${part.slice(1).toLowerCase()}`)].join("");
  return `${/^[0-9]/.test(name) ? "app" : ""}${name}Page`;
}

/** `page` where a line calls one of its members: a text that only ends with the word is left as it is. */
const ON_PAGE =
  /(?<![\w.$])page(?=\.(?:goto|getBy[A-Z]\w*|locator|frameLocator|keyboard|mouse|screenshot|reload|goBack|goForward|waitFor[A-Z]\w*|url|title)\b)/g;

/**
 * A line of code written for `page`, on the tab of another application.
 *
 * @param code - The line, as a browser tool returned it or as the harness wrote it.
 * @param application - Identifier of the application whose tab it is done on.
 * @returns The line, each `page` it acts on replaced by the variable of the tab.
 */
export function onTab(code: string, application: string): string {
  return code.replace(ON_PAGE, tabVariable(application));
}
