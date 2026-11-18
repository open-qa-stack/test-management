import { Injectable } from "@nestjs/common";
import { processEnvironment } from "../config/process-environment.ts";
import type { CommandRunner } from "@open-qa-stack/domain";
import type { SessionsPace, WriterPace } from "@open-qa-stack/engine";
import type { Environment } from "../config/environment-variable.ts";

/** What the API gives the runs of its sessions besides its database and its test repository. */
@Injectable()
export class RunEnvironment {
  /**
   * The environment of the runs, that of the process: the variables the configuration of the test repository
   * names — the key of the model, the test accounts — are read from it by each run, as the command line reads them.
   */
  readonly env: Environment = processEnvironment();

  /** What runs the commands of a run, npm and the tests; `undefined` for the machine itself, in the test repository. */
  readonly runner: CommandRunner | undefined = undefined;

  /** How a write to the database that failed is made again; `undefined` for the pace of the engine. */
  readonly writerPace: WriterPace | undefined = undefined;

  /** The paces of the API among the processes that reach its database; `undefined` for those of the engine. */
  readonly pace: SessionsPace | undefined = undefined;

  /** How long the session that runs is given to end when the API stops, in milliseconds. */
  readonly stopWithinMs: number = 10_000;
}
