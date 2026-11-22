import type { ReactNode, SyntheticEvent } from "react";

/** What a part of the thread folded under one line needs. */
export interface FoldProps {
  /** What names it among what the person unfolded, such as `actions-12`. */
  readonly id: string;
  readonly className: string;
  /** Whether it is open whatever the person did: one of its steps runs, or the look of one of its actions is open. */
  readonly forced: boolean;
  /** What the person unfolded. */
  readonly unfolded: readonly string[];
  /** Unfolds it, or folds it again. */
  readonly onUnfold: (id: string) => void;
  /** Its line. */
  readonly summary: ReactNode;
  readonly children: ReactNode;
}

/**
 * A part of the thread folded under one line, open while something in it calls for it or once the person unfolded
 * it: what the person opens stays open when what called for it ends, such as the look of an action that closes.
 *
 * @param props - What names it, what it shows, and what the person unfolded.
 * @returns The fold.
 */
export function Fold({ id, className, forced, unfolded, onUnfold, summary, children }: FoldProps): ReactNode {
  const open = forced || unfolded.includes(id);
  // The browser tells each change of the fold, the one this element was drawn with too: only the person's is kept.
  const toggled = (event: SyntheticEvent<HTMLDetailsElement>): void => {
    if (event.currentTarget.open !== open) onUnfold(id);
  };
  return (
    <details className={className} open={open} onToggle={toggled}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
