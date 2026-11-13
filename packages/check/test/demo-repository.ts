import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** An environment in which git reads no configuration of the machine and commits under a demonstration identity. */
const ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Demo Maintainer",
  GIT_AUTHOR_EMAIL: "maintainer@example.com",
  GIT_COMMITTER_NAME: "Demo Maintainer",
  GIT_COMMITTER_EMAIL: "maintainer@example.com",
};

/** A git repository in a temporary folder, with a first commit on `main`. */
export class DemoRepository {
  /** Its folder. */
  public readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  /** @returns A new repository, whose first commit adds a readme. */
  public static async create(): Promise<DemoRepository> {
    const repository = new DemoRepository(await mkdtemp(join(tmpdir(), "scan-demo-")));
    repository.git("init", "-q", "-b", "main");
    await repository.commit({ "README.md": "# Demo\n" }, "docs: add a readme");
    return repository;
  }

  /**
   * Runs git in the repository.
   *
   * @param args - The arguments of git.
   * @returns Its standard output, trimmed.
   */
  public git(...args: string[]): string {
    return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: this.root, env: ENV, encoding: "utf8" }).trim();
  }

  /**
   * Writes files and adds them to the index.
   *
   * @param files - The text of each file, by its path from the root.
   */
  public async stage(files: Readonly<Record<string, string>>): Promise<void> {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(this.root, path)), { recursive: true });
      await writeFile(join(this.root, path), text);
      this.git("add", "--", path);
    }
  }

  /**
   * Writes files and commits them.
   *
   * @param files - The text of each file, by its path from the root.
   * @param message - The message of the commit.
   * @returns The hash of the commit.
   */
  public async commit(files: Readonly<Record<string, string>>, message: string): Promise<string> {
    await this.stage(files);
    this.git("commit", "-q", "--allow-empty", "-m", message);
    return this.git("rev-parse", "HEAD");
  }

  /** Removes the repository. */
  public async remove(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }
}

/**
 * Hands a new demonstration repository to a case, and removes it afterwards.
 *
 * @param use - The case.
 * @returns What the case returns.
 */
export async function inRepository<T>(use: (repository: DemoRepository) => Promise<T>): Promise<T> {
  const repository = await DemoRepository.create();
  try {
    return await use(repository);
  } finally {
    await repository.remove();
  }
}
