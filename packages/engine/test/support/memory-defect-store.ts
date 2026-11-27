import type { Defect, DefectReport, DefectStorePort } from "@open-qa-stack/domain";

/** The defects a person reported, kept in memory, the latest first. */
export class MemoryDefectStore implements DefectStorePort {
  readonly #defects: Defect[] = [];

  list(): Promise<Defect[]> {
    return Promise.resolve([...this.#defects].reverse());
  }

  get(id: string): Promise<Defect | undefined> {
    return Promise.resolve(this.#defects.find((defect) => defect.id === id));
  }

  add(report: DefectReport, at: string): Promise<Defect> {
    const defect: Defect = { ...report, id: `D-${this.#defects.length + 1}`, status: "open", openedAt: at };
    this.#defects.push(defect);
    return Promise.resolve(defect);
  }

  set(defect: Defect): Promise<void> {
    this.#defects[this.#defects.findIndex(({ id }) => id === defect.id)] = defect;
    return Promise.resolve();
  }
}
