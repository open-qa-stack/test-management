import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProposedTest, TestCheck, TestFinding } from "@open-qa-stack/domain";
import type { ActiveRule } from "../charter/charter-rule.ts";
import type { LintRule } from "../charter/charter-control.ts";
import { CHARTER_CONTROLS } from "../charter/charter-controls.ts";
import { readLintReport, type LinterOutput } from "./lint-report.ts";

const OXLINT = fileURLToPath(new URL("bin/oxlint", import.meta.resolve("oxlint/package.json")));
const TSGOLINT = fileURLToPath(import.meta.resolve("oxlint-tsgolint/bin/tsgolint.js"));
const PLAYWRIGHT_PLUGIN = fileURLToPath(import.meta.resolve("eslint-plugin-playwright"));

/** Compiler options of the check, which the configuration of the test repository does not change. */
const COMPILER_OPTIONS = {
  target: "es2023",
  lib: ["es2023", "dom"],
  module: "preserve",
  moduleResolution: "bundler",
  strict: true,
  noEmit: true,
  allowImportingTsExtensions: true,
  skipLibCheck: true,
};

/** What a charter check needs. */
export interface CharterCheckOptions {
  /** Root of the test repository: a test may import its installed packages and its files by relative path. */
  readonly repository: string;
  /** The rules in force, as `resolveCharter` returns them; the controls of the other rules are off. */
  readonly rules: readonly ActiveRule[];
}

/**
 * Checks a proposed test against the TypeScript compiler and the test charter, without network and
 * without running it.
 *
 * @remarks
 * The test is copied to a temporary folder that sees the files and the installed packages of the test
 * repository, then linted with type checking. Nothing is written to the test repository.
 */
export class CharterCheck implements TestCheck {
  readonly #repository: string;
  readonly #lint: readonly LintRule[];
  readonly #charterRuleOf: ReadonlyMap<string, string>;

  /** @param options - The test repository and the rules in force. */
  constructor(options: CharterCheckOptions) {
    const inForce = new Set(options.rules.map((rule) => rule.id));
    const controls = CHARTER_CONTROLS.filter((control) => inForce.has(control.rule));
    this.#repository = options.repository;
    this.#lint = controls.flatMap((control) => control.lint);
    this.#charterRuleOf = new Map(controls.flatMap((control) => control.lint.map((lint) => [lint.name.slice(lint.name.indexOf("/") + 1), control.rule] as const)));
  }

  /**
   * @param test - The proposed file.
   * @returns The compiler errors and the charter findings, by line and column; none when the test may be written.
   * @throws RangeError when the path is not a relative path to a `.ts` file inside the test repository.
   */
  async check(test: ProposedTest): Promise<readonly TestFinding[]> {
    const path = checkedPath(test.path);
    const folder = await mkdtemp(join(tmpdir(), "test-check-"));
    try {
      await mkdir(dirname(join(folder, path)), { recursive: true });
      await writeFile(join(folder, path), test.content);
      await symlink(join(this.#repository, "node_modules"), join(folder, "node_modules"), "dir");
      await writeFile(join(folder, "tsconfig.json"), JSON.stringify({ compilerOptions: { ...COMPILER_OPTIONS, rootDirs: [".", this.#repository] }, files: [path] }));
      await writeFile(join(folder, "oxlintrc.json"), JSON.stringify(this.#configuration()));
      return readLintReport(await lint(folder, path), this.#charterRuleOf);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  #configuration(): object {
    return {
      categories: { correctness: "off" },
      jsPlugins: [PLAYWRIGHT_PLUGIN],
      rules: Object.fromEntries(this.#lint.map((rule) => [rule.name, ["error", ...(rule.options ?? [])]])),
    };
  }
}

function checkedPath(path: string): string {
  const normal = normalize(path);
  const [first] = normal.split(sep);
  if (isAbsolute(path) || first === ".." || first === "node_modules" || !normal.endsWith(".ts")) {
    throw new RangeError(`A proposed test needs a relative path to a .ts file inside the test repository: ${path}`);
  }
  return normal;
}

function lint(folder: string, path: string): Promise<LinterOutput> {
  const args = [OXLINT, "-c", "oxlintrc.json", "--tsconfig", "tsconfig.json", "--type-aware", "--type-check", "--format", "json", path];
  const env = { ...process.env, OXLINT_TSGOLINT_PATH: TSGOLINT };
  return new Promise((resolve) => {
    execFile(process.execPath, args, { cwd: folder, env }, (_error, stdout, stderr) => resolve({ stdout, stderr }));
  });
}
