import type { Speaker } from "@open-qa-stack/domain/sessions";
import { t } from "./i18n/i18n.ts";
import type { Tone } from "./palette.ts";

/** How the conversation shows who speaks: a name, a mark that tells it from the others without colour, and a tone. */
export interface Identity {
  /** The name written at the head of what it says and does. */
  readonly name: string;
  /** Its mark in the gutter. */
  readonly mark: string;
  /** Its mark in a terminal that draws ASCII alone. */
  readonly ascii: string;
  readonly tone: Tone;
}

/** The marks and the tone of everyone a session shows. The three reviewers share a tone, and are told apart by their mark and their name. */
const MARKS: Readonly<Record<Speaker, Omit<Identity, "name">>> = {
  user: { mark: "›", ascii: ">", tone: "person" },
  cartographer: { mark: "◇", ascii: "~", tone: "cartographer" },
  planner: { mark: "◆", ascii: "*", tone: "planner" },
  plan_reviewer: { mark: "▽", ascii: "?", tone: "reviewer" },
  writer: { mark: "●", ascii: "+", tone: "writer" },
  coherence_reviewer: { mark: "△", ascii: "=", tone: "reviewer" },
  code_reviewer: { mark: "□", ascii: "#", tone: "reviewer" },
  harness: { mark: "■", ascii: "|", tone: "harness" },
};

/**
 * Tells who speaks in a session.
 *
 * @param speaker - The person, an agent or the harness.
 * @returns Its identity, its name in the language of the conversation.
 */
export function identityOf(speaker: Speaker): Identity {
  return { name: t(`speakers.${speaker}`), ...MARKS[speaker] };
}
