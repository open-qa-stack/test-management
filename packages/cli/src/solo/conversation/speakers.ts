import type { Speaker } from "@open-qa-stack/domain/sessions";
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

/** The identity of everyone a session shows. The three reviewers share a tone, and are told apart by their mark and their name. */
export const IDENTITIES: Readonly<Record<Speaker, Identity>> = {
  user: { name: "You", mark: "›", ascii: ">", tone: "person" },
  cartographer: { name: "Cartographer", mark: "◇", ascii: "~", tone: "cartographer" },
  planner: { name: "Planner", mark: "◆", ascii: "*", tone: "planner" },
  plan_reviewer: { name: "Plan reviewer", mark: "▽", ascii: "?", tone: "reviewer" },
  writer: { name: "Writer", mark: "●", ascii: "+", tone: "writer" },
  coherence_reviewer: { name: "Coherence reviewer", mark: "△", ascii: "=", tone: "reviewer" },
  code_reviewer: { name: "Code reviewer", mark: "□", ascii: "#", tone: "reviewer" },
  harness: { name: "Harness", mark: "■", ascii: "|", tone: "harness" },
};
