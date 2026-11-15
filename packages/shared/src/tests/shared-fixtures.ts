import { applicationClass, PAGES_FOLDER, PAGES_INDEX } from "./application-pages.ts";
import { posix } from "node:path";
import { applicationVariable } from "./application-variable.ts";

/**
 * The fixtures every test of a test repository shares: the `test` and the `expect` its tests import, with
 * each application as a fixture that holds its page objects.
 *
 * @remarks
 * The application of a test is on its `page`; another one has a tab of its own in the same browser context,
 * so that what is under way on one stays as it is while the test acts on the other. Playwright makes only
 * the fixtures a test asks for. The file is the place where a team adds fixtures of its own.
 *
 * @param applications - Identifiers of the applications that have a user interface.
 * @param appsFrom - The folder of the applications, relative to that of the file; the same folder by default.
 * @returns The text of the file.
 */
export function sharedFixtures(applications: readonly string[], appsFrom = "."): string {
  return [
    `import { test as base, expect } from "@playwright/test";`,
    ...applications.map((id) => `import { ${applicationClass(id)} } from "${appsFrom}/${id}/${PAGES_FOLDER}/${PAGES_INDEX}";`),
    "",
    "/** Each application, with the page objects of its screens. */",
    "interface Applications {",
    ...applications.map((id) => `  ${applicationVariable(id)}: ${applicationClass(id)};`),
    "}",
    "",
    "/**",
    " * The test every test file imports: that of Playwright, with the fixtures of this repository. The application",
    " * of a test is on its page; another one has a tab of its own in the same browser context.",
    " */",
    "export const test = base.extend<Applications>({",
    ...applications.flatMap((id) => [
      `  ${applicationVariable(id)}: async ({ page, context }, use, testInfo) => {`,
      `    await use(new ${applicationClass(id)}(testInfo.project.name === ${JSON.stringify(id)} ? page : await context.newPage()));`,
      "  },",
    ]),
    "});",
    "",
    "export { expect };",
    "",
  ].join("\n");
}

/**
 * The folder of the applications as a file of fixtures imports from it: relative to the folder of the file.
 *
 * @param path - Path of the file of the fixtures, relative to the root of the test repository.
 * @param appsDir - Folder of the applications, relative to the root.
 * @returns The folder, such as `.` or `../apps`.
 */
export function appsFrom(path: string, appsDir: string): string {
  const folder = posix.relative(posix.dirname(path), appsDir);
  return folder === "" ? "." : folder.startsWith(".") ? folder : `./${folder}`;
}
