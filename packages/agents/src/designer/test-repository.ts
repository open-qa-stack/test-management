import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { posix } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The git repository of the tests, as the designer uses it: it reads its state, creates a branch and
 * commits on it.
 *
 * @remarks
 * No command contacts a remote, changes the git configuration or changes an existing branch. Commits use
 * the identity the repository configures, and its hooks.
 */
export class TestRepository {
  private readonly root: string;

  /** @param root - Absolute path of the test repository. */
  public constructor(root: string) {
    this.root = root;
  }

  /**
   * Tells what keeps a branch from being created for new tests: a folder that is not the root of a git
   * repository with a commit, a branch name that is not valid or already taken, a tracked file changed, or
   * an untracked file outside the reserved folders.
   *
   * @param branch - Name of the branch to create.
   * @param reserved - Folders, relative to the root, where untracked files are expected.
   * @returns A sentence for each problem; none when the branch can be created.
   */
  public async problems(branch: string, reserved: readonly string[]): Promise<string[]> {
    const top = await this.git("rev-parse", "--show-toplevel", "--verify", "HEAD").then((out) => out.split("\n")[0]!, () => undefined);
    if (top === undefined || (await realpath(top)) !== (await realpath(this.root))) return [`${this.root} is not the root of a git repository with a commit.`];
    const problems: string[] = [];
    if (!(await this.succeeds("check-ref-format", "--branch", branch))) problems.push(`${branch} is not a valid branch name.`);
    else if (await this.succeeds("show-ref", "--verify", "--quiet", `refs/heads/${branch}`)) problems.push(`The branch ${branch} already exists.`);
    const changed = (await this.git("status", "--porcelain", "--untracked-files=no")).split("\n").filter((line) => line !== "");
    if (changed.length > 0) problems.push(`Tracked files are changed: ${changed.map((line) => line.slice(3)).join(", ")}.`);
    const folders = reserved.map((folder) => `${posix.normalize(folder).replace(/\/+$/, "")}/`);
    const untracked = (await this.git("ls-files", "--others", "--exclude-standard", "-z")).split("\0").filter((path) => path !== "" && !folders.some((folder) => path.startsWith(folder)));
    if (untracked.length > 0) problems.push(`Untracked files are outside the folders of the state and the index: ${untracked.join(", ")}.`);
    return problems;
  }

  /**
   * The revision checked out.
   *
   * @returns Its commit.
   */
  public async head(): Promise<string> {
    return (await this.git("rev-parse", "HEAD")).trim();
  }

  /**
   * Creates a branch from the revision checked out, and checks it out.
   *
   * @param branch - Its name.
   * @throws Error when git refuses it.
   */
  public async createBranch(branch: string): Promise<void> {
    await this.git("switch", "--quiet", "--create", branch);
  }

  /**
   * Commits files on the branch checked out; those git ignores are left out.
   *
   * @param paths - The files, relative to the root.
   * @param message - The commit message.
   * @returns The files committed.
   * @throws Error when git refuses the commit, for want of an identity or by a hook.
   */
  public async commit(paths: readonly string[], message: string): Promise<string[]> {
    const ignored = new Set((await this.git("check-ignore", "--no-index", "--", ...paths).catch(() => "")).split("\n"));
    const kept = paths.filter((path) => !ignored.has(path));
    await this.git("add", "--", ...kept);
    await this.git("commit", "--quiet", "--message", message, "--", ...kept);
    return kept;
  }

  /**
   * The branch checked out.
   *
   * @returns Its name.
   */
  public async branch(): Promise<string> {
    return (await this.git("branch", "--show-current")).trim();
  }

  private async git(...args: string[]): Promise<string> {
    return (await run("git", args, { cwd: this.root, encoding: "utf8" })).stdout;
  }

  private succeeds(...args: string[]): Promise<boolean> {
    return this.git(...args).then(
      () => true,
      () => false,
    );
  }
}
