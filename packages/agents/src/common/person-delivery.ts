import { ImageToolResult, type ToolDefinition } from "@open-qa-stack/domain";
import type { PersonInbox } from "./person-inbox.ts";
import { PERSON_SAID_EARLIER, PERSON_SPOKE, personTags, type PersonMessage } from "./person-message.ts";

/**
 * Gives one session the messages the person sends while it is open: each message of the inbox goes to the
 * session that asks first, once, and is recorded as it goes.
 *
 * @remarks
 * A message reaches the agent at the first moment the harness speaks to it: with the result of the tool
 * that returns next, under `person`, or in a message of the harness. Only a session that leads a step of a
 * run is given a delivery; a session nested in the call of a tool, or one of several run at once, has none,
 * and the messages wait for the next session that leads.
 *
 * What the person said amends the request for the rest of the run, not for the one session that received
 * it: a session that opens later is recalled the messages delivered before it, which are recorded no more,
 * each having been delivered once.
 */
export class PersonDelivery {
  private readonly inbox: PersonInbox;
  private readonly record: (message: PersonMessage) => void;
  private readonly listening: () => boolean;

  /**
   * @param inbox - The inbox of the run.
   * @param record - Receives each message as it is delivered, for the trace of the session.
   * @param listening - Whether the session may still act on a message; always by default. Once it may not,
   * it is given none, and the messages wait for the next session.
   */
  public constructor(inbox: PersonInbox, record: (message: PersonMessage) => void, listening: () => boolean = () => true) {
    this.inbox = inbox;
    this.record = record;
    this.listening = listening;
  }

  /**
   * The messages the sessions of the run received so far, as the request of a session that opens recalls them.
   *
   * @returns The messages under a sentence that says they were said earlier and still hold; `undefined` when
   * no message was delivered yet.
   */
  public recalled(): string | undefined {
    const heard = this.inbox.heard();
    return heard.length === 0 ? undefined : `${PERSON_SAID_EARLIER}\n${personTags(heard)}`;
  }

  /**
   * Delivers the pending messages as a message of the harness.
   *
   * @returns What to send, the messages under a sentence that says where they come from; `undefined` when none is pending.
   */
  public spoken(): string | undefined {
    const tags = this.take();
    return tags === undefined ? undefined : `${PERSON_SPOKE}\n${tags}`;
  }

  /**
   * The tools of the session, each delivering the messages pending when it returns.
   *
   * @param tools - The tools of the session.
   * @returns Them, the result of a call carrying the messages under `person`. A result that is no object,
   * or that has a `person` of its own, is put under `result` beside them.
   */
  public heard(tools: readonly ToolDefinition[]): ToolDefinition[] {
    return tools.map((tool) => ({
      ...tool,
      execute: async (args) => {
        const result = await tool.execute(args);
        const person = this.take();
        return person === undefined ? result : carrying(result, person);
      },
    }));
  }

  /** The pending messages between their tags, marked as delivered and recorded; `undefined` when there is none, or the session listens no more. */
  private take(): string | undefined {
    const messages = this.listening() ? this.inbox.pending() : [];
    if (messages.length === 0) return undefined;
    this.inbox.delivered(messages.at(-1)!.number);
    for (const message of messages) this.record(message);
    return personTags(messages);
  }
}

/** The result of a tool with the messages of the person beside what it returned. */
function carrying(result: unknown, person: string): unknown {
  // The image of a result goes on to the model: only what is read with it gains the messages.
  if (result instanceof ImageToolResult) return new ImageToolResult(carrying(result.value, person) as Readonly<Record<string, unknown>>, result.png);
  const plain = typeof result === "object" && result !== null && !Array.isArray(result) && !("person" in result);
  return plain ? { ...result, person } : { result, person };
}
