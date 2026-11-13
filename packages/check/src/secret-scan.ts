import type { GitRepository } from "./git-repository.ts";
import { SECRET_RULES } from "./secret-rules.ts";

/** Finds secrets in a repository. A finding names the file and the rule, never the secret. */
export class SecretScan {
  private readonly repository: GitRepository;

  /** @param repository - The repository to scan. */
  public constructor(repository: GitRepository) {
    this.repository = repository;
  }

  /** @returns A finding for each rule matched by each file of the index, its text files only. */
  public async inIndex(): Promise<string[]> {
    const findings: string[] = [];
    for (const rule of SECRET_RULES) {
      const paths = await this.repository.read(["grep", "--cached", "-I", "-l", "-z", "-E", "-e", rule.pattern, "--"], [0, 1]);
      for (const path of paths.split("\0").filter((path) => path !== "")) findings.push(`${path}: secret found by the rule "${rule.name}"`);
    }
    return findings;
  }

  /**
   * @param revisions - The arguments of `git log` that select the commits.
   * @returns A finding for each rule matched by the lines each commit adds to each file. The lines a merge adds
   * are those its author wrote, in resolving a conflict or not, on top of what git would have merged by itself.
   */
  public async inCommits(revisions: readonly string[]): Promise<string[]> {
    const rules = SECRET_RULES.map(({ name, pattern }) => ({ name, pattern: new RegExp(pattern) }));
    const log = await this.repository.read([
      "log",
      "-p",
      "--diff-merges=remerge",
      "--no-color",
      "--no-ext-diff",
      "--no-renames",
      "--format=%x00%H",
      ...revisions,
    ]);
    const findings = new Set<string>();
    let commit = "";
    let file = "";
    let inHunk = false;
    for (const line of log.split("\n")) {
      if (line.startsWith("\0")) [commit, file, inHunk] = [line.slice(1), "", false];
      else if (line.startsWith("diff --git ")) [file, inHunk] = ["", false];
      else if (!inHunk && line.startsWith("+++ ")) file = line.slice(4).replace(/^b\//, "");
      else if (line.startsWith("@@ ")) inHunk = true;
      else if (inHunk && line.startsWith("+")) {
        for (const rule of rules) if (rule.pattern.test(line)) findings.add(`commit ${commit}: ${file}: secret found by the rule "${rule.name}"`);
      }
    }
    return [...findings];
  }
}
