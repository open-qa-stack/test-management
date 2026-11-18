import { Injectable } from "@nestjs/common";
import { ApiConfiguration } from "../config/api-configuration.ts";
import type { SessionsRuns } from "../api-entry.ts";

/** What the API gives the runs of its sessions besides its database and its test repository. */
@Injectable()
export class RunEnvironment {
  /** What the runs work with: the environment and the machine the API was started with. */
  readonly runs: SessionsRuns;

  /** How long the session that runs is given to end when the API stops, in milliseconds. */
  readonly stopWithinMs: number = 10_000;

  constructor(configuration: ApiConfiguration) {
    this.runs = configuration.runs;
  }
}
