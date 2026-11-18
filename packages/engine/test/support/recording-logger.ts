import type { SessionsLogger } from "../../src/index.ts";

/** A logger that keeps every line it is given, under its level. */
export class RecordingLogger implements SessionsLogger {
  readonly lines: string[] = [];

  log(message: string): void {
    this.lines.push(`log ${message}`);
  }

  warn(message: string): void {
    this.lines.push(`warn ${message}`);
  }
}
