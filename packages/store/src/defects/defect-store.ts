import type { Defect, DefectReport, DefectSeverity, DefectStatus, DefectStorePort } from "@open-qa-stack/domain";
import type { Kysely, Selectable } from "kysely";
import type { Database } from "../database/database.ts";
import type { DefectsTable, StoreSchema } from "../database/schema.ts";

/** The prefix of the reference of a defect, before its number. */
const PREFIX = "D-";

/** The defects a person reported, as the database of the instance keeps them. */
export class DefectStore implements DefectStorePort {
  readonly #database: Kysely<StoreSchema>;

  /** @param database - The database of the instance, with its migrations applied. */
  constructor(database: Database) {
    this.#database = database.kysely;
  }

  /** @returns Every defect, the latest reported first. */
  async list(): Promise<Defect[]> {
    const rows = await this.#database.selectFrom("defects").selectAll().orderBy("number", "desc").execute();
    return rows.map(defectOf);
  }

  /** @returns The defect of the reference; `undefined` for one the store does not keep. */
  async get(id: string): Promise<Defect | undefined> {
    const number = numberOf(id);
    if (number === undefined) return undefined;
    const row = await this.#database.selectFrom("defects").selectAll().where("number", "=", number).executeTakeFirst();
    return row === undefined ? undefined : defectOf(row);
  }

  /** Keeps a defect reported, under the number after the highest kept. */
  async add(report: DefectReport, at: string): Promise<Defect> {
    return this.#database.transaction().execute(async (transaction) => {
      const { highest } = await transaction
        .selectFrom("defects")
        .select((query) => query.fn.max("number").as("highest"))
        .executeTakeFirstOrThrow();
      const number = (highest ?? 0) + 1;
      await transaction
        .insertInto("defects")
        .values({
          number,
          title: report.title,
          severity: report.severity,
          description: report.description,
          test_path: report.test.path,
          test_title: report.test.title,
          execution: report.execution ?? null,
          status: "open",
          opened_at: at,
          fixed_at: null,
          closed_at: null,
        })
        .execute();
      return { ...report, id: `${PREFIX}${number}`, status: "open" as const, openedAt: at };
    });
  }

  /** Keeps where a defect stands now. */
  async set(defect: Defect): Promise<void> {
    await this.#database
      .updateTable("defects")
      .set({ status: defect.status, fixed_at: defect.fixedAt ?? null, closed_at: defect.closedAt ?? null })
      .where("number", "=", numberOf(defect.id)!)
      .execute();
  }
}

/** The number of a reference; `undefined` for a text that is none. */
function numberOf(id: string): number | undefined {
  const digits = id.startsWith(PREFIX) ? id.slice(PREFIX.length) : "";
  return /^[1-9][0-9]*$/.test(digits) ? Number(digits) : undefined;
}

function defectOf(row: Selectable<DefectsTable>): Defect {
  return {
    id: `${PREFIX}${row.number}`,
    title: row.title,
    severity: row.severity as DefectSeverity,
    description: row.description,
    test: { path: row.test_path, title: row.test_title },
    ...(row.execution === null ? {} : { execution: row.execution }),
    status: row.status as DefectStatus,
    openedAt: row.opened_at,
    ...(row.fixed_at === null ? {} : { fixedAt: row.fixed_at }),
    ...(row.closed_at === null ? {} : { closedAt: row.closed_at }),
  };
}
