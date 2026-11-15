import { execFileSync, spawn } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The root of the workspace these tests run in. */
const REPOSITORY = fileURLToPath(new URL("../../../", import.meta.url));

/** The entry point of the check. */
const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));

/** The files of the root of the workspace that set how the check verifies a package. */
const SETTINGS = ["package.json", "pnpm-workspace.yaml", "tsconfig.base.json", ".oxlintrc.json", ".prettierrc.json", ".prettierignore", ".gitignore"];

/** The lint rules of the workspace, which its lint configuration loads and its root scripts check. */
const LINT_RULES = "lint";

/** The files of a demonstration package that passes every step, a file that only declares types included. */
const DEMO: Readonly<Record<string, string>> = {
  "packages/demo/package.json": JSON.stringify({
    name: "demo",
    private: true,
    type: "module",
    scripts: { typecheck: "tsc -p tsconfig.json", test: "node --test --experimental-test-coverage 'test/**/*.test.ts'" },
  }),
  "packages/demo/tsconfig.json": JSON.stringify({ extends: "../../tsconfig.base.json", include: ["src", "test"] }),
  "packages/demo/src/sign.ts": [
    "/** @returns The sign of a number. */",
    "export function sign(value: number): string {",
    '  return value < 0 ? "negative" : "positive";',
    "}",
    "",
  ].join("\n"),
  "packages/demo/src/shapes/shape.ts": ["/** A shape. */", "export interface Shape {", "  readonly sides: number;", "}", ""].join("\n"),
  "packages/demo/test/sign.test.ts": [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { sign } from "../src/sign.ts";',
    "",
    'test("names the sign of a number", () => {',
    '  assert.equal(sign(-1), "negative");',
    '  assert.equal(sign(1), "positive");',
    "});",
    "",
  ].join("\n"),
  "packages/empty/package.json": JSON.stringify({ name: "empty", private: true }),
};

/** What a run of the check gave. */
export interface CheckRun {
  readonly code: number | null;
  /** Its output and its error output, one after the other. */
  readonly output: string;
}

/**
 * A git repository in a temporary folder, outside the packages of the product, with the settings of this
 * workspace, its lint rules and its installed tools, a demonstration package and a package without sources.
 */
export class DemoWorkspace {
  /** Its folder. */
  public readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  /** @returns A new workspace, on which every step of the check passes. */
  public static async create(): Promise<DemoWorkspace> {
    const workspace = new DemoWorkspace(await mkdtemp(join(tmpdir(), "check-demo-")));
    await Promise.all(SETTINGS.map((file) => copyFile(join(REPOSITORY, file), join(workspace.root, file))));
    await cp(join(REPOSITORY, LINT_RULES), join(workspace.root, LINT_RULES), { recursive: true });
    await symlink(join(REPOSITORY, "node_modules"), join(workspace.root, "node_modules"));
    for (const [path, text] of Object.entries(DEMO)) await workspace.write(path, text);
    execFileSync("git", ["init", "-q"], { cwd: workspace.root });
    return workspace;
  }

  /**
   * Writes a file of the workspace, and the folders it is in.
   *
   * @param path - The path of the file from the root.
   * @param text - Its text.
   */
  public async write(path: string, text: string): Promise<void> {
    await mkdir(dirname(join(this.root, path)), { recursive: true });
    await writeFile(join(this.root, path), text);
  }

  /**
   * @param path - The path of a file from the root.
   * @returns Its text.
   */
  public async read(path: string): Promise<string> {
    return readFile(join(this.root, path), "utf8");
  }

  /**
   * Runs the check at the root of the workspace, as a command started outside of any test, so that the test
   * runner it starts runs the tests of the workspace.
   *
   * @returns What the check gave.
   */
  public async check(): Promise<CheckRun> {
    const env = { ...process.env };
    delete env["NODE_TEST_CONTEXT"];
    delete env["NODE_OPTIONS"];
    // A runner of continuous integration asks the tools for colours; the tests read plain text.
    delete env["FORCE_COLOR"];
    env["NO_COLOR"] = "1";
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", MAIN], { cwd: this.root, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    return { code, output: stdout + stderr };
  }

  /** Removes the workspace. */
  public async remove(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }
}
