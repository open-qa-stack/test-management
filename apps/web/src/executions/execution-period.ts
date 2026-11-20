/** How far back a page of the executions goes: the last day, the last seven days or the last thirty. */
export type ExecutionPeriod = "day" | "week" | "month";

/** The periods a person narrows the executions to, the shortest first, each with how many days it goes back. */
const DAYS: Readonly<Record<ExecutionPeriod, number>> = { day: 1, week: 7, month: 30 };

/** The periods, the shortest first. */
export const EXECUTION_PERIODS = Object.keys(DAYS) as readonly ExecutionPeriod[];

/**
 * Tells whether a value names a period.
 *
 * @param value - What an address or a list gives.
 * @returns Whether it is one of the periods.
 */
export function isExecutionPeriod(value: string | undefined): value is ExecutionPeriod {
  return EXECUTION_PERIODS.includes(value as ExecutionPeriod);
}

/**
 * The date a period starts at.
 *
 * @param period - The period.
 * @param now - The moment it ends at.
 * @returns The moment as many days before, in ISO 8601.
 */
export function periodStart(period: ExecutionPeriod, now: Date): string {
  return new Date(now.getTime() - DAYS[period] * 86_400_000).toISOString();
}
