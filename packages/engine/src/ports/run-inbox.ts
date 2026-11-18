import type { Inbox } from "@open-qa-stack/agents";

/**
 * The inbox of a run: the messages a person sends to its agents while it is going, wherever the host of the
 * engine takes them from.
 *
 * @remarks
 * A run never stops for its inbox: one that cannot be read gives no message, and says why for the run to tell.
 */
export interface RunInbox extends Inbox {
  /** Why the messages could not be read, the first time they could not; `undefined` while every reading succeeded. */
  readonly unreadable: string | undefined;
}
