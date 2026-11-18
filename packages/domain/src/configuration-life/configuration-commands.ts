import type { ConfigurationRevision, RevisionEntry } from "./configuration-revision.ts";

/** What changes the revisions of the configuration an instance keeps. */
export interface ConfigurationCommands {
  /**
   * Records a revision on top of the one it was made from, which must be the revision in force: a change made
   * from a revision another replaced since is refused, whoever recorded that other one.
   *
   * @remarks
   * The command happens whole or not at all: once the revision is known to be in order, `alongside` is run, and
   * the revision is kept once it ended; when it throws, nothing is kept. Two commands made from the same
   * revision run one after the other: the first is kept, the second refused.
   *
   * @param entry - The revision.
   * @param basedOn - The number of the revision it was made from; 0 when there was none.
   * @param alongside - What is done with the revision before it is kept, such as writing it to the file.
   * @returns The revision, numbered after the one it was made from, and dated.
   * @throws `StaleRevisionError` when the revision in force is not the one it was made from.
   */
  record(entry: RevisionEntry, basedOn: number, alongside?: () => Promise<void>): Promise<ConfigurationRevision>;
}
