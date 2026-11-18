import { StaleRevisionError, type ConfigurationRevision, type ConfigurationStorePort, type RevisionEntry, type RevisionSummary } from "@open-qa-stack/domain";
import { instant, jsonOf, storedJson } from "../database/stored-values.ts";
import type { Kysely, Selectable } from "kysely";
import type { Database } from "../database/database.ts";
import type { ConfigurationRevisionsTable, StoreSchema } from "../database/schema.ts";

/** A row of the revisions, as it is read. */
type RevisionRow = Selectable<ConfigurationRevisionsTable>;

/** A row of the revisions as the summary of the revision it holds, its date in ISO 8601. */
function summaryOf({ number, recorded_at, origin, file_digest }: Omit<RevisionRow, "document">): RevisionSummary {
  return { number, recordedAt: instant(recorded_at), origin, fileDigest: file_digest };
}

/**
 * The revisions of the configuration of the instance, as its database keeps them.
 *
 * @remarks
 * A revision is recorded on top of the one it was made from, in one transaction that writes first: it inserts the
 * row of the number that follows, which a revision recorded meanwhile from the same one already holds. Two
 * changes made from the same revision run one after the other, on every database the store supports, and the
 * second is refused. What the store dates, it dates by the clock of the process that records.
 */
export class ConfigurationStore implements ConfigurationStorePort {
  readonly #database: Kysely<StoreSchema>;
  readonly #clock: () => Date;

  /**
   * @param database - The database of the instance, with its migrations applied.
   * @param clock - What tells the date; the clock of the machine by default.
   */
  constructor(database: Database, clock: () => Date = () => new Date()) {
    this.#database = database.kysely;
    this.#clock = clock;
  }

  /** @returns The revision in force, the last recorded; `undefined` when none was. */
  async inForce(): Promise<ConfigurationRevision | undefined> {
    const row = await this.#database.selectFrom("configuration_revisions").selectAll().orderBy("number", "desc").limit(1).executeTakeFirst();
    return row === undefined ? undefined : { ...summaryOf(row), document: jsonOf(row.document) };
  }

  /** @returns Every revision, without its document, the latest first. */
  async revisions(): Promise<RevisionSummary[]> {
    const rows = await this.#database
      .selectFrom("configuration_revisions")
      .select(["number", "recorded_at", "origin", "file_digest"])
      .orderBy("number", "desc")
      .execute();
    return rows.map(summaryOf);
  }

  /**
   * Records a revision on top of the one it was made from, which must be the revision in force.
   *
   * @param entry - The revision.
   * @param basedOn - The number of the revision it was made from; 0 when there was none.
   * @param alongside - What is done with the revision before it is kept; when it throws, nothing is kept.
   * @returns The revision, numbered after the one it was made from, and dated.
   * @throws {@link StaleRevisionError} when the revision in force is not the one it was made from.
   */
  async record(entry: RevisionEntry, basedOn: number, alongside?: () => Promise<void>): Promise<ConfigurationRevision> {
    const row = {
      number: basedOn + 1,
      recorded_at: instant(this.#clock()),
      origin: entry.origin,
      file_digest: entry.fileDigest,
      document: storedJson(entry.document),
    };
    await this.#database.transaction().execute(async (transaction) => {
      const inserted = await transaction
        .insertInto("configuration_revisions")
        .values(row)
        .onConflict((conflict) => conflict.column("number").doNothing())
        .returning("number")
        .execute();
      // Another revision holds the number: it was recorded from the same one, which it replaced.
      if (inserted.length === 0) throw new StaleRevisionError(basedOn, await this.#last(transaction));
      // A revision made from one that does not exist is no more in order than one made from a revision replaced since.
      if (!(await this.#holds(transaction, basedOn))) throw new StaleRevisionError(basedOn, await this.#last(transaction, row.number));
      await alongside?.();
    });
    return { ...summaryOf(row), document: entry.document };
  }

  /** The number of the revision in force, of those below a number when one is given; 0 when there is none. */
  async #last(transaction: Kysely<StoreSchema>, below?: number): Promise<number> {
    const { last } = await transaction
      .selectFrom("configuration_revisions")
      .select((revision) => revision.fn.max<number | null>("number").as("last"))
      .$if(below !== undefined, (query) => query.where("number", "<", below!))
      .executeTakeFirstOrThrow();
    return last ?? 0;
  }

  /** Whether a revision was made from one the database holds, or from none when it holds none. */
  async #holds(transaction: Kysely<StoreSchema>, basedOn: number): Promise<boolean> {
    if (basedOn === 0) return true;
    const found = await transaction.selectFrom("configuration_revisions").select("number").where("number", "=", basedOn).executeTakeFirst();
    return found !== undefined;
  }
}
