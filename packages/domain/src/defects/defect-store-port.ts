import type { Defect, DefectReport } from "./defect.ts";

/** What keeps the defects a person reported. */
export interface DefectStorePort {
  /** @returns Every defect, the latest reported first. */
  list(): Promise<Defect[]>;

  /** @returns The defect of the reference; `undefined` for one the store does not keep. */
  get(id: string): Promise<Defect | undefined>;

  /**
   * Keeps a defect reported, under the next number.
   *
   * @param report - What the person reported.
   * @param at - When, as an ISO 8601 date.
   * @returns The defect kept, open.
   */
  add(report: DefectReport, at: string): Promise<Defect>;

  /** Keeps where a defect stands now, in place of what was kept of it. */
  set(defect: Defect): Promise<void>;
}
