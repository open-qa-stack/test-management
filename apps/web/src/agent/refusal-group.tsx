import type { ReactNode } from "react";
import type { VerdictStep } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { Badge } from "../ui/badge.tsx";
import type { ShownStep } from "./playback.ts";
import { harnessText } from "./harness-words.ts";
import { SpeakerMark } from "./speaker-mark.tsx";
import { HarnessVerdict } from "./verdict-card.tsx";

/** What a row of refusals alike needs. */
export interface RefusalGroupProps {
  /** The refusals, in order: one, or several by the same gate about the same thing. */
  readonly items: readonly ShownStep[];
  /** What of the thread the person unfolded, by key. */
  readonly unfolded: readonly string[];
  /** Unfolds a part of the thread, by its key, or folds it again. */
  readonly onUnfold: (key: string) => void;
}

/**
 * A refusal of the harness, or the refusals alike it gave in a row, on one line: refused, how many times, by which
 * gate, about what, and the scenarios they name; each refusal unfolds under it, whole.
 *
 * @param props - The refusals, and the texts the person unfolded.
 * @returns The row.
 */
export function RefusalGroup({ items, unfolded, onUnfold }: RefusalGroupProps): ReactNode {
  const steps = items.map(({ step }) => step as VerdictStep);
  const first = steps[0]!;
  const scenarios = [...new Set(steps.flatMap(({ scenario }) => (scenario === undefined ? [] : [scenario])))];
  const what = first.subject === undefined ? (first.code === undefined ? t("thread.toolFailed") : first.about) : harnessText(first.subject);
  return (
    <details className="refusals">
      <summary>
        <SpeakerMark speaker="harness" size="sm" />
        <Badge tone="ko">
          {steps.length > 1 ? t("thread.refusals", { count: steps.length }) : t(first.code === undefined ? "verdict.error" : "verdict.refused")}
        </Badge>
        {first.code !== undefined && <span className="verdict-code">{first.code}</span>}
        <span className="refusals-what">{what}</span>
        {scenarios.length > 0 && <span className="refusals-scenarios">{scenarios.join(", ")}</span>}
        <span className="turn-at">{first.at}</span>
      </summary>
      <div className="refusals-list">
        {items.map(({ index }, rank) => (
          <HarnessVerdict key={index} step={steps[rank]!} index={index} open={unfolded.includes(`text-${index}`)} onUnfold={() => onUnfold(`text-${index}`)} />
        ))}
      </div>
    </details>
  );
}
