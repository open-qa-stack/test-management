/**
 * The workflow of a test repository: what is verified of its tests on every pull request, without an
 * environment to run them against.
 *
 * @remarks
 * It reads the repository and nothing else, and every action is pinned to a commit. Running the tests needs
 * an environment the runner reaches: that is a job of the team, added to this one.
 *
 * @returns The text of `.github/workflows/tests.yml`.
 */
export function testRepositoryWorkflow(): string {
  return `name: tests

on:
  pull_request:
  push:
    branches: [main]

# The workflow reads the repository and nothing else.
permissions:
  contents: read

concurrency:
  group: tests-\${{ github.ref }}
  cancel-in-progress: \${{ github.ref != 'refs/heads/main' }}

jobs:
  check:
    # What can be verified of the tests without an environment: their types, and that Playwright lists them all.
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npx playwright test --list
`;
}
