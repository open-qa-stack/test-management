import type { ReactNode } from "react";
import { Icon } from "../ui/icon.tsx";
import { IDENTITIES } from "./agents.ts";
import type { Speaker } from "@open-qa-stack/domain/sessions";

/** What the mark of a speaker needs. */
export interface SpeakerMarkProps {
  readonly speaker: Speaker;
  /** Whether the speaker is speaking or acting now, which makes the mark pulse. */
  readonly active?: boolean;
  /** Its size: `sm` in a line of text, `md` at the head of a turn, `lg` where the agents are introduced. */
  readonly size?: "sm" | "md" | "lg";
}

/** The size of the icon of a mark, in pixels. */
const ICONS = { sm: 12, md: 16, lg: 24 } as const;

/**
 * The mark of who speaks: its icon, on the colour of its family, as the picture of a member of a team.
 *
 * @param props - The speaker, its size, and whether it is active.
 * @returns The mark.
 */
export function SpeakerMark({ speaker, active = false, size = "md" }: SpeakerMarkProps): ReactNode {
  const { icon, tone } = IDENTITIES[speaker];
  return (
    <span className={`speaker-mark ${size} tone-${tone}${active ? " active" : ""}`} aria-hidden="true">
      <Icon name={icon} size={ICONS[size]} />
    </span>
  );
}
