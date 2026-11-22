import type { ConfigurationRevision } from "@open-qa-stack/domain";

/** Where a run reads its configuration: the revision in force. */
export interface ConfigurationSource {
  /**
   * @returns The revision in force; an instance that keeps none yet takes the configuration file as its first.
   * @throws `NoConfigurationError` when there is neither a revision nor a file to read one from.
   * @throws `InvalidConfigurationError` when the instance keeps no revision, and the file is not a valid configuration.
   */
  current(): Promise<ConfigurationRevision>;
}
