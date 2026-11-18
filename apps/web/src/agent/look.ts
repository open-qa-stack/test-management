import type { ActionLook } from "@open-qa-stack/domain/sessions";

/** A file an agent reads or writes: its path and its lines. */
export interface CodeLook {
  readonly kind: "code";
  /** The path of the file. */
  readonly file: string;
  /** Its lines. */
  readonly lines: readonly string[];
  /** What the look shows, in a sentence. */
  readonly caption: string;
}

/** A text an agent reads: the page a browser tool rendered for it, a piece of knowledge. */
export interface DocumentLook {
  readonly kind: "document";
  /** Where the excerpt comes from. */
  readonly source: string;
  /** The excerpt. */
  readonly excerpt: readonly string[];
  /** What the look shows, in a sentence. */
  readonly caption: string;
}

/** What an agent looks at when it acts, as the side of a session draws it. */
export type Look = CodeLook | DocumentLook;

/**
 * Reads what an agent had before its eyes as the side of the session draws it.
 *
 * @param look - What the action ended on: the file the agent handed in, or the page a tool rendered for it.
 * @returns The file as code, the page as a document, each with what it shows in a sentence.
 */
export function lookOf(look: ActionLook): Look {
  return look.kind === "file"
    ? { kind: "code", file: look.name, lines: look.lines, caption: "Le test que l’agent a remis." }
    : { kind: "document", source: look.name, excerpt: look.lines, caption: "La page, telle que l’outil l’a rendue à l’agent." };
}
