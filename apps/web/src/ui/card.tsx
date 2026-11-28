import type { ReactNode } from "react";

/** What a card needs. */
export interface CardProps {
  /** Its title; none for a card without a header. */
  readonly title?: ReactNode;
  /** What follows the title, in a lighter text. */
  readonly hint?: ReactNode;
  /** What the header shows at its right end. */
  readonly aside?: ReactNode;
  /** Classes to add to those of a card, such as `tbl` for a table. */
  readonly className?: string;
  /** Its identifier, for a link to lead to it. */
  readonly id?: string;
  /** Its content. */
  readonly children: ReactNode;
}

/**
 * A bordered surface, with a header when it has a title.
 *
 * @param props - The header and the content of the card.
 * @returns The card.
 */
export function Card({ title, hint, aside, className, id, children }: CardProps): ReactNode {
  return (
    <section className={className === undefined ? "card" : `card ${className}`} id={id}>
      {title !== undefined && (
        <div className="hd">
          <span>{title}</span>
          {hint !== undefined && (
            <span className="sub">
              <span className="sub-sep">· </span>
              {hint}
            </span>
          )}
          {aside !== undefined && <span className="right">{aside}</span>}
        </div>
      )}
      {children}
    </section>
  );
}
