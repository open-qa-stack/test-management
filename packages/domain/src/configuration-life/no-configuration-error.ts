/** Raised when an instance has no configuration: no revision is kept, and the configuration file cannot be read. */
export class NoConfigurationError extends Error {
  /** @param path - The path of the configuration file that cannot be read. */
  constructor(path: string) {
    super(`${path} cannot be read, and the instance keeps no revision of the configuration.`);
    this.name = "NoConfigurationError";
  }
}
