import type { TestProject } from "./test-repository-base.ts";

/**
 * The README of a test repository: what it holds, how its tests are installed and run, and how they are told
 * apart by their tags.
 *
 * @param project - The project the repository is initialised for.
 * @returns The text of `README.md`.
 */
export function testRepositoryReadme(project: TestProject): string {
  const applications = project.applications.map(
    ({ id, name }) => `| \`${project.appsDir}/${id}/tests/\` | The tests of ${name}: a folder per domain, then one per functionality. |`,
  );
  const { fixturesFile } = project;
  // What the tests share, for a repository whose tests do not each stand alone.
  const shared =
    fixturesFile === undefined
      ? ""
      : `| \`${project.appsDir}/<application id>/pages/\` | The page objects of an application: one class per screen, which holds where its elements are. |
| \`${fixturesFile}\` | The fixtures every test shares: the \`test\` and the \`expect\` the tests import, with each application and its page objects. |\n`;
  const built =
    fixturesFile === undefined
      ? ""
      : `## Fixtures and page objects

A test imports \`test\` and \`expect\` from \`${fixturesFile}\`, never from \`@playwright/test\` itself, so that what the repository adds to a test is added once. That file gives each application as a fixture, named after it, such as \`customerManagement\` for an application \`customer-management\`. The application of a test is on its \`page\`; another one has a tab of its own, so that what is under way on one stays as it is while the test acts on the other.

An application holds a page object for each of its screens, such as \`customerManagement.customers\`. A page object says where the elements of its screen are, and a test acts on them: \`await customerManagement.customers.searchTextbox.fill("…")\`. What a test expects stays in the test. A locator that changes is changed once, in its page object.

A fixture a team needs — an account signed in, data created then removed — goes in \`${fixturesFile}\`; \`pages/index.ts\` is written again from the page objects of its folder.

`;
  return `# Playwright tests

The automated tests of the applications below, written with [Playwright](https://playwright.dev) and run with \`@playwright/test\` ${project.playwrightVersion}. \`oqas.json\` declares the applications, their environments and where each is reached; \`playwright.config.ts\` reads it and makes one Playwright project per application.

## Layout

| Path | What it holds |
|---|---|
${applications.join("\n")}
${shared}| \`playwright.config.ts\` | One project per application of \`oqas.json\`, the reports and what is kept of a failed test. |
| \`${project.stateDir}/\` | What the runs leave: the report, the results, the traces of the failed tests. |

## Running the tests

\`\`\`sh
npm ci
npx playwright install chromium
OQAS_ENVIRONMENT=<environment> npm test
\`\`\`

\`OQAS_ENVIRONMENT\` names the environment of \`oqas.json\` the tests run against. The base address of an application may be given instead with \`OQAS_BASE_URL_<APPLICATION ID>\`, in upper case, such as \`OQAS_BASE_URL_POLICY_MANAGEMENT\` for an application \`policy-management\`.

| Command | What it runs |
|---|---|
| \`npm test\` | Every test. |
| \`npm test -- --project=<application id>\` | The tests of one application. |
| \`npm run test:smoke\` | The smoke tests: each application answers. |
| \`npm run test:functional\` | The functional tests: one behaviour of one screen each. |
| \`npm run test:business\` | The business tests: a whole journey through several screens. |
| \`npm run test:cross-application\` | The tests that act in one application and verify in another. |
| \`npm run test:end-to-end\` | The tests that go through three applications or more. |
| \`npm run test:read-only\` | The tests that change no data of the environment. |
| \`npm run test:visual\` | The visual tests: each compares a screen with its reference. |
| \`npm run report\` | Opens the report of the last run. |
| \`npm run typecheck\` | Checks the types of every test, without running any. |

${built}## Tags

Every test bears the tags of what it is, after its title: \`@level-…\` for its level in the pyramid of tests, \`@domain-…\` for its functional domain, \`@feature-…\` for the functionality of that domain, \`@app-…\` for each application it acts on, \`@kind-…\` for what it checks, \`@case-nominal\` or \`@case-negative\`, and \`@data-read\` or \`@data-write\`. Any of them selects tests: \`npx playwright test --grep @domain-<domain>\`.

A test that writes data creates its own or puts back what it changed, so that it passes again when run twice.

## Visual tests

A visual test opens a screen and compares it with its reference, an image made at its first run and committed beside it. It compares the whole page, and the zones whose content changes from one run to the next are masked in the test, each by its own locator, so that the test tells a change of layout or of look, not one of data. A reference is that of one browser on one machine: run the visual tests where their references were made, and make them again there with \`npx playwright test --grep @kind-visual --update-snapshots\` when a screen is meant to change.

## When a test fails

The report holds, for each failed test, its trace and a screenshot: \`npm run report\`, then open the test. A test is never retried: one that fails once has failed.
`;
}
