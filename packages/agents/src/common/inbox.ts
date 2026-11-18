import type { PersonMessage } from "@open-qa-stack/domain";

/**
 * The messages a person sends to a run while it is going, as its sessions take them: whoever hosts the run
 * says where they come from, such as the conversation of an instance.
 *
 * @remarks
 * The messages are numbered from 1 in the order they were sent, and a number always names the same message.
 * Reading waits for nothing, so that who reads the pending messages and marks them as delivered at once gives
 * each to one session, once. A message delivered is kept: what the person said stands for the rest of the
 * run, and the sessions that open later are told it again.
 */
export interface Inbox {
  /**
   * The messages no session received yet.
   *
   * @returns Them, in the order they were sent, those sent since the last reading included.
   */
  pending(): readonly PersonMessage[];

  /**
   * The messages a session received already, since the run started.
   *
   * @returns Them, in the order they were sent.
   */
  heard(): readonly PersonMessage[];

  /**
   * Marks messages as received by a session: they are pending no more, and are heard from then on.
   *
   * @param through - The number of the last message received.
   */
  delivered(through: number): void;
}
