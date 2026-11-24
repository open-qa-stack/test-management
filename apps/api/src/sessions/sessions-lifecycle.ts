import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { Sessions } from "@open-qa-stack/engine";
import { RunEnvironment } from "./run-environment.ts";

/**
 * Starts the operations on sessions with the API, and stops them with it: the API is the process that hosts
 * the sessions of the instance.
 */
@Injectable()
export class SessionsLifecycle implements OnApplicationBootstrap, OnModuleDestroy {
  readonly #sessions: Sessions;
  readonly #environment: RunEnvironment;
  readonly #logger = new Logger("Sessions");

  constructor(sessions: Sessions, environment: RunEnvironment) {
    this.#sessions = sessions;
    this.#environment = environment;
  }

  /**
   * Has the operations put the database in order — the project saved, the sessions a process that died left
   * running interrupted, those it left waiting taken over — and start the sessions that wait. The sessions of
   * a process that still beats are left to it. A database that does not answer does not stop the startup: it
   * is logged, and the operations start when a session is next opened.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.#sessions.start();
    } catch (error) {
      this.#logger.warn(`The sessions are not started, and will be when one is next opened: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Asks the session that runs to stop, and waits for its end before the database closes; one that did not end in time is logged. */
  async onModuleDestroy(): Promise<void> {
    if (await this.#sessions.stop(this.#environment.stopWithinMs)) return;
    this.#logger.warn("The session under way did not end in time: it stays running in the database until a process that hosts sessions interrupts it.");
  }
}
