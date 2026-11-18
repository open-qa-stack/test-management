import type { CommandLine } from "../config/command-line.ts";
import type { Environment } from "../config/environment-variable.ts";

/** What the sessions of the command line are read and opened with. */
export interface SoloOptions {
  /** The root of the test repository, absolute. */
  readonly repository: string;
  /** The command that starts `oqas`; sessions cannot be opened without it. */
  readonly command?: CommandLine;
  /** The environment the command is started in, which must hold no secret of the instance; an empty one when left out. */
  readonly environment?: Environment;
  /** The clock; that of the machine by default. */
  readonly now?: () => Date;
  /** How often the files of a run are read for what it wrote, and looked for when it is opened, in milliseconds; 250 by default. */
  readonly pollMs?: number;
  /** How long a run must have been silent before the end of its session is told, in milliseconds; 1000 by default. */
  readonly settleMs?: number;
  /** How long the opening of a session waits for its run to start, in milliseconds; 30000 by default. */
  readonly openWaitMs?: number;
}
