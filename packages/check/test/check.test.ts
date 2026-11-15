import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { DemoWorkspace } from "./demo-workspace.ts";

/** The source file of the demonstration package. */
const SIGN = "packages/demo/src/sign.ts";

/** The manifest of the demonstration package. */
const DEMO_MANIFEST = "packages/demo/package.json";

/** The test file of the demonstration package. */
const SIGN_TEST = "packages/demo/test/sign.test.ts";

/** A reference to an issue of the public repository, in the format a coverage directive needs. */
const ISSUE = "// https://github.com/open-qa-stack/test-management/issues/1";

/** A directive that leaves the next line out of the coverage, written in two parts so that this file holds none. */
const IGNORE_NEXT = ["/* node:coverage", "ignore next */"].join(" ");

/** A test of the demonstration package that only gives a positive number. */
const POSITIVE_ONLY = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { sign } from "../src/sign.ts";',
  "",
  'test("names the sign of a number", () => {',
  '  assert.equal(sign(1), "positive");',
  "});",
  "",
].join("\n");

/**
 * @param scripts - Scripts that replace or add to those of the demonstration package.
 * @returns The manifest of the demonstration package with these scripts.
 */
function demoManifest(scripts: Readonly<Record<string, string>>): string {
  const test = "node --test --experimental-test-coverage 'test/**/*.test.ts'";
  return JSON.stringify({ name: "demo", private: true, type: "module", scripts: { typecheck: "tsc -p tsconfig.json", test, ...scripts } });
}

/**
 * @param directive - The lines written before the branch.
 * @returns The sign of a number, with a branch for a value that is not a number, which no test runs.
 */
function signOrNone(directive: readonly string[]): string {
  return [
    "/** @returns The sign of a number. */",
    "export function sign(value: number): string {",
    ...directive.map((line) => `  ${line}`),
    '  if (Number.isNaN(value)) return "none";',
    '  return value < 0 ? "negative" : "positive";',
    "}",
    "",
  ].join("\n");
}

/**
 * Hands a new demonstration workspace to a case, and removes it afterwards.
 *
 * @param use - The case.
 * @returns What the case returns.
 */
async function inDemo<T>(use: (workspace: DemoWorkspace) => Promise<T>): Promise<T> {
  const workspace = await DemoWorkspace.create();
  try {
    return await use(workspace);
  } finally {
    await workspace.remove();
  }
}

/**
 * @param path - A file of the demonstration workspace.
 * @param text - Its new text.
 * @returns What the check gives once the file is written.
 */
function checkWith(path: string, text: string): ReturnType<DemoWorkspace["check"]> {
  return inDemo(async (workspace) => {
    await workspace.write(path, text);
    return workspace.check();
  });
}

/**
 * Sets the `test` script of the root of a demonstration workspace, or removes it.
 *
 * @param workspace - The workspace.
 * @param script - The script; none to leave the root without one.
 */
async function rootTestScript(workspace: DemoWorkspace, script?: string): Promise<void> {
  const manifest = JSON.parse(await workspace.read("package.json")) as { scripts: Record<string, string> };
  const scripts = Object.fromEntries(Object.entries(manifest.scripts).filter(([name]) => name !== "test"));
  await workspace.write("package.json", JSON.stringify({ ...manifest, scripts: script === undefined ? scripts : { ...scripts, test: script } }));
}

/** A test script of the root that tests the package `together`, and writes its coverage report where the check asks. */
const TOGETHER_SCRIPT = [
  'mkdir -p "$OQAS_COVERAGE_DIRECTORY" &&',
  "node --test --experimental-test-coverage --test-coverage-include='packages/together/src/**'",
  '--test-reporter=lcov --test-reporter-destination="$OQAS_COVERAGE_DIRECTORY/lcov.info"',
  "'packages/together/test/**/*.test.ts'",
].join(" ");

/**
 * Adds to a demonstration workspace a package without a test script, which the script of the root tests: a
 * module its test covers, and an entry point its manifest lists as run as a program.
 *
 * @param workspace - The workspace.
 */
async function testedTogether(workspace: DemoWorkspace): Promise<void> {
  await rootTestScript(workspace, TOGETHER_SCRIPT);
  await workspace.write(
    "packages/together/package.json",
    JSON.stringify({
      name: "together",
      private: true,
      type: "module",
      scripts: { typecheck: "tsc -p tsconfig.json" },
      coverage: { runAsProgram: ["src/main.ts"] },
    }),
  );
  await workspace.write("packages/together/tsconfig.json", JSON.stringify({ extends: "../../tsconfig.base.json", include: ["src", "test"] }));
  await workspace.write(
    "packages/together/src/double.ts",
    ["/** @returns Twice a number. */", "export function double(value: number): number {", "  return value * 2;", "}", ""].join("\n"),
  );
  await workspace.write(
    "packages/together/src/main.ts",
    ['import { double } from "./double.ts";', "", "process.stdout.write(String(double(2)));", ""].join("\n"),
  );
  await workspace.write(
    "packages/together/test/double.test.ts",
    [
      'import assert from "node:assert/strict";',
      'import { test } from "node:test";',
      'import { double } from "../src/double.ts";',
      "",
      'test("doubles a number", () => {',
      "  assert.equal(double(2), 4);",
      "});",
      "",
    ].join("\n"),
  );
}

