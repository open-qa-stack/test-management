import { Check } from "./check.ts";
import { checkOptions, USAGE, type PackageChoice } from "./check-options.ts";
import { CoverageDirectiveStep } from "./coverage-directive-step.ts";
import { namedPackages, touchedLine, touchedPackages } from "./package-choice.ts";
import { ScriptStep } from "./script-step.ts";
import { SecretsStep } from "./secrets-step.ts";
import type { Step } from "./step.ts";
import { COVERAGE_REPORT, TestStep } from "./test-step.ts";
import { workspacePackages } from "./workspace-package.ts";

const root = process.cwd();
const options = checkOptions(process.argv.slice(2));
if (options === undefined) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}
const packages = await workspacePackages(root);
const chosen = await choice(options.packages);
const before: Step[] = [
  new ScriptStep("typecheck", root, "typecheck"),
  new ScriptStep("lint", root, "lint"),
  new ScriptStep("format", root, "format:check"),
  new ScriptStep("build", root, "build"),
  new CoverageDirectiveStep(root, packages),
  new SecretsStep(root),
];
const tests =
  options.tests === undefined
    ? []
    : [new TestStep(root, packages, (output) => process.stdout.write(output), { keep: process.env[COVERAGE_REPORT], chosen, mode: options.tests })];
const check = new Check([...(options.before ? before : []), ...tests], (line) => process.stdout.write(`${line}\n`));
process.exitCode = await check.run();

/** Finds the packages the check tests: every one, those named, or those a change touches, each with its dependents. */
async function choice(asked: PackageChoice): Promise<ReadonlySet<string> | undefined> {
  if (asked.kind === "all") return undefined;
  if (asked.kind === "affected") {
    const touched = await touchedPackages(root, packages, asked.since);
    process.stdout.write(`${touchedLine(asked.since, touched)}\n`);
    return touched;
  }
  const named = await namedPackages(root, packages, asked.names);
  if ("chosen" in named) return named.chosen;
  process.stderr.write(`check: no package is named ${named.unknown.join(", ")}. Name each by its name or its folder, such as packages/agents.\n`);
  process.exit(2);
}
