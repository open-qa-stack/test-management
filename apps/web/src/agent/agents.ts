import type { Speaker } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import type { IconName } from "../ui/icon.tsx";

/** How the console shows who speaks: a name, a role, an icon and a colour family. */
export interface Identity {
  /** The name shown beside what it says. */
  readonly name: string;
  /** What it is there for, in a few words. */
  readonly role: string;
  readonly icon: IconName;
  /** The colour family of its mark. */
  readonly tone: "primary" | "ai" | "ok" | "warn" | "neutral";
}

/** The icon and the colour family of everyone a session shows. */
const MARKS: Readonly<Record<Speaker, Pick<Identity, "icon" | "tone">>> = {
  user: { icon: "home", tone: "primary" },
  cartographer: { icon: "discovery", tone: "ai" },
  planner: { icon: "layers", tone: "ai" },
  writer: { icon: "pen", tone: "primary" },
  plan_reviewer: { icon: "copy", tone: "warn" },
  coherence_reviewer: { icon: "eye", tone: "ok" },
  code_reviewer: { icon: "code", tone: "ok" },
  harness: { icon: "shield", tone: "neutral" },
};

/**
 * Tells who speaks in a session.
 *
 * @param speaker - The person, an agent or the harness.
 * @returns Its identity, its name and its role in the language of the console.
 */
export function identityOf(speaker: Speaker): Identity {
  return { name: t(`speakers.${speaker}.name`), role: t(`speakers.${speaker}.role`), ...MARKS[speaker] };
}

/** Everyone but the person, in the order they come into a session. */
export const AGENTS: readonly Speaker[] = ["cartographer", "planner", "plan_reviewer", "writer", "coherence_reviewer", "code_reviewer", "harness"];
