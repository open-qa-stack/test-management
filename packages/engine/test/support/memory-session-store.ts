import {
  ASKED_STATE,
  MessageNotPendingError,
  refusalOf,
  SESSION_LIFE,
  SessionEndedError,
  SessionStateError,
  UnknownSessionError,
  type AddressedCommand,
  type PendingMessage,
  type SessionStorePort,
} from "@open-qa-stack/domain";
import type { AgentRole, MessageReceipt, Project, Session, SessionEvent, SessionOpening, SessionResult, UnrankedEvent } from "@open-qa-stack/domain/sessions";

/** What the store keeps of one session. */
interface Kept {
  session: Session;
  readonly events: SessionEvent[];
  readonly messages: (PendingMessage & { deliveredTo?: AgentRole })[];
  /** The process that hosts the session, and when it last beat, in milliseconds; `undefined` once its beat was withdrawn. */
  host: string;
  seen: number | undefined;
  /** Whether another process asked that the session be interrupted. */
  asked: boolean;
}

/**
 * The store of the sessions kept in memory, by the rules of the life of a session: what the operations are
 * tested on, without a database.
 *
 * @remarks
 * A test puts the operations before what a database does at times through `before`, called with the name of
 * each command and query before it is answered: what it throws refuses it, what it awaits holds it.
 */
export class MemorySessionStore implements SessionStorePort {
  /** Called before a command or a query is answered, with its name and the session it names, when it names one. */
  before: (command: string, id?: string) => Promise<void> | void = () => undefined;
  /** How many times each command or query was answered. */
  readonly answered = new Map<string, number>();
  readonly #kept = new Map<string, Kept>();
  #project: Project = { applications: [] };
  #asked = 0;
  readonly #clock: () => Date;

  /** @param clock - What dates what the store writes; the clock of the machine by default. */
  constructor(clock: () => Date = () => new Date()) {
    this.#clock = clock;
  }

