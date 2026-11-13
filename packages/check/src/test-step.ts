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
 * Runs the tests of every package, one package after the other, and requires them to cover all the lines, branches
 * and functions of every file of code under its `src` folder, those no test loads included.
 *
 * @remarks The step reads what was covered from a report of the test runner, not from its exit code: options of a
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

  /**
   * @param root - The root of the workspace.
   * @param packages - The packages of the workspace.
   */
  public constructor(root: string, packages: readonly WorkspacePackage[]) {
    this.root = root;
    this.packages = packages;
  }

  public async run(): Promise<readonly string[]> {
    const untested = this.packages.filter(({ sources, testScript }) => sources.length > 0 && testScript === undefined);
    if (untested.length > 0) return untested.map(({ name }) => `${name} has source files and no test script`);
    const typesOnly = await typesOnlyFiles(this.packages.flatMap(({ sources }) => sources));
    const reports = await mkdtemp(join(tmpdir(), "check-coverage-"));
    try {
      const tested = this.packages.filter(({ path, testScript }) => path !== this.root && testScript !== undefined);
      const findings: string[] = [];
      for (const [index, workspacePackage] of tested.entries())
        findings.push(...(await this.test(workspacePackage, typesOnly, join(reports, `${index}.info`))));
      return findings;
    } finally {
      await rm(reports, { recursive: true, force: true });
    }
  }

  private async test(workspacePackage: WorkspacePackage, typesOnly: ReadonlySet<string>, report: string): Promise<string[]> {
    const options = [
      process.env["NODE_OPTIONS"],
      ...COVERAGE,
      ...[...typesOnly].map((file) => `"--test-coverage-exclude=${file}"`),
      "--test-reporter=spec",
      "--test-reporter-destination=stdout",
      "--test-reporter=lcov",
      `"--test-reporter-destination=${report}"`,
    ];
    const env = { ...process.env, NODE_OPTIONS: options.filter((option) => option !== undefined).join(" ") };
    const failures = await new ScriptStep(this.name, workspacePackage.path, "test", env).run();
    const covered = readCoverageReport(await readFile(report, "utf8").catch(() => ""), workspacePackage.path);
    const code = workspacePackage.sources.filter((file) => CODE.test(file) && !typesOnly.has(file) && !workspacePackage.measuredInBrowser.has(file));
    return [...failures, ...code.flatMap((file) => coverageFindings(relative(workspacePackage.path, file), covered.get(file)))].map(
      (finding) => `${workspacePackage.name}: ${finding}`,
    );
  }
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
