import type { ReactNode } from "react";

/** The colour family of a badge: what it says of the thing it marks. */
export type BadgeTone = "ok" | "ko" | "warn" | "ai" | "info" | "neutral" | "outline";

/** What a badge needs. */
export interface BadgeProps {
  /** Its colour family. */
  readonly tone: BadgeTone;
  /** Whether its corners are square, as for the mark of an application. */
  readonly square?: boolean;
  /** Its label. */
  readonly children: ReactNode;
}

/**
 * A short label on a tinted background, with a dot of its colour.
 *
 * @param props - The tone and the label.
 * @returns The badge.
 */
export function Badge({ tone, square = false, children }: BadgeProps): ReactNode {
  return <span className={`badge ${tone}${square ? " sq" : ""}`}>{children}</span>;
}
