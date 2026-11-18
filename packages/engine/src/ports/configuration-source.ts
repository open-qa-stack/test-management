import type { ConfigurationRevision } from "@open-qa-stack/domain";

/** Where a run reads its configuration: the revision in force, once it is in step with the configuration file. */
export interface ConfigurationSource {
  /**
   * Brings the revision in force in step with the configuration file, then gives it.
   *
   * @returns The revision in force.
   * @throws `NoConfigurationError` when there is neither a revision nor a file to read one from.
   * @throws `InvalidConfigurationError` when the file changed, and is not a valid configuration.
   */
  synchronise(): Promise<ConfigurationRevision>;
}
