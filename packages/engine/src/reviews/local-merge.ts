import { execFile } from "node:child_process";
import { BRANCH_PREFIX } from "@open-qa-stack/agents";
import { ReviewRefusedError } from "@open-qa-stack/domain";

/** What git answered: what it wrote out, or why it failed. */
type GitOutcome = { readonly ok: true; readonly out: string } | { readonly ok: false; readonly error: string };

/** The branch tests are kept on by default, when the person works on none of their own. */
const DEFAULT_BRANCH = "main";

/**
 * What takes a test a design wrote into the working branch of the test repository, in its own checkout, without
 * pushing anything: the files of the test are taken from the branch of its design, then committed.
 *
 * @remarks
 * The working branch is the one checked out, unless a design branch is: then it is the branch the person works on
 * that holds the revision the design started from — `main` when several do. The checkout is left on it.
 */
export class LocalMerge {
  readonly #repository: string;

  /** @param repository - Absolute path of the test repository. */
  constructor(repository: string) {
    this.#repository = repository;
  }

  /**
   * Takes the files a design wrote for a test into the working branch, and commits them there.
   *
   * @param design - The branch of the design, and the revision it started from.
   * @param files - The files of the test: those its design wrote, and those it removed, which are removed too.
   * @param reserved - The folders and files the harness writes itself, which a change may stand in.
   * @param message - The message of the commit.
   * @returns The working branch, and whether a commit was made: none when it had the files already.
   * @throws ReviewRefusedError when a tracked file is changed, when no working branch can be told, or when git cannot commit.
   */
  async take(
    design: { readonly branch: string; readonly base: string },
    files: readonly string[],
    reserved: readonly string[],
    message: string,
  ): Promise<{ readonly branch: string; readonly committed: boolean }> {
    const changed = (await this.#expect("status", "--porcelain", "--untracked-files=no"))
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => line.slice(3))
      .filter((path) => !reserved.some((kept) => path === kept || path.startsWith(kept)));
    if (changed.length > 0)
      throw new ReviewRefusedError(`Tracked files are changed: ${changed.join(", ")}. Commit them or put them aside, then validate again.`);
    const branch = await this.#working(design.base);
    const current = await this.#git("symbolic-ref", "--quiet", "--short", "HEAD");
    if (!current.ok || current.out.trim() !== branch) await this.#expect("switch", "--quiet", branch);
    for (const file of files) {
      const there = await this.#git("cat-file", "-e", `${design.branch}:${file}`);
      if (there.ok) await this.#expect("checkout", design.branch, "--", file);
      else await this.#expect("rm", "--quiet", "--ignore-unmatch", "--", file);
    }
    const staged = await this.#expect("diff", "--cached", "--name-only", "--", ...files);
    if (staged.trim() === "") return { branch, committed: false };
    await this.#expect("commit", "--quiet", "--message", message, "--", ...files);
    return { branch, committed: true };
  }

  /** The working branch of a design that started from a revision. */
  async #working(base: string): Promise<string> {
    const current = await this.#git("symbolic-ref", "--quiet", "--short", "HEAD");
    if (current.ok && !current.out.trim().startsWith(BRANCH_PREFIX)) return current.out.trim();
    const holding = (await this.#expect("for-each-ref", "--format=%(refname:short)", "--contains", base, "refs/heads/"))
      .split("\n")
      .filter((name) => name !== "" && !name.startsWith(BRANCH_PREFIX));
    if (holding.includes(DEFAULT_BRANCH)) return DEFAULT_BRANCH;
    if (holding.length === 1) return holding[0]!;
    throw new ReviewRefusedError(
      holding.length === 0
        ? "No branch of yours holds the revision the design started from: check out the branch to keep the test on, then validate again."
        : `Several branches of yours hold the revision the design started from (${holding.join(", ")}): check out the one to keep the test on, then validate again.`,
    );
  }

  /** What git writes out; refused with what git said when it fails. */
  async #expect(...args: string[]): Promise<string> {
    const outcome = await this.#git(...args);
    if (!outcome.ok) throw new ReviewRefusedError(`git ${args[0]} failed: ${outcome.error}`);
    return outcome.out;
  }

  /** What git answers in the test repository. */
  #git(...args: string[]): Promise<GitOutcome> {
    return new Promise((resolve) =>
      execFile("git", args, { cwd: this.#repository }, (error, stdout, stderr) =>
        resolve(error === null ? { ok: true, out: stdout } : { ok: false, error: (stderr.trim() || error.message).split("\n")[0]! }),
      ),
    );
  }
}
