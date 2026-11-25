import type { Command } from "../arguments/command.ts";

/**
 * A command that does what it is asked and ends at once, printing what it did: the same in the command and, after a
 * slash, in the conversation. Those that run or follow a session, serve the console or draw a screen are not.
 */
export type PrintingCommand =
  | Extract<
      Command,
      {
        name:
          | "init"
          | "agents"
          | "config"
          | "knowledge"
          | "applications"
          | "secrets"
          | "sessions"
          | "show"
          | "stop"
          | "tests"
          | "executions"
          | "launch"
          | "campaigns"
          | "project"
          | "repository";
      }
    >
  | Extract<Command, { name: "model"; action: "status" | "set" }>;

/** The names of the commands that print, as {@link isPrinting} reads them: typed on them, it does not compile while one is left out. */
const PRINTING: Readonly<Record<PrintingCommand["name"], true>> = {
  init: true,
  agents: true,
  config: true,
  knowledge: true,
  applications: true,
  secrets: true,
  sessions: true,
  show: true,
  stop: true,
  model: true,
  tests: true,
  executions: true,
  launch: true,
  campaigns: true,
  project: true,
  repository: true,
};

/**
 * Tells whether a command does what it is asked and ends at once, printing what it did.
 *
 * @param command - What the arguments ask for.
 * @returns Whether it is a {@link PrintingCommand}.
 */
export function isPrinting(command: Command): command is PrintingCommand {
  return Object.hasOwn(PRINTING, command.name) && !(command.name === "model" && command.action === "setup");
}
