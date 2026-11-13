import { CommitMessageScan } from "./commit-message-scan.ts";
import type { GitRepository } from "./git-repository.ts";
import { SecretScan } from "./secret-scan.ts";

/** How to call the scan. */
const USAGE = "usage: pnpm scan [--all | <revision range>...]";

/**
 * The scan of a repository before its commits are published: secrets in the files of the index and, for the
 * commits it is given, their messages and the lines they add.
 */
export class ScanCommand {
  private readonly repository: GitRepository;
  private readonly write: (line: string) => void;

  /**
   * @param repository - The repository to scan.
   * @param write - Writes a line of the scan to its output.
   */
  public constructor(repository: GitRepository, write: (line: string) => void) {
    this.repository = repository;
    this.write = write;
  }

  /**
   * @param args - Nothing to scan the index only, `--all` to add every commit of every branch and tag, or revision
   * ranges as `git log` reads them, such as `main..HEAD`.
   * @returns `0` when nothing was found, `1` when something was, `2` when the arguments or a revision are wrong.
   */
  public async run(args: readonly string[]): Promise<number> {
    const revisions = selection(args);
    if (revisions === undefined) {
      this.write(USAGE);
      return 2;
    }
    let findings: string[];
    try {
      findings = await this.findings(revisions);
    } catch (error) {
      this.write(`scan: ${(error as Error).message.trim()}`);
      return 2;
    }
    for (const finding of findings) this.write(finding);
    this.write(findings.length === 0 ? "scan: nothing found" : `scan: ${findings.length} finding(s)`);
    return findings.length === 0 ? 0 : 1;
  }

  private async findings(revisions: readonly string[]): Promise<string[]> {
    const secrets = new SecretScan(this.repository);
    const inIndex = await secrets.inIndex();
    if (revisions.length === 0) return inIndex;
    return [...inIndex, ...(await new CommitMessageScan(this.repository).inCommits(revisions)), ...(await secrets.inCommits(revisions))];
  }
}

/**
 * @param args - The arguments of the scan.
 * @returns The arguments of `git log` that select the commits to scan, none for the index only, or `undefined`
 * when the arguments are wrong.
 */
function selection(args: readonly string[]): readonly string[] | undefined {
  if (args.length === 0) return [];
  if (args.length === 1 && args[0] === "--all") return ["--branches", "--tags", "--"];
  if (args.some((arg) => arg.startsWith("-"))) return undefined;
  return ["--end-of-options", ...args, "--"];
}
