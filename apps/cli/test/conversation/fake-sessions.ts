import { UnknownSessionError } from "@open-qa-stack/domain";
import type { KnowledgeRemap, MessageReceipt, Session, SessionEvent, SessionMessage, SessionOpening } from "@open-qa-stack/domain/sessions";
import type { EventListener, SessionEventStream } from "@open-qa-stack/engine";
import type { ConversationSessions } from "../../src/conversation/conversation.ts";

/**
 * The operations on sessions, as a conversation calls them, with nothing behind: a test says what each
 * answers, tells the events of a session when it wants, and reads what was asked.
 */
export class FakeSessions implements ConversationSessions {
  /** The sessions the instance holds, the latest first. */
  readonly held: Session[];
  /** What was asked to open. */
  readonly openings: SessionOpening[] = [];
  /** What was said, and to which session. */
  readonly said: (readonly [string, string])[] = [];
  /** What resumed a session once it ended, and which session. */
  readonly resumed: (readonly [string, string])[] = [];
  /** The sessions that were asked to stop. */
  readonly interrupted: string[] = [];
  /** The rank each following of the events of a session started after, in order. */
  readonly after: number[] = [];
  /** The sessions whose events are followed now. */
  readonly followed = new Map<string, EventListener>();
  /** The sessions whose events were followed, then left. */
  readonly left: string[] = [];
  /** What the next call of an operation rejects with, by the name of the operation. */
  readonly failing = new Map<keyof ConversationSessions, Error>();
  /** The session the next opening gives. */
  next: Session | undefined;
  /** The sources asked to be mapped again, `undefined` for every source. */
  readonly remaps: (string | undefined)[] = [];
  /** What the next request to map the knowledge again gives. */
  nextRemap: KnowledgeRemap | undefined;
  /** Holds the answer of `events` until a test lets it go, when set. */
  gate: Promise<void> | undefined;

  /** @param held - The sessions the instance holds, the latest first. */
  constructor(held: readonly Session[] = []) {
    this.held = [...held];
  }

  /** Rejects with what a test said the operation fails with, once. */
  #fail(operation: keyof ConversationSessions): void {
    const error = this.failing.get(operation);
    this.failing.delete(operation);
    if (error !== undefined) throw error;
  }

  async open(opening: SessionOpening): Promise<Session> {
    this.#fail("open");
    this.openings.push(opening);
    const session = this.next!;
    this.held.unshift(session);
    return session;
  }

  async remap(source?: string): Promise<KnowledgeRemap> {
    this.#fail("remap");
    this.remaps.push(source);
    const remap = this.nextRemap!;
    if (remap.state === "opened") this.held.unshift(remap.session);
    return remap;
  }

  async say(id: string, message: SessionMessage): Promise<MessageReceipt> {
    this.#fail("say");
    this.said.push([id, message.text]);
    return { number: this.said.length };
  }

  async resume(id: string, message: SessionMessage): Promise<Session> {
    this.#fail("resume");
    this.resumed.push([id, message.text]);
    const at = this.held.findIndex((held) => held.id === id);
    const { result: _before, ...session } = this.held[at]!;
    this.held[at] = { ...session, state: "running" };
    return this.held[at];
  }

  async interrupt(id: string): Promise<void> {
    this.#fail("interrupt");
    this.interrupted.push(id);
  }

  async sessions(): Promise<Session[]> {
    this.#fail("sessions");
    return [...this.held];
  }

  async session(id: string): Promise<Session> {
    this.#fail("session");
    const session = this.held.find((held) => held.id === id);
    if (session === undefined) throw new UnknownSessionError(id);
    return session;
  }

  async events(id: string, after: number): Promise<SessionEventStream> {
    this.#fail("events");
    this.after.push(after);
    await this.gate;
    return {
      subscribe: (listener: EventListener) => {
        this.followed.set(id, listener);
        return () => {
          this.followed.delete(id);
          this.left.push(id);
        };
      },
    } as SessionEventStream;
  }

  /** Tells events of a session to whoever follows it, in one go. */
  tell(id: string, events: readonly SessionEvent[]): void {
    for (const event of events) this.followed.get(id)!.event(event);
  }

  /** Ends a session as it came to, and tells so to whoever follows it. */
  end(session: Session): void {
    this.held.splice(
      this.held.findIndex(({ id }) => id === session.id),
      1,
      session,
    );
    this.followed.get(session.id)!.ended();
  }
}
