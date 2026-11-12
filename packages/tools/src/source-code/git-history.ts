import { relative, sep } from "node:path";
import type { CodeFolder } from "./code-folder.ts";
import { runProcess, type ProcessResult } from "./process-run.ts";

/** Longest a git command may run, in milliseconds. */
export const GIT_TIMEOUT_MS = 10_000;
/** Most commits a log gives. */
export const MAX_LOG_COMMITS = 50;
/** Most lines a blame covers. */
export const MAX_BLAME_LINES = 200;

/** A commit, as a log shows it. */
export interface CommitSummary {
  /** Abbreviated hash. */
  readonly commit: string;
  /** Date of the commit, `YYYY-MM-DD`. */
  readonly date: string;
  /** Name of its author. */
  readonly author: string;
  /** First line of its message. */
  readonly subject: string;
}

/** A commit an agent may name: a hash of at least four characters, `HEAD`, or a few commits before it. */
const COMMIT = /^(?:[0-9a-f]{4,40}|HEAD(?:~\d{1,3})?)$/i;

/**
 * Settings that keep git from running other programs that the repository's configuration names: pager,
 * file system monitor, signature checker, hooks. External diffs and text conversions are turned off by the
 * options of each command, and the working tree is never read, so that no clean filter runs.
 */
const SAFE = ["-c", "core.pager=cat", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "log.showSignature=false", "-c", "diff.external=", "--no-pager"];
/** System and global settings ignored, no prompt, no lock, and every path taken literally, without pathspec magic. */
const SAFE_ENV = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_LITERAL_PATHSPECS: "1" };

/**
 * Reads the git history of a source code folder: the log, the blame of a few lines, one commit.
 *
 * @remarks
 * Only these three commands run, without a shell, in the folder, and git runs no other program the
 * repository's configuration names. Every path is checked to stay inside the folder, passed after `--` and
 * taken literally; a commit is a hash or `HEAD~n`, and must name a commit; the log, the blame and the
 * commit are limited to the folder, so that the rest of a larger repository stays out of reach.
 */
export class GitHistory {
  private readonly folder: CodeFolder;
  private readonly timeoutMs: number;

  /**
   * @param folder - The folder, inside a git repository.
   * @param timeoutMs - Longest one git command may run; `GIT_TIMEOUT_MS` by default.
   */
  public constructor(folder: CodeFolder, timeoutMs = GIT_TIMEOUT_MS) {
    this.folder = folder;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Lists the latest commits that touched the folder, or one of its files.
   *
   * @param path - A file or a subfolder, relative to the folder; the whole folder when absent.
   * @param limit - Most commits to return, already bounded.
   * @returns The commits, the latest first.
   * @throws Error when the path leads outside the folder, or git fails.
   */
  public async log(path: string | undefined, limit: number): Promise<CommitSummary[]> {
    const output = await this.git(["log", `--max-count=${limit}`, "--date=short", "--format=%h%x09%ad%x09%an%x09%s", "--", await this.pathspec(path)]);
    return output.split("\n").filter((line) => line !== "").map((line) => {
      const [commit, date, author, ...subject] = line.split("\t");
      return { commit: commit!, date: date!, author: author!, subject: subject.join("\t") };
    });
  }

  /**
   * Tells which commit last changed each of a few lines of a file, as committed at `HEAD`.
   *
   * @param path - The file, relative to the folder.
   * @param start - First line.
   * @param end - Last line; at most `MAX_BLAME_LINES` lines after `start`.
   * @returns The blame, as git prints it.
   * @throws Error when the path leads outside the folder, or git fails.
   */
  public async blame(path: string, start: number, end: number): Promise<string> {
    const last = Math.min(Math.max(end, start), start + MAX_BLAME_LINES - 1);
    return this.git(["blame", "--no-textconv", "--date=short", `-L${start},${last}`, "HEAD", "--", await this.pathspec(path)]);
  }

  /**
   * Shows one commit: its message, the files it changed in the folder, and their changes.
   *
   * @param commit - A hash, `HEAD` or `HEAD~n`.
   * @param path - Limits the changes shown to this file, relative to the folder; the folder when absent.
   * @returns The commit, as git prints it, cut when long.
   * @throws Error when the commit is not a hash or `HEAD~n`, the path leads outside the folder, or git fails.
   */
  public async show(commit: string, path: string | undefined): Promise<string> {
    if (!COMMIT.test(commit)) throw new Error(`${commit} is not a commit hash nor HEAD~n.`);
    return this.git(["show", "--no-textconv", "--no-ext-diff", "--stat", "--patch", "--date=short", `${commit}^{commit}`, "--", await this.pathspec(path)]);
  }

  private async pathspec(path: string | undefined): Promise<string> {
    const root = await this.folder.rootPath();
    if (path === undefined) return ".";
    const inside = relative(root, await this.folder.resolve(path));
    return inside === "" ? "." : inside.split(sep).join("/");
  }

  private async git(args: readonly string[]): Promise<string> {
    const result: ProcessResult = await runProcess("git", [...SAFE, ...args], await this.folder.rootPath(), this.timeoutMs, SAFE_ENV);
    if (result.exitCode !== 0 && !result.truncated) throw new Error(`git ${args[0]} failed: ${result.timedOut ? "it ran out of time" : result.stderr.trim().split("\n")[0]}`);
    return result.truncated ? `${result.stdout}\n[output cut]` : result.stdout;
  }
}
