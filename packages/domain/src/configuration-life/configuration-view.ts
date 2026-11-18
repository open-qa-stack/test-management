import type { ConfigurationRevision } from "./configuration-revision.ts";
import type { FileState } from "./file-state.ts";

/** The configuration of an instance as it is now: the revision in force, and how the configuration file stands to it. */
export interface ConfigurationView {
  /** The revision in force; left out when none was recorded yet. */
  readonly revision?: ConfigurationRevision;
  readonly file: FileState;
}
