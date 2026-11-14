import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { readCoverageReport, type FileCoverage } from "./coverage-report.ts";
import { declaresTypesOnly } from "./types-only.ts";
import { ScriptStep } from "./script-step.ts";
import type { Step } from "./step.ts";
import type { WorkspacePackage } from "./workspace-package.ts";

/** What the test runner of each package measures, and the thresholds it reports against. */
const COVERAGE = ["--test-coverage-include=src/**", "--test-coverage-lines=100", "--test-coverage-branches=100", "--test-coverage-functions=100"];

/** A file of code, which the tests must cover. */
const CODE = /\.[cm]?[jt]sx?$/;

/** A TypeScript file, which may only declare types. */
const TYPESCRIPT = /\.[cm]?ts$/;

/**
 * How many packages run their tests at the same time. Each of them already runs its test files side by side, on
 * every processor but one: more packages at once would only make the tests that wait on a delay less steady.
 */
const PACKAGES_AT_ONCE = 4;

/**
 * Runs the tests of every package, a few packages at a time, and requires them to cover all the lines, branches
 * and functions of every file of code under its `src` folder, those no test loads included.
 *
 * @remarks The output of a package is written in one piece once its tests have ended, so that the packages
 * running at the same time do not mix their lines. The step reads what was covered from a report of the test runner, not from its exit code: options of a
 * test script that lower a threshold or leave files out of the measure change nothing, and a file of code missing
 * from the report, such as one no test loads, fails the step. Files that only declare types have no code to cover
 * and stay out of the measure, and so do the modules a package lists as measured in a browser by its own tests.
 * The test script of a package must start the test runner with `--experimental-test-coverage`, which Node.js does
 * not accept from `NODE_OPTIONS`.
 */
export class TestStep implements Step {
  public readonly name = "tests and coverage";
  private readonly root: string;
  private readonly packages: readonly WorkspacePackage[];
  private readonly write: (output: string) => void;

  /**
   * @param root - The root of the workspace.
   * @param packages - The packages of the workspace.
   * @param write - Writes the output of the tests of a package to the output of the check.
   */
  public constructor(root: string, packages: readonly WorkspacePackage[], write: (output: string) => void) {
    this.root = root;
    this.packages = packages;
    this.write = write;
  }

  public async run(): Promise<readonly string[]> {
    const untested = this.packages.filter(({ sources, testScript }) => sources.length > 0 && testScript === undefined);
    if (untested.length > 0) return untested.map(({ name }) => `${name} has source files and no test script`);
    const typesOnly = await typesOnlyFiles(this.packages.flatMap(({ sources }) => sources));
    const reports = await mkdtemp(join(tmpdir(), "check-coverage-"));
    try {
      const tested = this.packages.filter(({ path, testScript }) => path !== this.root && testScript !== undefined);
      const findings = await eachOf(tested, PACKAGES_AT_ONCE, (workspacePackage, index) =>
        this.test(workspacePackage, typesOnly, join(reports, `${index}.info`)),
      );
      return findings.flat();
    } finally {
      await rm(reports, { recursive: true, force: true });
    }
  }

  private async test(workspacePackage: WorkspacePackage, typesOnly: ReadonlySet<string>, report: string): Promise<string[]> {
    const options = [
      process.env["NODE_OPTIONS"],
      ...COVERAGE,
      ...workspacePackage.sources.filter((file) => typesOnly.has(file)).map((file) => `"--test-coverage-exclude=${file}"`),
      "--test-reporter=spec",
      "--test-reporter-destination=stdout",
      "--test-reporter=lcov",
      `"--test-reporter-destination=${report}"`,
    ];
    const env = { ...process.env, NODE_OPTIONS: options.filter((option) => option !== undefined).join(" ") };
    const failures = await new ScriptStep(this.name, workspacePackage.path, "test", env, this.write).run();
    const covered = readCoverageReport(await readFile(report, "utf8").catch(() => ""), workspacePackage.path);
    const code = workspacePackage.sources.filter((file) => CODE.test(file) && !typesOnly.has(file) && !workspacePackage.measuredInBrowser.has(file));
    return [...failures, ...code.flatMap((file) => coverageFindings(relative(workspacePackage.path, file), covered.get(file)))].map(
      (finding) => `${workspacePackage.name}: ${finding}`,
    );
  }
}

/**
 * Runs a task on each item, a limited number of them at the same time.
 *
 * @returns What the task gave for each item, in the order of the items.
 */
async function eachOf<T, R>(items: readonly T[], atOnce: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      // The index is below the length of the items.
      results[index] = await task(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: atOnce }, worker));
  return results;
}

async function typesOnlyFiles(files: readonly string[]): Promise<Set<string>> {
  const typescript = files.filter((file) => TYPESCRIPT.test(file));
  const typesOnly = await Promise.all(typescript.map(async (file) => declaresTypesOnly(await readFile(file, "utf8"))));
  return new Set(typescript.filter((_, index) => typesOnly[index]));
}

function coverageFindings(file: string, coverage: FileCoverage | undefined): string[] {
  if (coverage === undefined) return [`${file} is missing from the coverage of the tests`];
  return Object.entries(coverage)
    .filter(([, { found, hit }]) => hit < found)
    .map(([kind, { found, hit }]) => `${file} has ${hit} of its ${found} ${kind} covered`);
}
