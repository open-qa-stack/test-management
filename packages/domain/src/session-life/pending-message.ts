/** A message a person sent to a session, which no agent received yet. */
export interface PendingMessage {
  /** Its number in the session, from 1. */
  readonly number: number;
  /** When the person sent it, as an ISO 8601 date. */
  readonly at: string;
  /** What the person says to the agents. */
  readonly text: string;
}
