import { stat } from "node:fs/promises";
import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { ApiConfiguration } from "../config/api-configuration.ts";

/**
 * Warns at startup about a configuration of the bridge to the command line that cannot do what it was set
 * for: the instance starts all the same, and would otherwise show no session without a word of why.
 */
@Injectable()
export class SoloConfigurationCheck implements OnApplicationBootstrap {
  readonly #configuration: ApiConfiguration;
  readonly #logger = new Logger("Solo");

  constructor(configuration: ApiConfiguration) {
    this.#configuration = configuration;
  }

  /** Logs a warning for a repository that is no folder, and for a command set without a repository. */
  async onApplicationBootstrap(): Promise<void> {
    const { soloRepository: repository, soloCommand: command } = this.#configuration;
    if (repository === undefined) {
      if (command !== undefined)
        this.#logger.warn("OQAS_SOLO_COMMAND is set without OQAS_SOLO_REPOSITORY: no session can be opened until the repository is set.");
      return;
    }
    const folder = await stat(repository).catch(() => undefined);
    if (folder?.isDirectory() !== true) this.#logger.warn(`OQAS_SOLO_REPOSITORY names ${repository}, which is no folder: the instance shows no session.`);
  }
}
