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
import { instant, jsonOf, storedJson } from "../database/stored-values.ts";
import { newSessionId } from "./session-id.ts";
import type { AgentRole, MessageReceipt, Project, Session, SessionEvent, SessionOpening, SessionResult, UnrankedEvent } from "@open-qa-stack/domain/sessions";
import type { ExpressionBuilder, Kysely, Selectable, Updateable } from "kysely";
import type { Database } from "../database/database.ts";
import type { SessionsTable, StoreSchema } from "../database/schema.ts";

/** What runs statements: the database, or one transaction on it. */
type Statements = Kysely<StoreSchema>;

/** A row of the sessions, as it is read. */
type SessionRow = Selectable<SessionsTable>;

/** What a command changes of the row of a session, besides the date of its last event. */
type SessionChange = Pick<Updateable<SessionsTable>, "state" | "result" | "host" | "host_seen_at" | "interruption_requested_at">;

/** A row of the sessions as the session it holds: what is absent is left out, dates are ISO 8601. */
function sessionOf({ id, request, environment, opened_at, last_event_at, state, result }: SessionRow): Session {
  return {
    id,
    ...(request === null ? {} : { request }),
    ...(environment === null ? {} : { environment }),
    openedAt: instant(opened_at),
    lastEventAt: instant(last_event_at),
    state,
    ...(result === null ? {} : { result: jsonOf(result) }),
  };
}

/**
 * The project, the sessions, their events and the messages sent to them, as the database of the instance
 * keeps them: the truth of what the process that hosts the sessions does.
 *
 * @remarks
 * A session is asked for, started by its host, told event after event, sent messages, then ended, and
 * resumed for another turn when the person says more to it. Each of these commands is one transaction. Which states a command is for, and the state it leaves the session in,
 * are what `SESSION_LIFE` says: the statements here are what holds them when two commands reach a session at
 * the same moment. A command on a session writes to its row first: two commands on the same session run one
 * after the other, so that each event takes the rank that follows the last and each message the number that
 * follows the last, without a gap nor a rank given twice. The statements are the same on every database the
 * store supports. The store notifies no one: whoever sends a command knows what it changed. What the store
 * dates, it dates by the clock of the process that runs the command.
 *
 * Several processes may reach the same database, each with a store of its own. A session bears its host, the
 * process that asked for it or took it over, and the date of the last beat of that host: a host is silent
 * when its beat is empty or older than the time the command that asks is given, by the clock of the process
 * that asks.
 */
export class SessionStore implements SessionStorePort {
  readonly #database: Kysely<StoreSchema>;
  readonly #clock: () => Date;

  /**
   * @param database - The database of the instance, with its migrations applied.
   * @param clock - What tells the date; the clock of the machine by default.
   */
  constructor(database: Database, clock: () => Date = () => new Date()) {
    this.#database = database.kysely;
    this.#clock = clock;
  }

  /** @returns The project; one without name nor application when none was saved. */
  async project(): Promise<Project> {
    const saved = await this.#database.selectFrom("project").select(["name", "applications"]).executeTakeFirst();
    if (saved === undefined) return { applications: [] };
    return { ...(saved.name === null ? {} : { name: saved.name }), applications: jsonOf(saved.applications) };
  }

  /**
   * Saves the project, in place of the one saved before.
   *
   * @param saved - The project as it is now.
   */
  async saveProject(saved: Project): Promise<void> {
    const row = { name: saved.name ?? null, applications: storedJson(saved.applications) };
    await this.#database
      .insertInto("project")
      .values(row)
      .onConflict((conflict) => conflict.column("only").doUpdateSet(row))
      .execute();
  }

  /** @returns Every session, the latest opened first. */
  async sessions(): Promise<Session[]> {
    const rows = await this.#database.selectFrom("sessions").selectAll().orderBy("opened_at", "desc").orderBy("id", "desc").execute();
    return rows.map(sessionOf);
  }

  /**
   * @param id - The identifier of a session.
   * @returns The session; `undefined` when there is none.
   */
  async session(id: string): Promise<Session | undefined> {
    const row = await this.#database.selectFrom("sessions").selectAll().where("id", "=", id).executeTakeFirst();
    return row === undefined ? undefined : sessionOf(row);
  }

