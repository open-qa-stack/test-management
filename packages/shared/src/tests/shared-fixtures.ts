import { tabVariable } from "./tab-variable.ts";

/** Name of the file of the fixtures every test of a test repository shares, in the folder of its applications. */
export const FIXTURES_FILE_NAME = "fixtures.ts";

/**
 * The fixtures every test of a test repository shares: the `test` and the `expect` its tests import, with a
 * tab for each application, opened in the browser context of the test when the test asks for it.
 *
 * @remarks
 * A test of one application acts on its `page`; a test of several asks for the tab of each other one by its
 * name, and Playwright opens only those asked for and closes them with the context. The file is the place
 * where a team adds fixtures of its own.
 *
 * @param applications - Identifiers of the applications the repository tests.
 * @returns The text of the file.
 */
export function sharedFixtures(applications: readonly string[]): string {
  const tabs = applications.map(tabVariable);
  return [
    `import { test as base, expect, type Page } from "@playwright/test";`,
    "",
    "/** A tab for each application: a page of its own in the browser context of the test, opened when the test asks for it. */",
    "interface ApplicationTabs {",
    ...tabs.map((tab) => `  ${tab}: Page;`),
    "}",
    "",
    "/** The test every test file imports: that of Playwright, with the fixtures of this repository. */",
    "export const test = base.extend<ApplicationTabs>({",
    ...tabs.flatMap((tab) => [`  ${tab}: async ({ context }, use) => {`, "    await use(await context.newPage());", "  },"]),
    "});",
    "",
    "export { expect };",
    "",
  ].join("\n");
}
