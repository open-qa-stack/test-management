import { CONFIG_FILE_NAME } from "../config/file-names.ts";

/**
 * Raised when a change of the configuration would rewrite a configuration file that changed since the revision in
 * force was synchronised with it: both changed, and neither is taken over the other without a person choosing.
 */
export class ConfigurationConflictError extends Error {
  constructor() {
    super(`${CONFIG_FILE_NAME} changed since the revision in force of the configuration was read from it or written to it, and the change would overwrite it.`);
    this.name = "ConfigurationConflictError";
  }
}
