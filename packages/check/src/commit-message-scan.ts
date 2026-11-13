import type { GitRepository } from "./git-repository.ts";

/** A subject that follows Conventional Commits, with an optional scope between parentheses. */
const CONVENTIONAL_SUBJECT = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9._/-]+\))?!?: \S/;

/** The longest subject, in bytes, which every tool counts the same way. */
const MAX_SUBJECT = 72;

/** A trailer that credits a commit to someone or something other than its author. */
const ATTRIBUTION_TRAILER = /^(co-authored-by|generated-by):/i;

/**
 * @param message - The message of a commit.
 * @returns What is wrong with it, one line each: a subject that does not follow Conventional Commits or is too
 * long, and each attribution trailer.
 */
export function commitMessageFindings(message: string): string[] {
  const lines = message.split("\n");
  const subject = lines[0]!;
  const findings: string[] = [];
  if (!CONVENTIONAL_SUBJECT.test(subject)) findings.push(`subject does not follow Conventional Commits: ${subject}`);
  if (Buffer.byteLength(subject) > MAX_SUBJECT) findings.push(`subject longer than ${MAX_SUBJECT} bytes`);
  for (const line of lines) {
    const trailer = ATTRIBUTION_TRAILER.exec(line);
    if (trailer) findings.push(`attribution trailer "${trailer[1]}"`);
  }
  return findings;
}

/** Finds the commit messages that cannot be published. */
export class CommitMessageScan {
  private readonly repository: GitRepository;

  /** @param repository - The repository to scan. */
  public constructor(repository: GitRepository) {
    this.repository = repository;
  }

  /**
   * @param revisions - The arguments of `git log` that select the commits.
   * @returns What is wrong with the message of each commit, each finding naming the commit.
   */
  public async inCommits(revisions: readonly string[]): Promise<string[]> {
    const log = await this.repository.read(["log", "-z", "--format=%H%n%B", ...revisions]);
    return log
      .split("\0")
      .filter((record) => record !== "")
      .flatMap((record) => {
        const [commit, ...message] = record.split("\n");
        return commitMessageFindings(message.join("\n")).map((finding) => `commit ${commit}: ${finding}`);
      });
  }
}
