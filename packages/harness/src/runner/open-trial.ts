import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** What a trial under way changed in the test repository, as its mark records it. */
interface Mark {
  /** The path of the test, relative to the root of the repository. */
  readonly path: string;
  /** What the file held before the trial, in base 64, for a test that repairs one; absent for a new file. */
  readonly kept?: string;
  /** Whether the folder of its visual references was there before the trial. */
  readonly snapshots: boolean;
}

/**
 * The mark a trial leaves in the state folder for the time it writes its test in the repository: what a stop
 * that ends the process before the trial puts the file back needs, to put it back on the next start.
 *
 * @remarks
 * A trial writes its test at its path, runs it, then removes it. A run stopped meanwhile can end its process
 * before the trial is over, which leaves the test in the repository: a file no commit tracks, which keeps the
 * next design from starting. The mark lets that start put the repository back as the trial found it.
 */
export class OpenTrial {
  readonly #root: string;
  readonly #file: string;

  /**
   * @param root - Absolute path of the test repository.
   * @param folder - The folder of the trials, relative to the root.
   */
  public constructor(root: string, folder: string) {
    this.#root = root;
    this.#file = join(root, folder, "open.json");
  }

  /**
   * Records the trial of a test, before it writes the file.
   *
   * @param path - The path of the test, relative to the root.
   * @param kept - What the file held before, for a test that repairs one.
   * @param snapshots - Whether the folder of its visual references is there.
   */
  public async open(path: string, kept: Buffer | undefined, snapshots: boolean): Promise<void> {
    const mark: Mark = { path, ...(kept === undefined ? {} : { kept: kept.toString("base64") }), snapshots };
    await mkdir(dirname(this.#file), { recursive: true });
    await writeFile(this.#file, `${JSON.stringify(mark)}\n`);
  }

  /** Forgets the trial, once its file is put back. */
  public async close(): Promise<void> {
    await rm(this.#file, { force: true });
  }

  /**
   * Puts back what a trial left in the repository, when one was under way as its process ended.
   *
   * @returns The path of the test it took out or put back, if a trial was left open.
   */
  public async recover(): Promise<string | undefined> {
    if (!existsSync(this.#file)) return undefined;
    const mark = JSON.parse(await readFile(this.#file, "utf8")) as Mark;
    const file = join(this.#root, mark.path);
    await (mark.kept === undefined ? rm(file, { force: true }) : writeFile(file, Buffer.from(mark.kept, "base64")));
    if (!mark.snapshots) await rm(`${file}-snapshots`, { recursive: true, force: true });
    await this.close();
    return mark.path;
  }
}
