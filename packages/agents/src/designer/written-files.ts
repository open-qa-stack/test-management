import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * The files a design writes in the test repository beside its tests, before it commits them: each is kept as
 * it was, so that a design that commits nothing leaves the repository as it found it.
 */
export class WrittenFiles {
  readonly #root: string;
  /** What each file written held before, by its path; `undefined` for a file that was not there. */
  readonly #before = new Map<string, string | undefined>();

  /** @param root - Absolute path of the test repository. */
  public constructor(root: string) {
    this.#root = root;
  }

  /** The paths of the files written, relative to the root of the repository. */
  public get paths(): string[] {
    return [...this.#before.keys()];
  }

  /**
   * Writes a file, unless it already holds that text.
   *
   * @param path - Its path, relative to the root of the repository.
   * @param content - Its text.
   */
  public async write(path: string, content: string): Promise<void> {
    const target = join(this.#root, path);
    const held = await readFile(target, "utf8").catch(() => undefined);
    if (held === content) return;
    if (!this.#before.has(path)) this.#before.set(path, held);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }

  /** Puts each file written back as it was: its text before, or nothing for a file that was not there. */
  public async revert(): Promise<void> {
    for (const [path, held] of this.#before) {
      if (held === undefined) await rm(join(this.#root, path), { force: true });
      else await writeFile(join(this.#root, path), held);
    }
    this.#before.clear();
  }
}
