import type { ListedDefect } from "@open-qa-stack/domain";

/** How each stage of a defect is told. */
const STAGES = { open: "open", to_replay: "fixed, to run again", replayed: "fixed, passed since", closed: "closed" } as const;

/** @returns The line of a defect: its reference, its severity, where it stands, its title, and the test it comes from. */
export function defectLine(defect: ListedDefect): string {
  return `${defect.id}  ${defect.severity}  ${STAGES[defect.stage]}  ${defect.title}  (${defect.test.title}, ${defect.test.path}; reported ${defect.openedAt})`;
}