  /**
   * @param id - The identifier of a session.
   * @returns The rank of its last event; 0 when it has none, or does not exist.
   */
  lastRank(id: string): Promise<number> {
    return this.#lastRank(this.#database, id);
  }

  /**
   * Reads what a client that already got the first events of a session is still to be told.
   *
   * @param id - The identifier of a session.
   * @param after - The rank of the last event already told; 0 for every event.
   * @returns In the order of their ranks, the events after that rank, and the changes of state up to it:
   * whoever follows a session must learn that it ended even when that was told before the rank it resumes after.
   */
  async eventsAfter(id: string, after: number): Promise<SessionEvent[]> {
    const rows = await this.#database
      .selectFrom("session_events")
      .select(["id", "at", "type", "payload"])
      .where("session_id", "=", id)
      .where((event) => event.or([event("id", ">", after), event("type", "=", "state_changed")]))
      .orderBy("id")
      .execute();
    return rows.map(({ id: rank, at, type, payload }) => ({ id: rank, at: instant(at), type, ...jsonOf(payload) }) as SessionEvent);
  }

  /**
   * @param id - The identifier of a session.
   * @returns The messages of the person no agent received yet, in the order of their numbers; none when the
   * session does not exist.
   */
  async pendingMessages(id: string): Promise<PendingMessage[]> {
    const rows = await this.#database
      .selectFrom("session_messages")
      .select(["number", "at", "text"])
      .where("session_id", "=", id)
      .where("delivered_to", "is", null)
      .orderBy("number")
      .execute();
    return rows.map(({ number, at, text }) => ({ number, at: instant(at), text }));
  }

  /**
   * @param host - What names a process that hosts sessions.
   * @returns The identifiers of the sessions it hosts that go on and whose interruption another process asked for.
   */
  async interruptionRequests(host: string): Promise<string[]> {
    const rows = await this.#database
      .selectFrom("sessions")
      .select("id")
      .where("host", "=", host)
      .where("state", "in", [...SESSION_LIFE.beat.from])
      .where("interruption_requested_at", "is not", null)
      .orderBy("id")
      .execute();
    return rows.map(({ id }) => id);
  }

