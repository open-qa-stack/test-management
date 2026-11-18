import { StaleRevisionError, type ConfigurationRevision, type ConfigurationStorePort, type RevisionEntry, type RevisionSummary } from "@open-qa-stack/domain";

/**
 * The store of the revisions of the configuration kept in memory, by the rule of the port: what the operations
 * are tested on, without a database.
 *
 * @remarks
 * A test puts the operations before what a database does at times through `before`, called before a revision is
 * recorded: what it throws refuses it, what it awaits holds it.
 */
export class MemoryConfigurationStore implements ConfigurationStorePort {
  /** Called before a revision is recorded. */
  before: () => Promise<void> | void = () => undefined;
  readonly #revisions: ConfigurationRevision[] = [];
  readonly #clock: () => Date;

  /** @param clock - What tells the date of a revision. */
  constructor(clock: () => Date = () => new Date("2026-11-18T09:00:00.000Z")) {
    this.#clock = clock;
  }

  inForce(): Promise<ConfigurationRevision | undefined> {
    return Promise.resolve(this.#revisions.at(-1));
  }

  revisions(): Promise<RevisionSummary[]> {
    return Promise.resolve(this.#revisions.map(({ document: _, ...summary }) => summary).reverse());
  }

  async record(entry: RevisionEntry, basedOn: number, alongside?: () => Promise<void>): Promise<ConfigurationRevision> {
    await this.before();
    const inForce = this.#revisions.length;
    if (basedOn !== inForce) throw new StaleRevisionError(basedOn, inForce);
    const revision = { number: basedOn + 1, recordedAt: this.#clock().toISOString(), ...entry };
    await alongside?.();
    this.#revisions.push(revision);
    return revision;
  }
}
