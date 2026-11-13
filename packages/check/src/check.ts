import type { Step } from "./step.ts";

/** Runs the steps of the check in order, and stops at the first that fails. */
export class Check {
  private readonly steps: readonly Step[];
  private readonly write: (line: string) => void;

  /**
   * @param steps - The steps, in the order they run.
   * @param write - Writes a line of the check to its output.
   */
  public constructor(steps: readonly Step[], write: (line: string) => void) {
    this.steps = steps;
    this.write = write;
  }

  /** @returns `0` when every step passed, `1` otherwise, a step that throws included. */
  public async run(): Promise<number> {
    for (const step of this.steps) {
      this.write(`check: ${step.name}`);
      const findings = await step.run().catch((error: unknown) => [`${step.name} could not run: ${String(error)}`]);
      if (findings.length > 0) {
        for (const finding of findings) this.write(finding);
        this.write(`check: failed at the step "${step.name}"`);
        return 1;
      }
    }
    this.write("check: every step passed");
    return 0;
  }
}
