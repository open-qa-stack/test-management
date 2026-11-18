import type { ReactNode } from "react";
import { t } from "../i18n/i18n.ts";

/** How many lines a long text shows before it is unfolded. */
const FOLDED_LINES = 6;

/** How many characters a text holds at most to be shown whole at once: about the room of its folded lines. */
const FOLDED_LENGTH = 480;

/** What a text read at length needs. */
export interface LongTextProps {
  /** The identifier of its paragraph, which its button controls. */
  readonly id: string;
  readonly text: string;
  readonly className: string;
  /** Whether the person unfolded it. */
  readonly open: boolean;
  /** Unfolds it, or folds it again. */
  readonly onUnfold: () => void;
}

/**
 * A text read at length, whole: one that would not hold in a few lines shows its first ones, and a button under
 * it unfolds the rest in place, then folds it again. The end of a refusal says what to do: it is one press away.
 *
 * @param props - The text, and whether it is unfolded.
 * @returns The text, and its button when it is long.
 */
export function LongText({ id, text, className, open, onUnfold }: LongTextProps): ReactNode {
  const long = text.length > FOLDED_LENGTH || text.split("\n").length > FOLDED_LINES;
  return (
    <>
      <p id={id} className={long && !open ? `${className} folded` : className}>
        {text}
      </p>
      {long && (
        <button type="button" className="btn ghost sm read-more" aria-expanded={open} aria-controls={id} onClick={onUnfold}>
          {t(open ? "longText.fold" : "longText.more")}
        </button>
      )}
    </>
  );
}
