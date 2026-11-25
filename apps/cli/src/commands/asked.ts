import type { Sessions } from "@open-qa-stack/engine";
import type { Arguments } from "../arguments/arguments.ts";
import type { Command } from "../arguments/command.ts";
import type { CommandIo } from "./command-io.ts";

/** What a command on sessions is given: the operations, what it was asked, and where it writes. */
export interface Asked<Name extends Command["name"]> {
  readonly sessions: Sessions;
  readonly command: Extract<Command, { name: Name }>;
  readonly options: Arguments;
  readonly io: CommandIo;
}
