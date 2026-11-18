import { withoutClosing } from "./tag-closing.ts";

/** Name of the tag the words of the person are given to an agent between. */
export const PERSON_TAG = "person-message";

/** A message a person sent to a run while it was going. */
export interface PersonMessage {
  /** Its rank in the inbox of the run, from 1, in the order the messages were written. */
  readonly number: number;
  /** What the person says. */
  readonly text: string;
}

/**
 * Writes messages of the person as an agent reads them.
 *
 * @param messages - The messages, in order.
 * @returns A line per message, each between tags that bear its number, its text unable to close them.
 */
export function personTags(messages: readonly PersonMessage[]): string {
  return messages.map(({ number, text }) => `<${PERSON_TAG} number="${number}">${withoutClosing(text, PERSON_TAG)}</${PERSON_TAG}>`).join("\n");
}
