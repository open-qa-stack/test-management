import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The root of the workspace these tests run in. */
export const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The linter of the workspace. */
const OXLINT = join(ROOT, "node_modules", ".bin", "oxlint");

/** The lint configuration of the workspace, as JSON reads it. */
export type LintConfiguration = Record<string, unknown> & { jsPlugins: string[] };

/** What a command gave. */
export interface CommandRun {
  readonly code: number;
  /** Its output and its error output, one after the other. */
  readonly output: string;
}

/**
 * A workspace in a temporary folder, outside the packages of the product, with the lint configuration of this
 * workspace, changed as a test needs, and the demonstration files the test writes.
 */
export class DemoWorkspace {
  /** The absolute path of its root. */
  readonly root = mkdtempSync(join(tmpdir(), "oqas-lint-"));

  /**
   * @param files - The text of each file, by its path from the root.
   * @param configure - Changes the lint configuration of this workspace before it is written.
   */
  constructor(files: Readonly<Record<string, string>>, configure: (configuration: LintConfiguration) => void = () => {}) {
    const configuration = JSON.parse(readFileSync(join(ROOT, ".oxlintrc.json"), "utf8")) as LintConfiguration;
    delete configuration["$schema"];
    configuration.jsPlugins = configuration.jsPlugins.map((path) => join(ROOT, path));
    configure(configuration);
    this.write({ ".oxlintrc.json": JSON.stringify(configuration), ...files });
  }

  /**
   * Writes files into the workspace.
   *
   * @param files - The text of each file, by its path from the root.
   */
  write(files: Readonly<Record<string, string>>): void {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(this.root, path)), { recursive: true });
      writeFileSync(join(this.root, path), content);
    }
  }

  /**
   * Lints the workspace with its configuration.
   *
   * @throws When the linter fails without a diagnostic, as when its configuration or a plugin does not load.
   * @returns Each diagnostic, one line each, which names the file, the line, the column, the message and the rule.
   */
  lint(): Promise<string[]> {
    return lint(this.root);
  }

  /** Removes the workspace. */
  remove(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

/**
 * Lints a workspace with its configuration.
 *
 * @param root - The absolute path of the root of the workspace.
 * @throws When the linter fails without a diagnostic, as when its configuration or a plugin does not load.
 * @returns Each diagnostic, one line each, which names the file, the line, the column, the message and the rule.
 */
export async function lint(root: string): Promise<string[]> {
  const { code, output } = await run(OXLINT, ["--format", "unix"], root);
  const diagnostics = output.split("\n").filter((line) => /^\S+:\d+:\d+: /.test(line));
  if (code !== 0 && diagnostics.length === 0) throw new Error(`oxlint failed without a diagnostic:\n${output}`);
  return diagnostics;
}

/** Runs a command in a folder, and gives its exit code and its outputs. */
function run(command: string, args: readonly string[], cwd: string): Promise<CommandRun> {
  return new Promise((resolve) =>
    execFile(command, args, { cwd, encoding: "utf8" }, (error, stdout, stderr) =>
      resolve({ code: typeof error?.code === "number" ? error.code : 0, output: stdout + stderr }),
    ),
  );
}
