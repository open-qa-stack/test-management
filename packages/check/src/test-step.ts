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
 * How many runs of tests go at the same time. Each of them already runs its test files side by side, on the
 * processors of the machine: more runs at once would only make the tests that wait on a delay less steady.
 */
const PACKAGES_AT_ONCE = 4;

/** The variable that tells the tests of the workspace where to write their coverage report. */
export const COVERAGE_DIRECTORY = "OQAS_COVERAGE_DIRECTORY";

/** The report the tests of the workspace write in that folder, in the LCOV format. */
const WORKSPACE_REPORT = "lcov.info";

/**
 * Runs the tests of the workspace and requires them to cover all the lines, branches and functions of every
 * file of code under the `src` folder of each package, those no test loads included.
 *
 * @remarks
 * A package is tested one of two ways. One with a `test` script of its own runs it, a few such packages at a
 * time: its script starts the test runner of Node.js with `--experimental-test-coverage`, which Node.js does not
 * accept from `NODE_OPTIONS`. Every other package with source files is tested by the `test` script of the root
 * of the workspace, which runs them all in one pool of processes sized to the machine and writes its coverage
 * report, in the LCOV format, in the folder `OQAS_COVERAGE_DIRECTORY` names.
 *
 * Either way the step reads what was covered from the report, not from an exit code: options of a script that
 * lower a threshold or leave files out of the measure change nothing, and a file of code missing from the
 * report, such as one no test loads, fails the step. Files that only declare types have no code to cover and
 * stay out of the measure; so do the modules a package lists as measured in a browser by its own tests and,
 * for a package the root tests, the entry points it lists as run as programs. The output of a run is written
 * in one piece once it has ended, so that runs at the same time do not mix their lines.
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
    const beside = this.packages.filter(({ path }) => path !== this.root);
    // A package without a test script of its own is tested by that of the root, when the root has one.
    const shared = beside.filter(({ sources, testScript }) => sources.length > 0 && testScript === undefined);
    const rooted = this.packages.some(({ path, testScript }) => path === this.root && testScript !== undefined);
    if (shared.length > 0 && !rooted) return shared.map(({ name }) => `${name} has source files and no test script`);
    const typesOnly = await typesOnlyFiles(this.packages.flatMap(({ sources }) => sources));
    const reports = await mkdtemp(join(tmpdir(), "check-coverage-"));
    try {
      const own = beside.filter(({ testScript }) => testScript !== undefined);
      const runs = [
        ...(shared.length === 0 ? [] : [() => this.testTogether(shared, typesOnly, join(reports, "workspace"))]),
        ...own.map((workspacePackage, index) => () => this.test(workspacePackage, typesOnly, join(reports, `${index}.info`))),
      ];
      const findings = await eachOf(runs, PACKAGES_AT_ONCE, (run) => run());
      return findings.flat();
    } finally {
      await rm(reports, { recursive: true, force: true });
    }
  }

  /** Runs the test script of the root, and reads from its report what it covered of the packages it tests. */
  private async testTogether(shared: readonly WorkspacePackage[], typesOnly: ReadonlySet<string>, folder: string): Promise<string[]> {
    const failures = await new ScriptStep(this.name, this.root, "test", { ...process.env, [COVERAGE_DIRECTORY]: folder }, this.write).run();
    const covered = readCoverageReport(await readFile(join(folder, WORKSPACE_REPORT), "utf8").catch(() => ""), this.root);
    return [
      ...failures,
      ...shared.flatMap((workspacePackage) =>
        codeOf(workspacePackage, typesOnly)
          .filter((file) => !workspacePackage.runAsProgram.has(file))
          .flatMap((file) => coverageFindings(relative(workspacePackage.path, file), covered.get(file)))
          .map((finding) => `${workspacePackage.name}: ${finding}`),
      ),
    ];
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
    const code = codeOf(workspacePackage, typesOnly);
    return [...failures, ...code.flatMap((file) => coverageFindings(relative(workspacePackage.path, file), covered.get(file)))].map(
      (finding) => `${workspacePackage.name}: ${finding}`,
    );
  }
}

/** The files of code of a package the tests must cover: neither a file that only declares types, nor a module measured in a browser. */
function codeOf(workspacePackage: WorkspacePackage, typesOnly: ReadonlySet<string>): string[] {
  return workspacePackage.sources.filter((file) => CODE.test(file) && !typesOnly.has(file) && !workspacePackage.measuredInBrowser.has(file));
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
