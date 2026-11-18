import type { ReactNode } from "react";

/** What an empty state needs. */
export interface EmptyStateProps {
  /** What is missing, in a few words. */
  readonly title: string;
  /** Why, and what to do about it. */
  readonly children?: ReactNode;
  /** What it offers to do. */
  readonly action?: ReactNode;
}

/**
 * What a list or a page shows when it has nothing to show.
 *
 * @param props - The title, the explanation and the action.
 * @returns The empty state.
 */
export function EmptyState({ title, children, action }: EmptyStateProps): ReactNode {
  return (
    <div className="state">
      <b>{title}</b>
      {children !== undefined && <span>{children}</span>}
      {action}
    </div>
  );
}
