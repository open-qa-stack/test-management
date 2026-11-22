import { execFile } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { posix } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The git repository of the tests, as the designer uses it: it reads its state, creates a branch or checks
 * out one that exists, and commits on it.
 *
 * @remarks
 * No command contacts a remote, changes the git configuration or changes an existing branch but by a commit
 * on it. Commits use the identity the repository configures, and its hooks.
 */
export class TestRepository {
  private readonly root: string;

  /** @param root - Absolute path of the test repository. */
  public constructor(root: string) {
    this.root = root;
  }

  /**
   * Tells what keeps new tests from being committed on a branch: a folder that is not the root of a git
   * repository with a commit, a branch name that is not valid, a branch to create that is already taken or one
   * to go on with that does not exist, a tracked file changed, or an untracked file outside the reserved paths.
   *
   * @param branch - Name of the branch.
   * @param reserved - Folders and files, relative to the root, that the harness writes: what it changes or adds there is expected.
   * @param existing - Whether the branch is one to go on with, which must exist; one to create, which must not, by default.
   * @returns A sentence for each problem; none when the tests can be committed on the branch.
   */
  public async problems(branch: string, reserved: readonly string[], existing = false): Promise<string[]> {
    const top = await this.git("rev-parse", "--show-toplevel", "--verify", "HEAD").then(
      (out) => out.split("\n")[0]!,
      () => undefined,
    );
    if (top === undefined || (await realpath(top)) !== (await realpath(this.root))) return [`${this.root} is not the root of a git repository with a commit.`];
    const problems: string[] = [];
    if (!(await this.succeeds("check-ref-format", "--branch", branch))) problems.push(`${branch} is not a valid branch name.`);
    else if ((await this.hasBranch(branch)) !== existing)
      problems.push(existing ? `The branch ${branch} does not exist: there is nothing to go on with.` : `The branch ${branch} already exists.`);
    const paths = reserved.map((path) => posix.normalize(path).replace(/(?<!\/)\/+$/, ""));
    const reservedPath = (path: string): boolean => paths.some((kept) => path === kept || path.startsWith(`${kept}/`));
    // The harness writes the state, the index and the configuration file itself: a change there is its own, not the developer's.
    const changed = (await this.git("status", "--porcelain", "--untracked-files=no"))
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => line.slice(3))
      .filter((path) => !reservedPath(path));
    if (changed.length > 0) problems.push(`Tracked files are changed: ${changed.join(", ")}.`);
    const untracked = (await this.git("ls-files", "--others", "--exclude-standard", "-z")).split("\0").filter((path) => path !== "" && !reservedPath(path));
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
   * Whether a branch exists.
   *
   * @param branch - Its name.
   * @returns `true` when it does.
   */
  public hasBranch(branch: string): Promise<boolean> {
    return this.succeeds("show-ref", "--verify", "--quiet", `refs/heads/${branch}`);
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
   * Checks out a branch that exists.
   *
   * @param branch - Its name.
   * @throws Error when git refuses it.
   */
  public async switchTo(branch: string): Promise<void> {
    await this.git("switch", "--quiet", branch);
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
   * Tells what keeps one file from being committed alone on the branch checked out, as a person changes it from the
   * console: a folder that is not the root of a git repository with a commit, no branch checked out, a merge, a rebase,
   * a cherry-pick or a revert under way, or changes of the file not committed.
   *
   * @param path - The file, relative to the root.
   * @returns What to do first, in a sentence; `undefined` when the file can be committed alone.
   */
  public async fileProblem(path: string): Promise<string | undefined> {
    const top = await this.git("rev-parse", "--show-toplevel", "--verify", "HEAD").then(
      (out) => out.split("\n")[0]!,
      () => undefined,
    );
    if (top === undefined || (await realpath(top)) !== (await realpath(this.root)))
      return `${this.root} is not the root of a git repository with a commit: make it one first.`;
    if ((await this.branch()) === "") return "No branch is checked out: check one out first.";
    for (const operation of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]) {
      const marker = (await this.git("rev-parse", "--path-format=absolute", "--git-path", operation)).trim();
      if (
        await access(marker).then(
          () => true,
          () => false,
        )
      )
        return "A merge, a rebase, a cherry-pick or a revert is under way in the test repository: end it or abort it first.";
    }
    if ((await this.git("status", "--porcelain", "--untracked-files=all", "--", path)) !== "")
      return `${path} has changes that are not committed: commit them or drop them first.`;
    return undefined;
  }

  /**
   * Commits one file alone on the branch checked out: whatever else is changed or staged stays as it is. A commit git
   * refuses leaves the index of the file as it was.
   *
   * @param path - The file, relative to the root.
   * @param message - The commit message.
   * @throws Error when git refuses the commit, for want of an identity or by a hook.
   */
  public async commitFile(path: string, message: string): Promise<void> {
    await this.git("add", "--", path);
    try {
      await this.git("commit", "--quiet", "--only", "--message", message, "--", path);
    } catch (error) {
      await this.git("reset", "--quiet", "--", path);
      throw error;
    }
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
