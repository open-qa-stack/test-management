import type { DefectStatus } from "./defect.ts";

/** What a person does of a defect. */
export type DefectEvent = "fix" | "close" | "reopen";

/** What the life of a defect says of one event: the states it is for, and the state it leaves the defect in. */
interface DefectRule {
  readonly from: readonly DefectStatus[];
  readonly to: DefectStatus;
}

/**
 * The life of a defect: for each event, the states it is for, and the state it leaves the defect in.
 *
 * @remarks
 * A defect is `open` once reported. It is fixed, then its test is replayed; it is closed, fixed or not; and it is opened
 * again from either. A defect closed is not fixed: it is opened again first. Whoever keeps the defects enforces this table.
 */
export const DEFECT_LIFE = {
  /** The defect is fixed: its test is to replay. */
  fix: { from: ["open"], to: "fixed" },
  /** The defect is closed. */
  close: { from: ["open", "fixed"], to: "closed" },
  /** The defect is open again, which forgets when it was fixed and closed. */
  reopen: { from: ["fixed", "closed"], to: "open" },
} as const satisfies Readonly<Record<DefectEvent, DefectRule>>;

/** The events, in the order of the table. */
const EVENTS = Object.keys(DEFECT_LIFE) as DefectEvent[];

/**
 * Gives the states a defect can be moved to, in the order of the table.
 *
 * @param status - Where it stands.
 * @returns Where an event takes it from there.
 */
export function defectMovesFrom(status: DefectStatus): DefectStatus[] {
  return EVENTS.flatMap((event) => {
    const rule: DefectRule = DEFECT_LIFE[event];
    return rule.from.includes(status) ? [rule.to] : [];
  });
}

/**
 * Tells why a defect is refused a move, or that it takes it.
 *
 * @param id - Its reference.
 * @param from - Where it stands.
 * @param to - Where it is asked to stand; where it stands already is no move, and is taken.
 * @returns Why, in a sentence; `undefined` when the defect takes the move.
 */
export function defectRefusalOf(id: string, from: DefectStatus, to: DefectStatus): string | undefined {
  const moves = defectMovesFrom(from);
  if (from === to || moves.includes(to)) return undefined;
  return `The defect ${id} is ${from}: from there it can be ${moves.join(" or ")}.`;
}
