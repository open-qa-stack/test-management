import type { ConfigurationCommands } from "./configuration-commands.ts";
import type { ConfigurationQueries } from "./configuration-queries.ts";

/**
 * The port of the store of the configuration: what the operations on the configuration ask of what keeps its
 * revisions, whatever keeps them.
 */
export interface ConfigurationStorePort extends ConfigurationCommands, ConfigurationQueries {}