  /**
   * Asks for a session: it waits, `queued`, until its host starts it, and its first event is what the person
   * asked.
   *
   * @param opening - What to test, and where.
   * @param host - What names the process that asks: the host of the session, which this is its first beat on.
   * @returns The session, under the identifier it was given.
   */
  async ask(opening: SessionOpening, host: string): Promise<Session> {
    const now = this.#clock();
    const at = instant(now);
    const { request, environment = null } = opening;
    const asked = { id: newSessionId(now), request, environment, opened_at: at, last_event_at: at, state: ASKED_STATE, result: null };
    const row = { ...asked, host, host_seen_at: at, interruption_requested_at: null };
    await this.#database.transaction().execute(async (transaction) => {
      await transaction.insertInto("sessions").values(row).execute();
      await this.#rank(transaction, row.id, [{ at, type: "user_message", text: request }]);
    });
    return sessionOf(row);
  }

  /**
   * Starts a session that waits: it becomes `running`, and an event tells so. Whoever starts it is its host
   * from then on.
   *
   * @param id - The identifier of the session.
   * @param host - What names the process that starts it.
   * @returns The session, now running.
   * @throws {@link UnknownSessionError} when there is no such session.
   * @throws {@link SessionEndedError} when the session no longer goes on.
   * @throws {@link SessionStateError} when the session runs already.
   */
  start(id: string, host: string): Promise<Session> {
    const at = instant(this.#clock());
    const state = SESSION_LIFE.start.to;
    return this.#advance(id, "start", async (transaction, found) => {
      await this.#tell(transaction, id, [{ at, type: "state_changed", state }], { state, host, host_seen_at: at });
      return sessionOf({ ...found, state, last_event_at: at });
    });
  }

  /**
   * Appends to a session that runs the events its work tells, at the ranks that follow its last event,
   * whatever else was written to the session meanwhile.
   *
   * @param id - The identifier of the session.
   * @param events - The events, in order.
   * @throws {@link UnknownSessionError} when there is no such session.
   * @throws {@link SessionEndedError} when the session no longer goes on: its work must stop.
   * @throws {@link SessionStateError} when the session still waits.
   */
  async append(id: string, events: readonly UnrankedEvent[]): Promise<void> {
    await this.#advance(id, "append", (transaction) => this.#tell(transaction, id, events));
  }

  /**
   * Ends a session whose work went to its end: it becomes `completed` with its result, and an event tells so
   * with that result.
   *
   * @param id - The identifier of the session.
   * @param result - What the session came to.
   * @throws {@link UnknownSessionError} when there is no such session.
   * @throws {@link SessionEndedError} when the session had already ended.
   * @throws {@link SessionStateError} when the session still waits.
   */
  async complete(id: string, result: SessionResult): Promise<void> {
    await this.#advance(id, "complete", (transaction) => this.#end(transaction, id, SESSION_LIFE.complete.to, { result: storedJson(result) }, { result }));
  }

  /**
   * Ends a session whose work stopped before its end, or never started: it becomes `interrupted`, and an
   * event tells so.
   *
   * @param id - The identifier of the session.
   * @throws {@link UnknownSessionError} when there is no such session.
   * @throws {@link SessionEndedError} when the session had already ended.
   */
  async interrupt(id: string): Promise<void> {
    await this.#advance(id, "interrupt", (transaction) => this.#end(transaction, id, SESSION_LIFE.interrupt.to));
  }

  /**
   * Takes a message a person sends to a session that goes on: the message waits for an agent under the number
   * that follows the last of its session, and an event tells it with that number.
   *
   * @param id - The identifier of the session.
   * @param text - What the person says to the agents.
   * @returns The receipt, which numbers the message in the session.
   * @throws {@link UnknownSessionError} when there is no such session.
   * @throws {@link SessionEndedError} when the session no longer goes on.
   */
  say(id: string, text: string): Promise<MessageReceipt> {
    const at = instant(this.#clock());
    return this.#advance(id, "say", async (transaction) => {
      const { last } = await transaction
        .selectFrom("session_messages")
        .select((message) => message.fn.max<number | null>("number").as("last"))
        .where("session_id", "=", id)
        .executeTakeFirstOrThrow();
      const number = (last ?? 0) + 1;
      await transaction.insertInto("session_messages").values({ session_id: id, number, at, text }).execute();
      await this.#tell(transaction, id, [{ at, type: "user_message", text, number }]);
      return { number };
    });
  }

  /**
   * Resumes a session that ended with what a person says more to it: it waits, `queued`, for its host to start
   * a new turn of work on that message, which an event tells as what was asked of the turn, without a number,
   * then another the change of state. The process that resumes it is its host from then on, with this as its
   * first beat on it; the session no longer holds the result of the turn before, which its completion told, and
   * an interruption asked while that turn ran is forgotten.
   *
   * @param id - The identifier of the session.
   * @param text - What the person asks of the new turn.
   * @param host - What names the process that resumes it.
   * @returns The session, now waiting.
   * @throws {@link UnknownSessionError} when there is no such session.
   * @throws {@link SessionStateError} when the session goes on: it takes a message instead.
   */
  resume(id: string, text: string, host: string): Promise<Session> {
    const at = instant(this.#clock());
    const state = SESSION_LIFE.resume.to;
    return this.#advance(id, "resume", async (transaction, found) => {
      const events: UnrankedEvent[] = [
        { at, type: "user_message", text },
        { at, type: "state_changed", state },
      ];
      await this.#tell(transaction, id, events, { state, result: null, host, host_seen_at: at, interruption_requested_at: null });
      return sessionOf({ ...found, state, result: null, last_event_at: at });
    });
  }

  /**
   * Marks a pending message of a session that runs as handed to an agent, which an event tells. A message is
   * delivered once.
   *
   * @param id - The identifier of the session.
   * @param number - The number of the message.
   * @param agent - The agent that received it.
   * @throws {@link UnknownSessionError} when there is no such session.
   * @throws {@link SessionEndedError} when the session no longer goes on.
   * @throws {@link SessionStateError} when the session still waits.
   * @throws {@link MessageNotPendingError} when the session holds no such message, or an agent already received it.
   */
  async deliver(id: string, number: number, agent: AgentRole): Promise<void> {
    const at = instant(this.#clock());
    await this.#advance(id, "deliver", async (transaction) => {
      const delivered = await transaction
        .updateTable("session_messages")
        .set({ delivered_to: agent, delivered_at: at })
        .where("session_id", "=", id)
        .where("number", "=", number)
        .where("delivered_to", "is", null)
        .returning("number")
        .execute();
      if (delivered.length === 0) throw new MessageNotPendingError(id, number);
      await this.#tell(transaction, id, [{ at, type: "message_delivered", message: number, agent }]);
    });
  }

  /**
   * Asks, from a process that may not be the one that runs it, that a session that goes on be interrupted. One
   * that waits is interrupted at once, and so is one whose host went silent: nobody would do it. For one that
   * runs under a host that beats, the request is kept: its host reads it, stops the run and interrupts the session.
   *
   * @param id - The identifier of the session.
   * @param silentForMs - How long without a beat tells that a host died, in milliseconds.
   * @throws {@link UnknownSessionError} when there is no such session.
   * @throws {@link SessionEndedError} when the session had already ended.
   */
  async requestInterruption(id: string, silentForMs: number): Promise<void> {
    const now = this.#clock();
    const silentSince = this.#silentSince(now, silentForMs);
    await this.#advance(id, "interrupt", async (transaction, { state, host_seen_at: seen }) => {
      const hosted = state === SESSION_LIFE.start.to && seen !== null && instant(seen) >= silentSince;
      if (!hosted) return this.#end(transaction, id, SESSION_LIFE.interrupt.to);
      await transaction
        .updateTable("sessions")
        .set({ interruption_requested_at: instant(now) })
        .where("id", "=", id)
        .execute();
    });
  }

  /**
   * Tells that a host is alive: each session it hosts that goes on bears the date of this beat.
   *
   * @param host - What names the process.
   */
  async beat(host: string): Promise<void> {
    await this.#seen(host, instant(this.#clock()));
  }

  /**
   * Withdraws the beats of a host that stops: the sessions it still hosts read as left by a silent host at
   * once, without waiting for the time a silence takes.
   *
   * @param host - What names the process.
   */
  async release(host: string): Promise<void> {
    await this.#seen(host, null);
  }

  /**
   * Gives a host that stays the sessions that wait for a host that went silent: they wait for it from then on.
   *
   * @param host - What names the process that takes them over.
   * @param silentForMs - How long without a beat tells that a host died, in milliseconds.
   * @returns The identifiers of the sessions taken over, in the order they were asked for.
   */
  async takeOver(host: string, silentForMs: number): Promise<string[]> {
    const now = this.#clock();
    const taken = await this.#database
      .updateTable("sessions")
      .set({ host, host_seen_at: instant(now) })
      .where("state", "in", [...SESSION_LIFE.takeOver.from])
      .where(this.#silent(now, silentForMs))
      .returning(["id", "opened_at"])
      .execute();
    // The database answers the rows in the order it changed them: the sessions are started in the order they were asked for.
    return taken
      .map(({ id, opened_at: opened }) => ({ id, opened: instant(opened) }))
      .sort((one, other) => one.opened.localeCompare(other.opened) || one.id.localeCompare(other.id))
      .map(({ id }) => id);
  }

  /**
   * Ends the sessions a host that died left: every `running` session whose host went silent becomes
   * `interrupted`, and an event tells so. A session whose host beats is left to it, and one that waits is left
   * to wait.
   *
   * @param silentForMs - How long without a beat tells that a host died, in milliseconds.
   * @returns The identifiers of the sessions that were interrupted.
   */
  abandonSilent(silentForMs: number): Promise<string[]> {
    const now = this.#clock();
    const at = instant(now);
    const { from, to: state } = SESSION_LIFE.abandon;
    return this.#database.transaction().execute(async (transaction) => {
      const left = await transaction
        .updateTable("sessions")
        .set({ state, last_event_at: at })
        .where("state", "in", [...from])
        .where(this.#silent(now, silentForMs))
        .returning("id")
        .execute();
      for (const { id } of left) await this.#rank(transaction, id, [{ at, type: "state_changed", state }]);
      return left.map(({ id }) => id);
    });
  }

  /** The date a beat must bear, or a later one, for its host not to be silent. */
  #silentSince(now: Date, silentForMs: number): string {
    return instant(new Date(now.getTime() - silentForMs));
  }

  /** What selects the sessions whose host went silent: its beat is empty, or older than the silence allows. */
  #silent(now: Date, silentForMs: number) {
    const silentSince = this.#silentSince(now, silentForMs);
    return (session: ExpressionBuilder<StoreSchema, "sessions">) =>
      session.or([session("host_seen_at", "is", null), session("host_seen_at", "<", silentSince)]);
  }

  /** Dates the last beat of a host on each session it hosts that goes on; an empty date withdraws it. */
  async #seen(host: string, at: string | null): Promise<void> {
    await this.#database
      .updateTable("sessions")
      .set({ host_seen_at: at })
      .where("host", "=", host)
      .where("state", "in", [...SESSION_LIFE.beat.from])
      .execute();
  }

  /**
   * Runs one command of the life of a session, in a transaction that starts by writing to the row of the
   * session, which it reads back: the database holds the row for the transaction from then to its end, and
   * whatever else writes to the session waits for it. The state the command is judged on is therefore the one
   * it finds when it writes. Writing the state it already has is how a row is held on every database: a
   * statement that only locks a row is not one they all have.
   */
  #advance<T>(id: string, command: AddressedCommand, step: (transaction: Statements, found: SessionRow) => Promise<T>): Promise<T> {
    return this.#database.transaction().execute(async (transaction) => {
      const found = await transaction
        .updateTable("sessions")
        .set((session) => ({ state: session.ref("state") }))
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
      if (found === undefined) throw new UnknownSessionError(id);
      const refusal = refusalOf(command, found.state);
      if (refusal === "session_ended") throw new SessionEndedError(id);
      if (refusal === "wrong_state") throw new SessionStateError(id, command, found.state);
      return step(transaction, found);
    });
  }

  /** Ends a session in the state given, with the event that tells it and what that event carries besides, dated as the session is. */
  #end(
    transaction: Statements,
    id: string,
    state: "completed" | "interrupted",
    change: SessionChange = {},
    told: { result?: SessionResult } = {},
  ): Promise<void> {
    return this.#tell(transaction, id, [{ at: instant(this.#clock()), type: "state_changed", state, ...told }], { ...change, state });
  }

  /** Appends events to a session whose row the transaction holds, and dates the session by the last of them. */
  async #tell(transaction: Statements, id: string, events: readonly UnrankedEvent[], change: SessionChange = {}): Promise<void> {
    const last = events.at(-1);
    if (last === undefined) return;
    await transaction
      .updateTable("sessions")
      .set({ ...change, last_event_at: instant(last.at) })
      .where("id", "=", id)
      .execute();
    await this.#rank(transaction, id, events);
  }

  /** Writes events at the ranks that follow the last of their session. */
  async #rank(statements: Statements, id: string, events: readonly UnrankedEvent[]): Promise<void> {
    const after = await this.#lastRank(statements, id);
    const rows = events.map(({ at, type, ...payload }, index) => ({
      session_id: id,
      id: after + index + 1,
      at: instant(at),
      type,
      payload: storedJson(payload),
    }));
    await statements.insertInto("session_events").values(rows).execute();
  }

  async #lastRank(statements: Statements, id: string): Promise<number> {
    const { last } = await statements
      .selectFrom("session_events")
      .select((event) => event.fn.max<number | null>("id").as("last"))
      .where("session_id", "=", id)
      .executeTakeFirstOrThrow();
    return last ?? 0;
  }
}
