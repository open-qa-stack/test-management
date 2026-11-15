import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type { Step } from "./step.ts";
import type { WorkspacePackage } from "./workspace-package.ts";

/** A directive that leaves code out of the coverage of a test runner: that of Node.js, or the V8 and Istanbul ones Vitest reads. */
const DIRECTIVE = /(?:node:coverage\s+(?:ignore|disable)|\b(?:v8|c8|istanbul)\s+ignore)\b/;

/** The URL of an issue of the public repository, which a directive must give on its line or the line before. */
const ISSUE = /https:\/\/github\.com\/open-qa-stack\/test-management\/issues\/\d+/;

/** Refuses a coverage directive in a source file that gives no issue explaining it. */
export class CoverageDirectiveStep implements Step {
  public readonly name = "coverage directives";
  private readonly root: string;
  private readonly packages: readonly WorkspacePackage[];

  /**
   * @param root - The root of the workspace, which the findings name files from.
   * @param packages - The packages of the workspace.
   */
  public constructor(root: string, packages: readonly WorkspacePackage[]) {
    this.root = root;
    this.packages = packages;
  }

  public async run(): Promise<readonly string[]> {
    const findings: string[] = [];
    for (const file of this.packages.flatMap((workspacePackage) => workspacePackage.sources)) {
      const lines = (await readFile(file, "utf8")).split("\n");
      lines.forEach((line, index) => {
        if (DIRECTIVE.test(line) && !ISSUE.test(line) && !(index > 0 && ISSUE.test(lines[index - 1]!))) {
          findings.push(`${relative(this.root, file)}:${index + 1}: coverage directive without the URL of an issue of open-qa-stack/test-management`);
        }
      });
    }
    return findings;
  }
}
