import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { Check } from "../src/check.ts";
import { readCoverageReport } from "../src/coverage-report.ts";
import { CoverageDirectiveStep } from "../src/coverage-directive-step.ts";
import { declaresTypesOnly } from "../src/types-only.ts";

/** A directive that leaves the next line out of the coverage, written in two parts so that this file holds none. */
const IGNORE_NEXT = ["/* node:coverage", "ignore next */"].join(" ");

describe("the check", () => {
  it("names a step that throws, and runs no step after it", async () => {
    const lines: string[] = [];
    const failing = { name: "build", run: (): Promise<readonly string[]> => Promise.reject(new Error("pnpm could not start")) };
    const never = { name: "tests and coverage", run: (): Promise<readonly string[]> => assert.fail("ran after a step that failed") };
    assert.equal(await new Check([failing, never], (line) => lines.push(line)).run(), 1);
    assert.deepEqual(lines, ["check: build", "build could not run: Error: pnpm could not start", 'check: failed at the step "build"']);
  });
});

describe("a coverage report", () => {
  it("gives the counts of each file by its absolute path, a count it lacks being zero", () => {
    const report = ["TN:", "SF:src/a.ts", "FNF:1", "FNH:1", "BRF:3", "BRH:2", "LF:4", "LH:4", "end_of_record", "SF:/other/b.ts", "end_of_record", ""].join(
      "\n",
    );
    assert.deepEqual(
      readCoverageReport(report, "/demo"),
      new Map([
        ["/demo/src/a.ts", { lines: { found: 4, hit: 4 }, branches: { found: 3, hit: 2 }, functions: { found: 1, hit: 1 } }],
        ["/other/b.ts", { lines: { found: 0, hit: 0 }, branches: { found: 0, hit: 0 }, functions: { found: 0, hit: 0 } }],
      ]),
    );
  });
});

describe("the coverage directive step", () => {
  it("accepts the URL of an issue on the line of the directive or the line before, and nothing else", async () => {
    const root = await mkdtemp(join(tmpdir(), "check-directives-"));
    try {
      const file = join(root, "directives.ts");
      const lines = [
        `${IGNORE_NEXT} // https://github.com/open-qa-stack/test-management/issues/2`,
        "// https://github.com/open-qa-stack/test-management/issues/3",
        IGNORE_NEXT,
        "// https://github.com/example/test-management/issues/4",
        IGNORE_NEXT,
        ["/* node:coverage", "disable */"].join(" "),
        ["/* node:coverage", "enable */"].join(" "),
        ["/* v8", "ignore next */"].join(" "),
        ["/* istanbul", "ignore if */"].join(" "),
        `${["/* c8", "ignore start */"].join(" ")} // https://github.com/open-qa-stack/test-management/issues/5`,
      ];
      await writeFile(file, lines.join("\n"));
      const findings = await new CoverageDirectiveStep(root, [
        { name: "demo", path: root, testScript: undefined, sources: [file], measuredInBrowser: new Set(), runAsProgram: new Set() },
      ]).run();
      assert.deepEqual(findings, [
        "directives.ts:5: coverage directive without the URL of an issue of open-qa-stack/test-management",
        "directives.ts:6: coverage directive without the URL of an issue of open-qa-stack/test-management",
        "directives.ts:8: coverage directive without the URL of an issue of open-qa-stack/test-management",
        "directives.ts:9: coverage directive without the URL of an issue of open-qa-stack/test-management",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("a file that only declares types", () => {
  it("is one with nothing but types, comments and whitespace", () => {
    assert.equal(declaresTypesOnly('import type { A } from "./a.ts";\n/** B. */\nexport interface B extends A {}\n// done\n'), true);
    assert.equal(declaresTypesOnly("export type C = 1;\n/* a\n comment */\n"), true);
    assert.equal(declaresTypesOnly("export const d = 1;\n"), false);
  });
});