  async #answer(command: string, id?: string): Promise<void> {
    await this.before(command, id);
    this.answered.set(command, (this.answered.get(command) ?? 0) + 1);
  }

  /** The session a command is for, once the life of a session lets the command through. */
  #taking(command: AddressedCommand, id: string): Kept {
    const kept = this.#kept.get(id);
    const refusal = refusalOf(command, kept?.session.state);
    if (kept === undefined) throw new UnknownSessionError(id);
    if (refusal === "session_ended") throw new SessionEndedError(id);
    if (refusal === "wrong_state") throw new SessionStateError(id, command, kept.session.state);
    return kept;
  }

  #tell(kept: Kept, events: readonly UnrankedEvent[], change: Partial<Session> = {}): void {
    for (const event of events) kept.events.push({ ...event, id: kept.events.length + 1 } as SessionEvent);
    kept.session = { ...kept.session, ...change, lastEventAt: events.at(-1)?.at ?? kept.session.lastEventAt };
  }

  #now(): string {
    return this.#clock().toISOString();
  }

  /** Whether the host of a session went silent: its beat was withdrawn, or is older than the silence allows. */
  #silent({ seen }: Kept, silentForMs: number): boolean {
    return seen === undefined || seen < this.#clock().getTime() - silentForMs;
  }

  /** The sessions in one state, in the order they were asked for. */
  #in(state: Session["state"]): Kept[] {
    return [...this.#kept.values()].filter((kept) => kept.session.state === state);
  }

  async saveProject(saved: Project): Promise<void> {
    await this.#answer("saveProject");
    this.#project = saved;
  }

  async ask(opening: SessionOpening, host: string): Promise<Session> {
    await this.#answer("ask");
    const at = this.#now();
    this.#asked += 1;
    const session: Session = { id: `session-${this.#asked}`, ...opening, openedAt: at, lastEventAt: at, state: ASKED_STATE };
    const events: SessionEvent[] = [{ id: 1, at, type: "user_message", text: opening.request }];
    this.#kept.set(session.id, { session, events, messages: [], host, seen: this.#clock().getTime(), asked: false });
    return session;
  }

  async start(id: string, host: string): Promise<Session> {
    await this.#answer("start", id);
    const kept = this.#taking("start", id);
    kept.host = host;
    kept.seen = this.#clock().getTime();
    this.#tell(kept, [{ at: this.#now(), type: "state_changed", state: SESSION_LIFE.start.to }], { state: SESSION_LIFE.start.to });
    return kept.session;
  }

  async append(id: string, events: readonly UnrankedEvent[]): Promise<void> {
    await this.#answer("append", id);
    this.#tell(this.#taking("append", id), events);
  }

  async complete(id: string, result: SessionResult): Promise<void> {
    await this.#answer("complete", id);
    this.#tell(this.#taking("complete", id), [{ at: this.#now(), type: "state_changed", state: "completed", result }], { state: "completed", result });
  }

  async interrupt(id: string): Promise<void> {
    await this.#answer("interrupt", id);
    this.#tell(this.#taking("interrupt", id), [{ at: this.#now(), type: "state_changed", state: "interrupted" }], { state: "interrupted" });
  }

  async say(id: string, text: string): Promise<MessageReceipt> {
    await this.#answer("say", id);
    const kept = this.#taking("say", id);
    const at = this.#now();
    const number = kept.messages.length + 1;
    kept.messages.push({ number, at, text });
    this.#tell(kept, [{ at, type: "user_message", text, number }]);
    return { number };
  }

  async resume(id: string, text: string, host: string): Promise<Session> {
    await this.#answer("resume", id);
    const kept = this.#taking("resume", id);
    const at = this.#now();
    const { result: _before, ...session } = kept.session;
    kept.session = session;
    Object.assign(kept, { host, seen: this.#clock().getTime(), asked: false });
    this.#tell(
      kept,
      [
        { at, type: "user_message", text },
        { at, type: "state_changed", state: SESSION_LIFE.resume.to },
      ],
      { state: SESSION_LIFE.resume.to },
    );
    return kept.session;
  }

  async deliver(id: string, number: number, agent: AgentRole): Promise<void> {
    await this.#answer("deliver", id);
    const kept = this.#taking("deliver", id);
    const message = kept.messages.find((held) => held.number === number && held.deliveredTo === undefined);
    if (message === undefined) throw new MessageNotPendingError(id, number);
    message.deliveredTo = agent;
    this.#tell(kept, [{ at: this.#now(), type: "message_delivered", message: number, agent }]);
  }

  async requestInterruption(id: string, silentForMs: number): Promise<void> {
    await this.#answer("requestInterruption", id);
    const kept = this.#taking("interrupt", id);
    if (kept.session.state === "running" && !this.#silent(kept, silentForMs)) kept.asked = true;
    else this.#tell(kept, [{ at: this.#now(), type: "state_changed", state: "interrupted" }], { state: "interrupted" });
  }

  async beat(host: string): Promise<void> {
    await this.#answer("beat");
    for (const kept of [...this.#in("queued"), ...this.#in("running")]) if (kept.host === host) kept.seen = this.#clock().getTime();
  }

  async release(host: string): Promise<void> {
    await this.#answer("release");
    for (const kept of [...this.#in("queued"), ...this.#in("running")]) if (kept.host === host) kept.seen = undefined;
  }

  async takeOver(host: string, silentForMs: number): Promise<string[]> {
    await this.#answer("takeOver");
    const taken = this.#in("queued").filter((kept) => this.#silent(kept, silentForMs));
    for (const kept of taken) Object.assign(kept, { host, seen: this.#clock().getTime() });
    return taken.map((kept) => kept.session.id);
  }

  async abandonSilent(silentForMs: number): Promise<string[]> {
    await this.#answer("abandonSilent");
    const left = this.#in("running").filter((kept) => this.#silent(kept, silentForMs));
    for (const kept of left) this.#tell(kept, [{ at: this.#now(), type: "state_changed", state: "interrupted" }], { state: "interrupted" });
    return left.map((kept) => kept.session.id);
  }

  async project(): Promise<Project> {
    await this.#answer("project");
    return this.#project;
  }

  async sessions(): Promise<Session[]> {
    await this.#answer("sessions");
    return [...this.#kept.values()].map((kept) => kept.session).reverse();
  }

  async session(id: string): Promise<Session | undefined> {
    await this.#answer("session", id);
    return this.#kept.get(id)?.session;
  }

  async lastRank(id: string): Promise<number> {
    await this.#answer("lastRank", id);
    return this.#kept.get(id)?.events.length ?? 0;
  }

  async eventsAfter(id: string, after: number): Promise<SessionEvent[]> {
    await this.#answer("eventsAfter", id);
    const events = this.#kept.get(id)?.events ?? [];
    return events.filter((event) => event.id > after || event.type === "state_changed");
  }

  async interruptionRequests(host: string): Promise<string[]> {
    await this.#answer("interruptionRequests");
    return [...this.#in("queued"), ...this.#in("running")].filter((kept) => kept.host === host && kept.asked).map((kept) => kept.session.id);
  }

  async pendingMessages(id: string): Promise<PendingMessage[]> {
    await this.#answer("pendingMessages", id);
    const messages = this.#kept.get(id)?.messages ?? [];
    return messages.filter((message) => message.deliveredTo === undefined).map(({ number, at, text }) => ({ number, at, text }));
  }
}
