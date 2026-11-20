import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { PastRuns } from "@open-qa-stack/engine";

/**
 * Takes the runs the test repository ran before the instance kept its executions, when the API starts: a database
 * that does not answer, or a run that cannot be kept, does not stop the startup and is logged.
 */
@Injectable()
export class ExecutionsLifecycle implements OnApplicationBootstrap {
  readonly #past: PastRuns;
  readonly #logger = new Logger("Executions");

  constructor(past: PastRuns) {
    this.#past = past;
  }

  /** Takes the past runs, and logs how many. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const taken = await this.#past.take();
      if (taken > 0) this.#logger.log(`${taken} past runs of the test repository are kept as executions.`);
    } catch (error) {
      this.#logger.warn(`The past runs of the test repository are not kept as executions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
