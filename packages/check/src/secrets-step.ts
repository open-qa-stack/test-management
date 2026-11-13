import { GitRepository } from "./git-repository.ts";
import { SecretScan } from "./secret-scan.ts";
import type { Step } from "./step.ts";

/** Refuses a file of the index that holds a secret. */
export class SecretsStep implements Step {
  public readonly name = "secrets";
  private readonly root: string;

  /** @param root - The root of the workspace, in a git repository. */
  public constructor(root: string) {
    this.root = root;
  }

  public async run(): Promise<readonly string[]> {
    return new SecretScan(new GitRepository(this.root)).inIndex();
  }
}
