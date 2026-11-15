import { tabVariable } from "@open-qa-stack/shared";

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
