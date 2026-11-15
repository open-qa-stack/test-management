/** The options of the solo command. */
export interface Arguments {
  /** The test repository; the current folder by default. */
  readonly repository?: string;
  /** The environment the run targets; the only one declared by default. */
  readonly environment?: string;
  /** What to test, in the developer's words; the whole domain index by default. */
  readonly brief?: string;
  /** Whether to map every source again, even those whose card is up to date. */
  readonly force: boolean;
  /** The identifier of a run a limit stopped, to resume. */
  readonly resume?: string;
  /** Whether to print what the agents do while they do it. */
  readonly follow: boolean;
  /** Whether to print the usage and stop. */
  readonly help: boolean;
  /** Whether to initialise the test repository as a Playwright project, and stop. */
  readonly init: boolean;
}

/** The shape of the identifier of a run. */
const RUN_ID = /^oqas-[0-9A-Za-z-]+$/;

/** How to run the command, as `oqas --help` prints it. */
export const USAGE = `Usage: oqas [--repository <folder>] [--environment <name>] [--brief <text>] [--force-cartography] [--follow]
       oqas [--repository <folder>] --resume <run> [--follow]
       oqas [--repository <folder>] --init

Maps the target application, designs Playwright tests on a new local branch, runs them and gives a verdict per test.

Options:
  --repository <folder>  The test repository, which holds oqas.json; the current folder by default.
  --environment <name>   The environment to run against; the only one declared by default.
  --brief <text>         What to test, in your words: a domain, a ticket, a rule, a journey.
  --force-cartography    Map every source again, even those whose card is up to date.
  --follow               Print what the agents do while they do it: each tool call, its result, each message.
  --resume <run>         Resume a run a limit stopped, such as oqas-2026-11-13T12-00-00-000Z, from what it kept.
  --init                 Initialise the test repository as a Playwright project, from its oqas.json: write the files it
                         lacks, overwrite none, run nothing.
  --help                 Print this help.

Exit codes: 0 every test passed, 1 a test failed, 2 a test was blocked, indeterminate, skipped or not run,
3 the configuration or the options are invalid, 4 a prerequisite is missing, 5 the chain did not go to its end.
`;

/**
 * Reads the options of the command.
 *
 * @param argv - The arguments, without the program.
 * @returns The options, or why they are refused.
 */
export function parseArguments(argv: readonly string[]): { readonly ok: true; readonly arguments: Arguments } | { readonly ok: false; readonly error: string } {
  const values: { repository?: string; environment?: string; brief?: string; resume?: string } = {};
  let force = false;
  let help = false;
  let follow = false;
  let init = false;
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]!;
    if (argument === "--help") help = true;
    else if (argument === "--force-cartography") force = true;
    else if (argument === "--follow") follow = true;
    else if (argument === "--init") init = true;
    else if (argument === "--repository" || argument === "--environment" || argument === "--brief" || argument === "--resume") {
      const value = argv[i + 1];
      if (value === undefined || value.trim() === "" || value.startsWith("--")) return { ok: false, error: `${argument} needs a value.` };
      values[argument.slice(2) as keyof typeof values] = value;
      i++;
    } else return { ok: false, error: `Unknown option ${argument}; see oqas --help.` };
  }
  if (values.resume !== undefined && !RUN_ID.test(values.resume))
    return { ok: false, error: "--resume needs the identifier of a run, such as oqas-2026-11-13T12-00-00-000Z." };
  // A run resumed keeps its environment, its brief and the cards it made.
  if (values.resume !== undefined && (values.environment !== undefined || values.brief !== undefined || force))
    return {
      ok: false,
      error: "--resume keeps the environment and the brief of the run, and the cards it made: it takes no --environment, --brief nor --force-cartography.",
    };
  // An initialisation writes files and runs nothing: it takes the repository, and nothing of a run.
  if (init && (values.environment !== undefined || values.brief !== undefined || values.resume !== undefined || force || follow))
    return { ok: false, error: "--init writes the files of the test repository and runs nothing: it takes --repository alone." };
  return { ok: true, arguments: { ...values, force, follow, help, init } };
}
