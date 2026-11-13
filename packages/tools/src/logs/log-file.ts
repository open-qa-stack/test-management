import { open, type FileHandle } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { LogLines, LogSource } from "./log-source.ts";

/**
 * A log written to a file of the workstation.
 *
 * @remarks
 * The file is read from its start, a line at a time, so that a large file is never held whole; a reader that
 * stops early closes it.
 */
export class LogFile implements LogSource {
  private readonly path: string;
  private readonly label: string;

  /**
   * @param path - Absolute path of the file.
   * @param label - How errors name the file: its path in the configuration.
   */
  public constructor(path: string, label: string) {
    this.path = path;
    this.label = label;
  }

  /** {@inheritDoc LogSource.lines} */
  public async lines(): Promise<LogLines> {
    const handle = await open(this.path).catch((failure: NodeJS.ErrnoException) => {
      throw new Error(`The log file ${this.label} cannot be read: ${failure.code}.`);
    });
    return { lines: linesOf(handle), cut: false };
  }
}

/** The lines of an open file, which is closed once they are read, or once the reader stops. */
async function* linesOf(handle: FileHandle): AsyncGenerator<string> {
  const input = handle.createReadStream({ encoding: "utf8" });
  try {
    yield* createInterface({ input, crlfDelay: Infinity });
  } finally {
    input.destroy();
  }
}
