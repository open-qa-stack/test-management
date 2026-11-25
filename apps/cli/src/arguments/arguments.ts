import type { Command } from "./command.ts";

/** How a command prints what it tells: lines a person reads, or JSON Lines a program reads. */
export type Output = "text" | "json";

/** The arguments of the command, once read. */
export interface Arguments {
  /** The test repository; the current folder by default. */
  readonly repository?: string;
  /** How the command prints what it tells. */
  readonly output: Output;
  /** Whether to print what the agents do, besides what the harness tells of the session. */
  readonly follow: boolean;
  readonly command: Command;
}
