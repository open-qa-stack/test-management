/** The options of the solo command. */
export interface Arguments {
  /** The test repository; the current folder by default. */
  readonly repository?: string;
  /** The environment the run targets; the only one declared by default. */
  readonly environment?: string;
  /** Whether to map every source again, even those whose card is up to date. */
  readonly force: boolean;
  /** Whether to print the usage and stop. */
  readonly help: boolean;
}

/** How to run the command, as `oqas --help` prints it. */
export const USAGE = `Usage: oqas [--repository <folder>] [--environment <name>] [--force-cartography]

Maps the target application, designs Playwright tests on a new local branch, runs them and gives a verdict per test.

Options:
  --repository <folder>  The test repository, which holds oqas.json; the current folder by default.
  --environment <name>   The environment to run against; the only one declared by default.
  --force-cartography    Map every source again, even those whose card is up to date.
  --help                 Print this help.

Exit codes: 0 every test passed, 1 a test failed, 2 a test was blocked, indeterminate, skipped or not run,
3 the configuration or the options are invalid, 4 a prerequisite is missing, 5 a step stopped before the tests ran.
`;

/**
 * Reads the options of the command.
 *
 * @param argv - The arguments, without the program.
 * @returns The options, or why they are refused.
 */
export function parseArguments(argv: readonly string[]): { readonly ok: true; readonly arguments: Arguments } | { readonly ok: false; readonly error: string } {
  const values: { repository?: string; environment?: string } = {};
  let force = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]!;
    if (argument === "--help") help = true;
    else if (argument === "--force-cartography") force = true;
    else if (argument === "--repository" || argument === "--environment") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) return { ok: false, error: `${argument} needs a value.` };
      values[argument === "--repository" ? "repository" : "environment"] = value;
      i++;
    } else return { ok: false, error: `Unknown option ${argument}; see oqas --help.` };
  }
  return { ok: true, arguments: { ...values, force, help } };
}
