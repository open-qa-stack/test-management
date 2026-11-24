import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { readCoverageReport, rebasedCoverageReport, type FileCoverage } from "./coverage-report.ts";
import { declaresTypesOnly } from "./types-only.ts";
import { ScriptStep } from "./script-step.ts";
import type { TestMode } from "./check-options.ts";
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

/** The variable that names a file in which the check keeps the coverage of the whole workspace, for a tool that reads it. */
export const COVERAGE_REPORT = "OQAS_COVERAGE_REPORT";

/** The variable that tells the tests of the workspace the folders of the packages to test, separated by commas. */
export const TEST_PACKAGES = "OQAS_TEST_PACKAGES";

/** The variable that tells the tests of the workspace they are a part of them, which holds no threshold of its own. */
export const TEST_PART = "OQAS_TEST_PART";

/** What the step is given beside the workspace. */
export interface TestStepOptions {
  /** The file to keep the coverage of the whole workspace in, relative to the root; none to keep nothing. */
  readonly keep?: string | undefined;
  /** The names of the packages to test; every package when none is given. */
  readonly chosen?: ReadonlySet<string> | undefined;
  /** How the tests run. */
  readonly mode: TestMode;
}

/**
 * Runs the tests of the workspace and requires them to cover all the lines, branches and functions of every
 * file of code under the `src` folder of each package, those no test loads included.
 *
 * @remarks
 * A package is tested one of two ways. One with a `test` script of its own runs it, a few such packages at a
 * time, and leaves its coverage report in the folder it is given: its script starts the test runner of Node.js
 * with `--experimental-test-coverage`, which Node.js does not accept from `NODE_OPTIONS`, and is told there where
 * to write the report; or it measures another way, and reads the folder from `OQAS_COVERAGE_DIRECTORY`. Every other package with source files is tested by the `test` script of the root
 * of the workspace, which runs them all in one pool of processes sized to the machine and writes its coverage
 * report, in the LCOV format, in the folder `OQAS_COVERAGE_DIRECTORY` names.
 *
 * Either way the step reads what was covered from the report, not from an exit code: options of a script that
 * lower a threshold or leave files out of the measure change nothing, and a file of code missing from the
 * report, such as one no test loads, fails the step. Files that only declare types have no code to cover and
 * stay out of the measure; so do the modules a package lists as measured in a browser by its own tests and,
 * for a package the root tests, the entry points it lists as run as programs. The output of a run is written
 * in one piece once it has ended, so that runs at the same time do not mix their lines.
 *
 * The reports are removed once read, unless the step is given a file to keep them in: it then writes there the
 * reports of every run as one, in the LCOV format, each path relative to the root of the workspace.
 *
 * Given the packages to test, the step tests those alone and requires their coverage alone: the test script of the
 * root is told their folders in `OQAS_TEST_PACKAGES`.
 *
 * The tests may also run on several machines. A part runs a share of the test files of the root, by the `--shard`
 * of its test runner, and writes what it found and covered as a report of its own, holding no threshold: the
 * coverage of a part is not that of the code. The packages with a test script of their own run apart, with their
 * coverage. The merge reads the reports of every part as one run, then requires the coverage of the packages the
 * root tests, as a run of them all does.
 */
export class TestStep implements Step {
  public readonly name = "tests and coverage";
  private readonly root: string;
  private readonly packages: readonly WorkspacePackage[];
  private readonly write: (output: string) => void;
  private readonly keep: string | undefined;
  /** The names of the packages to test; every package when none is given. */
  private readonly chosen: ReadonlySet<string> | undefined;
  private readonly mode: TestMode;
  /** The reports read during a run, each path relative to the root. */
  private readonly read: string[] = [];

  /**
   * @param root - The root of the workspace.
   * @param packages - The packages of the workspace.
   * @param write - Writes the output of the tests of a package to the output of the check.
   * @param options - Where to keep the coverage, which packages to test and how.
   */
  public constructor(root: string, packages: readonly WorkspacePackage[], write: (output: string) => void, options: TestStepOptions) {
    this.root = root;
    this.packages = packages;
    this.write = write;
    this.keep = options.keep === undefined ? undefined : join(root, options.keep);
    this.chosen = options.chosen;
    this.mode = options.mode;
  }

