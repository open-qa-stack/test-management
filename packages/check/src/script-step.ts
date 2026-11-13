import { spawn } from "node:child_process";
import { once } from "node:events";
import type { Step } from "./step.ts";

/**
 * Runs a script of the root manifest of the workspace, its output going to the outputs of the check.
 *
 * @remarks The script shows its output even when the check was started by a silent pnpm (`pnpm -s check`),
 * so that a failing step is always explained.
 */
export class ScriptStep implements Step {
  public readonly name: string;
  private readonly root: string;
  private readonly script: string;
  private readonly env: NodeJS.ProcessEnv;

  /**
   * @param name - The name of the step.
   * @param root - The root of the workspace.
   * @param script - The script of the root manifest.
   * @param env - The environment of the script.
   */
  public constructor(name: string, root: string, script: string, env: NodeJS.ProcessEnv = process.env) {
    this.name = name;
    this.root = root;
    this.script = script;
    this.env = env;
  }

  public async run(): Promise<readonly string[]> {
    const env = { ...this.env };
    delete env["npm_config_reporter"];
    const child = spawn("pnpm", ["run", this.script], { cwd: this.root, env, stdio: "inherit" });
    const [code] = (await once(child, "close")) as [number | null];
    return code === 0 ? [] : [`pnpm run ${this.script} exited with code ${code}`];
  }
}