describe("the check", { concurrency: true }, () => {
  it("criteria 1 and 9 — ends with 0 on code that passes every step, and leaves every versioned file unchanged", async () => {
    await inDemo(async (workspace) => {
      const git = (...args: string[]): string => execFileSync("git", args, { cwd: workspace.root, encoding: "utf8" });
      git("init", "-q");
      git("add", ".");
      git("-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "first");
      const run = await workspace.check();
      assert.equal(run.code, 0, run.output);
      assert.match(run.output, /check: every step passed/);
      assert.equal(git("status", "--porcelain", "--untracked-files=no"), "");
    });
  });

  it("criterion 2 — fails on a branch no test runs, naming the coverage step, the file and its branches", async () => {
    const run = await checkWith(SIGN_TEST, POSITIVE_ONLY);
    assert.notEqual(run.code, 0);
    assert.match(run.output, /sign\.ts\s+\|\s+100\.00\s+\|\s+66\.67\s+\|/);
    assert.match(run.output, /66\.67% branch coverage does not meet threshold of 100%/);
    assert.match(run.output, /check: failed at the step "tests and coverage"/);
  });

  it("criterion 3 — fails on a source file no test loads, naming it", async () => {
    const run = await checkWith("packages/demo/src/unused.ts", "export const unused = (value: number): number => value + 1;\n");
    assert.notEqual(run.code, 0);
    assert.match(run.output, /^demo: src\/unused\.ts is missing from the coverage of the tests$/m);
    assert.match(run.output, /check: failed at the step "tests and coverage"/);
  });

  it("criterion 4 — fails on a coverage directive without an issue, naming the file and the line", async () => {
    const run = await checkWith(SIGN, signOrNone([IGNORE_NEXT]));
    assert.notEqual(run.code, 0);
    assert.match(run.output, /packages\/demo\/src\/sign\.ts:3: coverage directive without the URL of an issue/);
    assert.match(run.output, /check: failed at the step "coverage directives"/);
  });

  it("criterion 4 — passes on the same directive after the URL of an issue", async () => {
    const run = await checkWith(SIGN, signOrNone([ISSUE, IGNORE_NEXT]));
    assert.equal(run.code, 0, run.output);
  });

  it("criterion 5 — fails on a strict typing error, naming the typecheck step", async () => {
    const run = await checkWith("packages/demo/src/twice.ts", "export function twice(value) {\n  return value * 2;\n}\n");
    assert.notEqual(run.code, 0);
    assert.match(run.output, /twice\.ts.*TS7006/);
    assert.match(run.output, /check: failed at the step "typecheck"/);
  });

  it("criterion 6 — fails on an explicit any, naming the lint step and the rule", async () => {
    const run = await checkWith("packages/demo/src/anything.ts", `${["export const anything:", "any = 1;"].join(" ")}\n`);
    assert.notEqual(run.code, 0);
    assert.match(run.output, /anything\.ts.*no-explicit-any/);
    assert.match(run.output, /check: failed at the step "lint"/);
  });

  it("criterion 7 — fails on a badly formatted file, naming the format step, and leaves the file unchanged", async () => {
    const badlyFormatted = 'export function sign(value:number):string{return value<0?"negative":"positive"}\n';
    await inDemo(async (workspace) => {
      await workspace.write(SIGN, badlyFormatted);
      const run = await workspace.check();
      assert.notEqual(run.code, 0);
      assert.match(run.output, /\[warn\] packages\/demo\/src\/sign\.ts/);
      assert.match(run.output, /check: failed at the step "format"/);
      assert.equal(await workspace.read(SIGN), badlyFormatted);
    });
  });

  it("criterion 8 — fails on a failing test, naming it", async () => {
    const run = await checkWith(SIGN_TEST, POSITIVE_ONLY.replace('"positive"', '"negative"'));
    assert.notEqual(run.code, 0);
    assert.match(run.output, /✖ names the sign of a number/);
    assert.match(run.output, /check: failed at the step "tests and coverage"/);
  });

  it("fails on a package with source files and no test script, when the root has none either, naming it", async () => {
    const run = await inDemo(async (workspace) => {
      await workspace.write("packages/untested/package.json", JSON.stringify({ name: "untested", private: true, type: "module" }));
      await workspace.write("packages/untested/src/one.js", "export const one = 1;\n");
      await rootTestScript(workspace);
      return workspace.check();
    });
    assert.notEqual(run.code, 0);
    assert.match(run.output, /^untested has source files and no test script$/m);
    assert.match(run.output, /check: failed at the step "tests and coverage"/);
  });

  it("tests with the script of the root a package without one, and leaves out the entry points it runs as programs", async () => {
    const run = await inDemo(async (workspace) => {
      await testedTogether(workspace);
      return workspace.check();
    });
    assert.equal(run.code, 0, run.output);
  });

  it("fails on a file the script of the root does not cover, naming its package", async () => {
    const run = await inDemo(async (workspace) => {
      await testedTogether(workspace);
      await workspace.write("packages/together/src/half.ts", "export const half = (value: number): number => value / 2;\n");
      return workspace.check();
    });
    assert.notEqual(run.code, 0);
    assert.match(run.output, /^together: src\/half\.ts is missing from the coverage of the tests$/m);
    assert.match(run.output, /check: failed at the step "tests and coverage"/);
  });

  it("fails on a script of the root that writes no coverage report, naming the sources it does not measure", async () => {
    const run = await inDemo(async (workspace) => {
      await testedTogether(workspace);
      await rootTestScript(workspace, "echo no tests");
      return workspace.check();
    });
    assert.notEqual(run.code, 0);
    assert.match(run.output, /^together: src\/double\.ts is missing from the coverage of the tests$/m);
    assert.match(run.output, /check: failed at the step "tests and coverage"/);
  });

  it("criterion 3 — fails on a TSX file no test loads, which the test runner leaves out of its report, naming it", async () => {
    const run = await checkWith("packages/demo/src/view.tsx", "export const view = 1;\n");
    assert.notEqual(run.code, 0);
    assert.match(run.output, /^demo: src\/view\.tsx is missing from the coverage of the tests$/m);
    assert.match(run.output, /check: failed at the step "tests and coverage"/);
  });

  it("leaves to the tests of a package the modules its manifest lists as measured in a browser", async () => {
    const run = await inDemo(async (workspace) => {
      await workspace.write("packages/demo/src/mount.tsx", "export const mount = 1;\n");
      const manifest = JSON.parse(await workspace.read(DEMO_MANIFEST)) as Record<string, unknown>;
      await workspace.write(DEMO_MANIFEST, JSON.stringify({ ...manifest, coverage: { measuredInBrowser: ["src/mount.tsx"] } }));
      return workspace.check();
    });
    assert.equal(run.code, 0, run.output);
  });

  it("rule 4 — fails on a test script that lowers the thresholds, naming what it leaves uncovered", async () => {
    const run = await inDemo(async (workspace) => {
      await workspace.write(SIGN_TEST, POSITIVE_ONLY);
      await workspace.write(
        DEMO_MANIFEST,
        demoManifest({ test: "node --test --experimental-test-coverage --test-coverage-lines=0 --test-coverage-branches=0 'test/**/*.test.ts'" }),
      );
      return workspace.check();
    });
    assert.notEqual(run.code, 0);
    assert.match(run.output, /^demo: src\/sign\.ts has 2 of its 3 branches covered$/m);
    assert.match(run.output, /check: failed at the step "tests and coverage"/);
  });

  it("rule 4 — fails on a test script that leaves its sources out of the measure, naming them", async () => {
    const run = await checkWith(
      DEMO_MANIFEST,
      demoManifest({ test: "node --test --experimental-test-coverage --test-coverage-exclude='src/**' 'test/**/*.test.ts'" }),
    );
    assert.notEqual(run.code, 0);
    assert.match(run.output, /^demo: src\/sign\.ts is missing from the coverage of the tests$/m);
    assert.match(run.output, /check: failed at the step "tests and coverage"/);
  });

  it("rule 4 — fails on a test script that does not run the tests, naming the sources it does not measure", async () => {
    const run = await checkWith(DEMO_MANIFEST, demoManifest({ test: "echo --experimental-test-coverage" }));
    assert.notEqual(run.code, 0);
    assert.match(run.output, /^demo: src\/sign\.ts is missing from the coverage of the tests$/m);
    assert.match(run.output, /check: failed at the step "tests and coverage"/);
  });

  it("rule 1 — fails on a package that does not build, naming the build step", async () => {
    const run = await checkWith(DEMO_MANIFEST, demoManifest({ build: "node -e 'process.exit(3)'" }));
    assert.notEqual(run.code, 0);
    assert.match(run.output, /check: failed at the step "build"/);
  });
});
