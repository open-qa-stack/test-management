import { open } from "node:fs/promises";

/**
 * The lines appended to a file since it was last read: a file a run writes to line by line is followed
 * without ever being read twice.
 */
export class AppendedLines {
  readonly #path: string;
  #offset = 0;

  /** @param path - The file, absolute. */
  constructor(path: string) {
    this.#path = path;
  }

  /**
   * Reads what was appended to the file.
   *
   * @returns The lines completed since the last reading, without their end and without empty ones; a line
   * still being written waits for the next reading, and so does a file that does not exist yet.
   */
  async read(): Promise<string[]> {
    const file = await open(this.#path, "r").catch(() => undefined);
    if (file === undefined) return [];
    try {
      const { size } = await file.stat();
      if (size <= this.#offset) return [];
      const appended = Buffer.alloc(size - this.#offset);
      await file.read(appended, 0, appended.length, this.#offset);
      const end = appended.lastIndexOf("\n");
      if (end < 0) return [];
      this.#offset += end + 1;
      return appended
        .subarray(0, end)
        .toString("utf8")
        .split("\n")
        .filter((line) => line !== "");
    } finally {
      await file.close();
    }
  }
}
