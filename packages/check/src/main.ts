import { Check } from "./check.ts";
import { CoverageDirectiveStep } from "./coverage-directive-step.ts";
import { ScriptStep } from "./script-step.ts";
import { SecretsStep } from "./secrets-step.ts";
import { COVERAGE_REPORT, TestStep } from "./test-step.ts";
import { workspacePackages } from "./workspace-package.ts";

const root = process.cwd();
const packages = await workspacePackages(root);
const check = new Check(
  [
    new ScriptStep("typecheck", root, "typecheck"),
    new ScriptStep("lint", root, "lint"),
    new ScriptStep("format", root, "format:check"),
    new ScriptStep("build", root, "build"),
    new CoverageDirectiveStep(root, packages),
    new SecretsStep(root),
    new TestStep(root, packages, (output) => process.stdout.write(output), process.env[COVERAGE_REPORT]),
  ],
  (line) => process.stdout.write(`${line}\n`),
);
process.exitCode = await check.run();
