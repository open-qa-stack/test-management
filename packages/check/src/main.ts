import { Check } from "./check.ts";
import { CoverageDirectiveStep } from "./coverage-directive-step.ts";
import { namedPackages, touchedLine, touchedPackages } from "./package-choice.ts";
import { ScriptStep } from "./script-step.ts";
import { SecretsStep } from "./secrets-step.ts";
import { COVERAGE_REPORT, TestStep } from "./test-step.ts";
import { workspacePackages } from "./workspace-package.ts";

const root = process.cwd();
const packages = await workspacePackages(root);
const chosen = await choice(process.argv.slice(2));
const check = new Check(
  [
    new ScriptStep("typecheck", root, "typecheck"),
    new ScriptStep("lint", root, "lint"),
    new ScriptStep("format", root, "format:check"),
    new ScriptStep("build", root, "build"),
    new CoverageDirectiveStep(root, packages),
    new SecretsStep(root),
    new TestStep(root, packages, (output) => process.stdout.write(output), process.env[COVERAGE_REPORT], chosen),
  ],
  (line) => process.stdout.write(`${line}\n`),
);
process.exitCode = await check.run();

/**
 * Reads which packages the check tests: those `--packages` names, by name or folder, separated by commas; those a change
 * touches since the revision `--affected` names; every package without either.
 */
async function choice(args: readonly string[]): Promise<ReadonlySet<string> | undefined> {
  const [option, value] = args;
  if (option === undefined) return undefined;
  if (option === "--affected" && value !== undefined) {
    const touched = await touchedPackages(root, packages, value);
    process.stdout.write(`${touchedLine(value, touched)}\n`);
    return touched;
  }
  if (option === "--packages" && value !== undefined) {
    const named = await namedPackages(root, packages, value);
    if ("chosen" in named) return named.chosen;
    process.stderr.write(`check: no package is named ${named.unknown.join(", ")}. Name each by its name or its folder, such as packages/agents.\n`);
    process.exit(2);
  }
  process.stderr.write("check: give --packages <names or folders, separated by commas> or --affected <revision>, or nothing to test every package.\n");
  process.exit(2);
}
