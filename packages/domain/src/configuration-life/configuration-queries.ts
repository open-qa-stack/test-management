import type { ConfigurationRevision, RevisionSummary } from "./configuration-revision.ts";

/** What is read of the revisions of the configuration an instance keeps. Reading changes nothing. */
export interface ConfigurationQueries {
  /** @returns The revision in force, the last recorded; `undefined` when none was. */
  inForce(): Promise<ConfigurationRevision | undefined>;

  /** @returns Every revision, without its document, the latest first. */
  revisions(): Promise<RevisionSummary[]>;
}
