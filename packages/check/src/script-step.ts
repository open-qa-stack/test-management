import { spawn } from "node:child_process";
import { once } from "node:events";
import type { Step } from "./step.ts";

/**
 * Runs a script of a manifest of the workspace, its output going to the outputs of the check.
 *
 * @remarks The script shows its output even when the check was started by a silent pnpm (`pnpm -s check`),
 * so that a failing step is always explained.
 */
export class ScriptStep implements Step {
  public readonly name: string;
  private readonly root: string;
  private readonly script: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly write: ((output: string) => void) | undefined;

  /**
   * @param name - The name of the step.
   * @param root - The folder of the manifest.
   * @param script - The script of the manifest.
   * @param env - The environment of the script.
   * @param write - Writes the whole output of the script, its error output included, once the script has ended, so
   * that scripts running at the same time do not mix their lines; without it, the script writes as it runs.
   */
  public constructor(name: string, root: string, script: string, env: NodeJS.ProcessEnv = process.env, write?: (output: string) => void) {
    this.name = name;
    this.root = root;
    this.script = script;
    this.env = env;
    this.write = write;
  }

  public async run(): Promise<readonly string[]> {
    const env = { ...this.env };
    delete env["npm_config_reporter"];
    const child = spawn("pnpm", ["run", this.script], { cwd: this.root, env, stdio: this.write === undefined ? "inherit" : ["inherit", "pipe", "pipe"] });
    const output: Buffer[] = [];
    for (const stream of [child.stdout, child.stderr]) stream?.on("data", (chunk: Buffer) => output.push(chunk));
    const [code] = (await once(child, "close")) as [number | null];
    this.write?.(Buffer.concat(output).toString());
    return code === 0 ? [] : [`pnpm run ${this.script} exited with code ${code}`];
  }
}
