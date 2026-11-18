import type { PersonMessage } from "@open-qa-stack/domain";
import type { Inbox } from "@open-qa-stack/agents";

/**
 * The inbox of the execution of a session, kept in memory: what a person said to the session, as the agents
 * of its run read it at each of their steps.
 *
 * @remarks
 * The store of the sessions numbers a message when it takes it; the inbox is then dropped the message, and
 * holds it until an agent received it. An execution that starts is dropped the messages its session was
 * sent while it waited, as the store kept them, and at each beat of its host those the store took since,
 * which is how what another process said reaches it. A message may so be dropped more than once — by
 * whoever said it, and among those the store kept — and enters once: its number tells it from the others. The agents
 * read the messages in the order of their numbers, whatever the order they were dropped in.
 */
export class SessionInbox implements Inbox {
  readonly #known = new Set<number>();
  readonly #waiting: PersonMessage[] = [];
  readonly #received: PersonMessage[] = [];

  /**
   * Hands the inbox a message the store took.
   *
   * @param message - The message, under the number the store gave it; one the inbox already holds is ignored.
   */
  drop(message: PersonMessage): void {
    if (this.#known.has(message.number)) return;
    this.#known.add(message.number);
    this.#waiting.push({ number: message.number, text: message.text });
    this.#waiting.sort((one, other) => one.number - other.number);
  }

  /** {@inheritDoc @open-qa-stack/agents#Inbox.pending} */
  pending(): readonly PersonMessage[] {
    return [...this.#waiting];
  }

  /** {@inheritDoc @open-qa-stack/agents#Inbox.heard} */
  heard(): readonly PersonMessage[] {
    return [...this.#received];
  }

  /** {@inheritDoc @open-qa-stack/agents#Inbox.delivered} */
  delivered(through: number): void {
    this.#received.push(...this.#waiting.splice(0, this.#waiting.filter((message) => message.number <= through).length));
  }
}
