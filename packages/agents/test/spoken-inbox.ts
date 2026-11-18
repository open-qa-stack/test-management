import type { PersonMessage } from "@open-qa-stack/domain";
import type { Inbox } from "../src/index.ts";

/** What a person said to each inbox of the tests, by the name of the inbox, in the order they said it. */
const SAID = new Map<string, string[]>();

/** Says something to the inbox of a run, as the person who follows the run does. */
export function say(inbox: string, text: string): void {
  SAID.set(inbox, [...(SAID.get(inbox) ?? []), text]);
}

/**
 * The inbox of a run as the tests of the agents feed it: the messages a person says to it, numbered from 1 in
 * the order they were said, held until a session received them and kept afterwards.
 */
export class SpokenInbox implements Inbox {
  readonly #name: string;
  /** The number of the last message a session received. */
  #through = 0;

  /** @param name - What names the inbox to whoever speaks to it. */
  constructor(name: string) {
    this.#name = name;
  }

  #said(): PersonMessage[] {
    return (SAID.get(this.#name) ?? []).map((text, index) => ({ number: index + 1, text }));
  }

  pending(): readonly PersonMessage[] {
    return this.#said().slice(this.#through);
  }

  heard(): readonly PersonMessage[] {
    return this.#said().slice(0, this.#through);
  }

  delivered(through: number): void {
    this.#through = Math.max(this.#through, Math.min(through, this.#said().length));
  }
}
