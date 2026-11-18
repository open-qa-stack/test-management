import type { StoreLogger } from "../../src/store-logger.ts";

/** A logger that keeps every line it is given, under its level. */
export class RecordingLogger implements StoreLogger {
  readonly lines: string[] = [];

  log(message: string): void {
    this.lines.push(`log ${message}`);
  }

  warn(message: string): void {
    this.lines.push(`warn ${message}`);
  }
}
