import type { ReactNode } from "react";
import type { ExecutionResult, ExecutionVerdict } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { Badge, type BadgeTone } from "../ui/badge.tsx";

/** The verdicts, in the order a summary counts them, each with the tone of its badge. */
const VERDICTS: readonly (readonly [ExecutionVerdict, BadgeTone])[] = [
  ["failed", "ko"],
  ["flaky", "warn"],
  ["passed", "ok"],
  ["skipped", "neutral"],
];

/** The tone of the badge of a verdict. */
const toneOf = (verdict: ExecutionVerdict): BadgeTone => VERDICTS.find(([known]) => known === verdict)![1];

/**
 * What came of a test, as a badge.
 *
 * @param props - The verdict.
 * @returns The badge.
 */
export function VerdictBadge({ verdict }: { readonly verdict: ExecutionVerdict }): ReactNode {
  return <Badge tone={toneOf(verdict)}>{t(`executions.verdicts.${verdict}`)}</Badge>;
}

/**
 * How many tests of an execution came to each verdict, those none came to left out, the failures first.
 *
 * @param props - The results of the execution.
 * @returns The badges.
 */
export function VerdictCounts({ results }: { readonly results: readonly ExecutionResult[] }): ReactNode {
  return VERDICTS.map(([verdict, tone]) => [verdict, tone, results.filter((result) => result.verdict === verdict).length] as const)
    .filter(([, , count]) => count > 0)
    .map(([verdict, tone, count]) => (
      <Badge key={verdict} tone={tone}>
        {t(`executions.counts.${verdict}`, { count })}
      </Badge>
    ));
}

/**
 * Puts the results of an execution in the order a person reads them: the failures first, then the others, each in the order of the report.
 *
 * @param results - The results, in the order of the report.
 * @returns The same results, reordered.
 */
export function failuresFirst(results: readonly ExecutionResult[]): readonly ExecutionResult[] {
  const rank = (result: ExecutionResult): number => VERDICTS.findIndex(([verdict]) => verdict === result.verdict);
  return results
    .map((result, order) => ({ result, order }))
    .toSorted((left, right) => rank(left.result) - rank(right.result) || left.order - right.order)
    .map(({ result }) => result);
}