  public async run(): Promise<readonly string[]> {
    const beside = this.packages.filter(({ path, name }) => path !== this.root && (this.chosen === undefined || this.chosen.has(name)));
    // A package without a test script of its own is tested by that of the root, when the root has one.
    const shared = beside.filter(({ sources, testScript }) => sources.length > 0 && testScript === undefined);
    const rooted = this.packages.some(({ path, testScript }) => path === this.root && testScript !== undefined);
    if (shared.length > 0 && !rooted) return shared.map(({ name }) => `${name} has source files and no test script`);
    const typesOnly = await typesOnlyFiles(this.packages.flatMap(({ sources }) => sources));
    const reports = await mkdtemp(join(tmpdir(), "check-coverage-"));
    try {
      const { kind } = this.mode;
      const only = this.mode.kind === "own" ? this.mode.only : undefined;
      const own =
        kind === "all" || kind === "own"
          ? beside.filter(
              ({ name, path, testScript }) => testScript !== undefined && (only === undefined || only === name || only === relative(this.root, path)),
            )
          : [];
      const together = kind === "own" || shared.length === 0 ? [] : [() => this.testTogether(shared, typesOnly, join(reports, "workspace"))];
      const runs = [...together, ...own.map((workspacePackage, index) => () => this.test(workspacePackage, typesOnly, join(reports, String(index))))];
      const findings = await eachOf(runs, PACKAGES_AT_ONCE, (run) => run());
      if (this.keep !== undefined) {
        await mkdir(dirname(this.keep), { recursive: true });
        await writeFile(this.keep, this.read.join(""));
      }
      return findings.flat();
    } finally {
      await rm(reports, { recursive: true, force: true });
    }
  }

  /**
   * Runs the test script of the root, and reads from its report what it covered of the packages it tests; or runs a part
   * of its tests, which reads nothing; or merges the reports of the parts, and reads what they covered together.
   */
  private async testTogether(shared: readonly WorkspacePackage[], typesOnly: ReadonlySet<string>, folder: string): Promise<string[]> {
    const packages = this.chosen === undefined ? {} : { [TEST_PACKAGES]: shared.map(({ path }) => relative(this.root, path)).join(",") };
    const env = { ...process.env, [COVERAGE_DIRECTORY]: folder, ...packages };
    const { mode } = this;
    if (mode.kind === "part")
      return [
        ...(await new ScriptStep(this.name, this.root, "test:part", { ...env, [TEST_PART]: `${mode.index}/${mode.count}` }, this.write, [
          `--shard=${mode.index}/${mode.count}`,
        ]).run()),
      ];
    const failures = await new ScriptStep(this.name, this.root, mode.kind === "merge" ? "test:merge" : "test", env, this.write).run();
    const covered = await this.report(join(folder, WORKSPACE_REPORT), this.root);
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

  /**
   * Runs the test script of a package, and reads what it covered from the report it leaves in the folder it is given: the
   * test runner of Node.js is told to write it there, and a script that measures another way reads the folder from
   * `OQAS_COVERAGE_DIRECTORY`.
   */
  private async test(workspacePackage: WorkspacePackage, typesOnly: ReadonlySet<string>, folder: string): Promise<string[]> {
    await mkdir(folder, { recursive: true });
    const report = join(folder, WORKSPACE_REPORT);
    const options = [
      process.env["NODE_OPTIONS"],
      ...COVERAGE,
      ...workspacePackage.sources.filter((file) => typesOnly.has(file)).map((file) => `"--test-coverage-exclude=${file}"`),
      "--test-reporter=spec",
      "--test-reporter-destination=stdout",
      "--test-reporter=lcov",
      `"--test-reporter-destination=${report}"`,
    ];
    const env = { ...process.env, [COVERAGE_DIRECTORY]: folder, NODE_OPTIONS: options.filter((option) => option !== undefined).join(" ") };
    const failures = await new ScriptStep(this.name, workspacePackage.path, "test", env, this.write).run();
    const covered = await this.report(report, workspacePackage.path);
    const code = codeOf(workspacePackage, typesOnly);
    return [...failures, ...code.flatMap((file) => coverageFindings(relative(workspacePackage.path, file), covered.get(file)))].map(
      (finding) => `${workspacePackage.name}: ${finding}`,
    );
  }

  /** Reads what a report says was covered, and holds it for the file the coverage is kept in. */
  private async report(file: string, base: string): Promise<Map<string, FileCoverage>> {
    const text = await readFile(file, "utf8").catch(() => "");
    this.read.push(rebasedCoverageReport(text, base, this.root));
    return readCoverageReport(text, base);
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
