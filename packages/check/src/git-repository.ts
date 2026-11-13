import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** The most git may write, enough for the whole history of a repository. */
const MAX_BUFFER = 1024 ** 3;

/**
 * Settings that keep the output of git the same on every machine, whatever the configuration of its user: paths
 * as they are, diffs with their `a/` and `b/` prefixes, no signature in the log.
 */
const STABLE_OUTPUT = ["-c", "core.quotePath=false", "-c", "diff.noprefix=false", "-c", "diff.mnemonicPrefix=false", "-c", "log.showSignature=false"];

/** A git repository, read by its commands. */
export class GitRepository {
  private readonly root: string;

  /** @param root - A folder of the repository, where its commands run. */
  public constructor(root: string) {
    this.root = root;
  }

  /**
   * Runs a git command that reads the repository.
   *
   * @param args - The arguments of git.
   * @param accepted - The exit codes that mean success, such as `1` for a search that found nothing.
   * @returns Its standard output.
   * @throws When git exits with any other code.
   */
  public async read(args: readonly string[], accepted: readonly number[] = [0]): Promise<string> {
    try {
      const { stdout } = await promisify(execFile)("git", [...STABLE_OUTPUT, ...args], { cwd: this.root, encoding: "utf8", maxBuffer: MAX_BUFFER });
      return stdout;
    } catch (error) {
      const { code, stdout } = error as { code: unknown; stdout: string };
      if (typeof code === "number" && accepted.includes(code)) return stdout;
      throw error;
    }
  }
}
