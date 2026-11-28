import type { ReactNode, SyntheticEvent } from "react";
import { t } from "../i18n/i18n.ts";
import { Icon } from "../ui/icon.tsx";
import { opensByItself, type PhaseFamily, type PhaseState, type PhaseView } from "./session-phases.ts";

/** The mark of the state of a phase. */
export function PhaseMark({ state }: { readonly state: PhaseState }): ReactNode {
  if (state === "current") return <span className="spinner" role="img" aria-label={t("phases.states.current")} />;
  return (
    <span className={`phase-mark ${state}`} role="img" aria-label={t(`phases.states.${state}`)}>
      <Icon name={state === "done" ? "check" : "pause"} />
    </span>
  );
}

/**
 * How a phase reads: the cartography as one, any other by the title of its pass.
 *
 * @param phase - The family of the phase, and the title of its pass.
 * @returns Its title.
 */
export function phaseTitle(phase: { readonly family: PhaseFamily; readonly title: string }): string {
  return phase.family === "cartography" ? t("phases.cartography") : phase.title;
}

/** What came of a phase, in a few words: that it goes on or stopped, the sources the cartography read, the tests a plan wrote. */
function resultOf(phase: PhaseView, sources: number, tally: string | undefined): string | undefined {
  if (phase.state === "current") return t("phases.states.current");
  if (phase.state === "interrupted") return t("phases.states.interrupted");
  if (phase.family === "cartography") return t("facts.sourcesRead", { count: sources });
  if (phase.family === "plan") return phase.written === 0 ? t("phases.noTest") : t("phases.written", { count: phase.written });
  return phase.family === "summary" ? tally : undefined;
}

/** What a row of a phase needs. */
export interface PhaseRowProps {
  readonly phase: PhaseView;
  /** How many sources the session read, which the cartography tells. */
  readonly sources: number;
  /** What the session produced, in a few words, which its summary tells. */
  readonly tally: string | undefined;
  /** Whether every phase is open, whatever the person folded. */
  readonly allOpen: boolean;
  /** Whether something in it calls for it open, such as the look of one of its actions. */
  readonly forced: boolean;
  /** What the person unfolded, or folded of what opens by itself. */
  readonly unfolded: readonly string[];
  readonly onUnfold: (key: string) => void;
  readonly children: ReactNode;
}

/**
 * A phase of a session, on one line that unfolds on its turns: its state, its title, what came of it and when it
 * ran, after what it makes of the request when its pass says it. The phase the agents work in, the one the session stopped in and the summary are open until the person folds
 * them; the others are folded until the person unfolds them.
 *
 * @param props - The phase, what it holds, and what the person unfolded.
 * @returns The row.
 */
export function PhaseRow({ phase, sources, tally, allOpen, forced, unfolded, onUnfold, children }: PhaseRowProps): ReactNode {
  const open = allOpen || forced || opensByItself(phase) !== unfolded.includes(phase.key);
  // The browser tells each change of the fold, the one this element was drawn with too: only the person's is kept.
  const toggled = (event: SyntheticEvent<HTMLDetailsElement>): void => {
    if (event.currentTarget.open !== open) onUnfold(phase.key);
  };
  const result = [phase.pass.summary, resultOf(phase, sources, tally)].filter((part) => part !== undefined && part !== "").join(" · ");
  return (
    <details className={`phase ${phase.state}`} open={open} onToggle={toggled}>
      <summary>
        <PhaseMark state={phase.state} />
        <span className="phase-what">
          <b className="phase-title">{phaseTitle(phase)}</b>
          {result !== "" && <span className="phase-result">{result}</span>}
        </span>
        <span className="phase-at">{phase.from === phase.to ? phase.from : `${phase.from} → ${phase.to}`}</span>
        <Icon name="chevron" />
      </summary>
      <div className="phase-turns">{children}</div>
    </details>
  );
}
