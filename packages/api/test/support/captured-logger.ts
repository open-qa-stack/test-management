import type { LoggerService } from "@nestjs/common";
import { inspect } from "node:util";

/** A logger that keeps every line it is given, rendered as the console logger would show its arguments. */
export class CapturedLogger implements LoggerService {
  readonly lines: string[] = [];

  log(...parts: unknown[]): void {
    this.#keep("log", parts);
  }

  error(...parts: unknown[]): void {
    this.#keep("error", parts);
  }

  warn(...parts: unknown[]): void {
    this.#keep("warn", parts);
  }

  debug(...parts: unknown[]): void {
    this.#keep("debug", parts);
  }

  verbose(...parts: unknown[]): void {
    this.#keep("verbose", parts);
  }

  #keep(level: string, parts: unknown[]): void {
    this.lines.push(`${level} ${parts.map((part) => (typeof part === "string" ? part : inspect(part, { depth: 10, showHidden: true }))).join(" ")}`);
  }
}
