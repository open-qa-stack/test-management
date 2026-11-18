import type { ConfigError, OqasConfig } from "../config/types.ts";
import type { RevisionSummary } from "./configuration-revision.ts";

/** The revisions of the configuration of an instance, as the API lists them. */
export interface RevisionList {
  /** Every revision, the latest first. */
  readonly items: readonly RevisionSummary[];
}

/** A change of the configuration, as the console asks for it. */
export interface RevisionChange {
  /** The number of the revision the change was made from: the revision in force, unless another replaced it since. */
  readonly basedOn: number;
  /** The configuration as it is to be. */
  readonly document: OqasConfig;
  /**
   * Whether the change rewrites a configuration file that changed since the revision in force was synchronised with
   * it: the person chose to keep the change over the file. Without it, such a change is refused.
   */
  readonly replaceFile?: boolean;
}

/** What the validation of a configuration found, without anything recorded. */
export interface ConfigurationCheck {
  /** Every error found, each where it is; none when the configuration is valid. */
  readonly errors: readonly ConfigError[];
}
