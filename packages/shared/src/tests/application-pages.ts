import { className } from "./application-variable.ts";

/** Folder of the tests of an application, in its own folder: a folder per domain, then one per functionality. */
export const TESTS_FOLDER = "tests";

/** Folder of what the applications share, in the folder of the applications: the fixtures of the tests. */
export const SHARED_FOLDER = "shared";

/** Folder of the page objects of an application, in its own folder. */
export const PAGES_FOLDER = "pages";

/** Name of the file that gathers the page objects of an application, in their folder. */
export const PAGES_INDEX = "index.ts";

/** A page object of an application: the class of one of its screens. */
export interface ScreenClass {
  /** Name of the class, such as `CustomersPage`. */
  readonly name: string;
  /** Name of its file in the folder of the page objects, such as `customers.page.ts`. */
  readonly file: string;
}

/**
 * The name a test reaches the page object of a screen by, on its application.
 *
 * @param name - Name of the class of the page object, such as `CustomersPage`.
 * @returns The name, such as `customers`.
 */
export function screenMember(name: string): string {
  const bare = name.replace(/Page$/, "");
  return `${bare[0]!.toLowerCase()}${bare.slice(1)}`;
}

/**
 * The name of the class that gathers the screens of an application.
 *
 * @param application - Identifier of the application, such as `customer-management`.
 * @returns The name, such as `CustomerManagement`.
 */
export function applicationClass(application: string): string {
  return className(application, "app");
}

/**
 * The file that gathers the page objects of an application: a class that holds one of each of its screens,
 * all on the same page, which a test is given by the fixture of the application.
 *
 * @remarks
 * The harness writes it again each time it writes a page object: it holds nothing a person would add.
 *
 * @param application - The application: its identifier and its name.
 * @param screens - The page objects of its screens.
 * @returns The text of the file.
 */
export function applicationPages(application: { readonly id: string; readonly name: string }, screens: readonly ScreenClass[]): string {
  const sorted = [...screens].sort((a, b) => a.name.localeCompare(b.name));
  const member = (screen: ScreenClass) => screenMember(screen.name);
  return [
    `import type { Page } from "@playwright/test";`,
    ...sorted.map((screen) => `import { ${screen.name} } from "./${screen.file}";`),
    "",
    `/** The screens of ${application.name}, on one page. Written by oqas from the page objects of this folder: add nothing here. */`,
    `export class ${applicationClass(application.id)} {`,
    ...sorted.map((screen) => `  readonly ${member(screen)}: ${screen.name};`),
    ...(sorted.length === 0 ? [] : [""]),
    ...(sorted.length === 0
      ? ["  constructor(readonly page: Page) {}"]
      : ["  constructor(readonly page: Page) {", ...sorted.map((screen) => `    this.${member(screen)} = new ${screen.name}(page);`), "  }"]),
    "}",
    "",
  ].join("\n");
}
