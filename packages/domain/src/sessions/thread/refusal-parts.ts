import type { ActionLook } from "../session-event.ts";

/** What a refusal of the harness says, read by the form the harness writes it in. */
export interface RefusalParts {
  /** The tool whose call was refused, when the refusal opens on its name: `propose_plan: …`. */
  readonly tool?: string;
  /** What was refused, when the refusal opens on it: `The plan was refused by the harness: …`. */
  readonly subject?: string;
  /** Why, and what to do: the refusal without what it opens on and without the page it quotes. */
  readonly reason: string;
  /** The page the refusal quotes, as the browser saw it when the call was refused. */
  readonly page?: ActionLook;
}

/** What a refusal opens on, before its reason: the name of a tool, or a sentence that says what was refused. */
const OPENING = /^([^\n:]{1,160}): (?=\S)/;

/** The name of a tool. */
const TOOL = /^[a-z][a-z0-9_]*$/;

/** The page a refusal quotes: from its address to the first blank line or to its end. */
const PAGE = /\n\nThe page is now at (\S+):\n((?:.+(?:\n|$))+)/;

/**
 * Reads a refusal of the harness by its form: what it opens on — a tool, or what was refused — its reason, and
 * the page it quotes. Nothing of it is lost: what follows the page is kept in the reason, after a blank line.
 *
 * @param text - The refusal, whole.
 * @returns Its parts; the whole text as its reason when it has no known form.
 */
export function refusalParts(text: string): RefusalParts {
  const opening = OPENING.exec(text);
  const head = opening?.[1];
  const body = opening === null ? text : text.slice(opening[0].length);
  const quoted = PAGE.exec(body);
  const parts = quoted === null ? [body] : [body.slice(0, quoted.index), body.slice(quoted.index + quoted[0].length)];
  const reason = parts
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join("\n\n");
  return {
    ...(head === undefined ? {} : TOOL.test(head) ? { tool: head } : { subject: head }),
    reason,
    ...(quoted === null ? {} : { page: { kind: "page", name: quoted[1]!, lines: quoted[2]!.replace(/\n$/, "").split("\n") } }),
  };
}
