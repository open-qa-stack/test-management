import { setTimeout as pause } from "node:timers/promises";
import { UnknownSessionError } from "@open-qa-stack/domain";
import type { MessageReceipt, Project, Session, SessionMessage, SessionOpening } from "@open-qa-stack/domain/sessions";
import { EventNotifications } from "./event-notifications.ts";
import { NoRepositoryError } from "./no-repository-error.ts";
import { repositoryProject } from "./repository-project.ts";
import { RunningExecutions } from "./running-executions.ts";
import { SessionEventStream } from "./session-event-stream.ts";
import { SessionExecution } from "./session-execution.ts";
import { SessionInbox } from "./session-inbox.ts";
import { WaitingSessions } from "./waiting-sessions.ts";
import type { SessionsHost } from "./sessions-host.ts";

/**
 * The operations on the sessions of an instance: open one, say something to it, interrupt it, read them, and
 * follow what one tells. Whatever shows the sessions — a REST API, a terminal — calls these and holds no rule
 * of its own.
 *
 * @remarks
 * The operations run the sessions in the process that hosts them, by calling the engine: there is no other
 * process. The store keeps the truth — the sessions, their events, the messages — and three things live in
 * the memory of the process: the line of the sessions that wait, the registry of the executions that run,
 * and the notifications that wake whoever follows a session once the store took what it gained.
 *
 * One session runs at a time, in the order they were asked for: the next starts when the one that runs ends.
 * A process that starts finds in the store what an earlier one left: the sessions still `running` there are
 * interrupted, since nothing runs them any more, and those that wait are lined up again.
 *
 * A failure is never left as a session that runs for ever: an execution tells its session why it stopped and
 * interrupts it, and a session the store refuses to start is reported and passed over.
 */
export class Sessions {
  readonly #host: SessionsHost;
  readonly #waiting = new WaitingSessions();
  readonly #executions = new RunningExecutions();
  readonly #notifications = new EventNotifications();
  /** The startup under way or done; `undefined` until it is asked for, and again when it failed. */
  #started: Promise<void> | undefined;
  #stopping = false;
  /** Aborted when the host stopped without the execution under way having ended: what it still writes is given up when the store fails. */
  readonly #abandoned = new AbortController();

  /** @param host - Where the sessions are kept, and what their runs work with. */
  constructor(host: SessionsHost) {
    this.#host = host;
  }

  /**
   * Starts hosting the sessions: the project of the test repository is saved to the store, the sessions an
   * earlier process left running are interrupted, and those that wait are started in the order they were
   * asked for, one at a time.
   *
   * @remarks
   * The startup is done once. One that failed — the store did not answer — is done again when it is asked
   * for again, which opening a session does: a host whose store comes back needs no restart.
   *
   * @returns Once the store is in order and the first session that waited is started; the sessions run afterwards.
   * @throws What the store raises when it cannot be read or written.
   */
  start(): Promise<void> {
    this.#started ??= this.#recover().catch((error: unknown) => {
      this.#started = undefined;
      throw error;
    });
    return this.#started;
  }

  /**
   * Stops hosting the sessions: no other session starts, the one that runs is asked to stop, and its end is
   * awaited for a time.
   *
   * @param withinMs - How long the execution under way is given to end and have its session told interrupted, in milliseconds.
   * @returns Whether nothing is left running: `false` when the execution did not end in time. It is then left
   * to end by itself, and no longer insists when the store, which its host closes, refuses a write: its
   * session may stay `running` in the store until a host that starts interrupts it.
   */
  async stop(withinMs: number): Promise<boolean> {
    this.#stopping = true;
    const running = this.#executions.all();
    for (const { stop } of running) stop.abort();
    const ended = Promise.all(running.map((execution) => execution.ended)).then(() => true);
    const bound = new AbortController();
    const late = pause(withinMs, false, { signal: bound.signal }).catch(() => false);
    const inTime = await Promise.race([ended, late]);
    // The wait is given up once it is settled: no timer outlives the stop.
    bound.abort();
    if (!inTime) this.#abandoned.abort();
    return inTime;
  }

  /** @returns The project of the instance, as the store keeps it. */
  project(): Promise<Project> {
    return this.#host.store.project();
  }

  /** @returns Every session, the latest opened first. */
  sessions(): Promise<Session[]> {
    return this.#host.store.sessions();
  }

  /**
   * @param id - The identifier of a session.
   * @returns The session as it is now.
   * @throws `UnknownSessionError` when there is no such session.
   */
  async session(id: string): Promise<Session> {
    const session = await this.#host.store.session(id);
    if (session === undefined) throw new UnknownSessionError(id);
    return session;
  }

  /**
   * Gives the events of a session to follow.
   *
   * @param id - The identifier of the session.
   * @param after - The rank of the last event already known; 0 for every event.
   * @returns The events after that rank, then each new one as it happens, until the session ended: they are
   * read from the moment they are subscribed to.
   * @throws `UnknownSessionError` when there is no such session.
   */
  async events(id: string, after: number): Promise<SessionEventStream> {
    await this.session(id);
    return new SessionEventStream(this.#host.store, this.#notifications, id, after);
  }

  /**
   * Opens a session: it is asked of the store, then runs at once when no other does, and waits its turn otherwise.
   *
   * @param opening - What to test, and where.
   * @returns The session: `running` when it started at once, `queued` when it waits.
   * @throws {@link NoRepositoryError} when the host has no test repository to run it in.
   * @throws What the store raises when it cannot take the session.
   */
  async open(opening: SessionOpening): Promise<Session> {
    const { repository, store } = this.#host;
    if (repository === undefined) throw new NoRepositoryError();
    await this.start();
    const asked = await store.ask(opening);
    this.#waiting.add(asked.id);
    const started = await this.#startNext(repository);
    return started?.id === asked.id ? started : asked;
  }

  /**
   * Says something to a session that goes on: the store takes the message, which numbers it and tells it in
   * the thread of the session, then the message is dropped in the inbox of the execution of the session.
   *
   * @remarks
   * A session that waits has no execution yet: its message stays in the store, and its execution is given it
   * when it starts.
   *
   * @param id - The identifier of the session.
   * @param message - What the person says to the agents.
   * @returns The receipt, which numbers the message: the events of the session tell its delivery later.
   * @throws `UnknownSessionError` when there is no such session, `SessionEndedError` when it no longer goes on.
   */
  async say(id: string, message: SessionMessage): Promise<MessageReceipt> {
    const receipt = await this.#host.store.say(id, message.text);
    this.#executions.find(id)?.inbox.drop({ number: receipt.number, text: message.text });
    this.#notifications.notify(id);
    return receipt;
  }

  /**
   * Interrupts a session that goes on. One that runs is asked to stop: its agents refuse to go on, its run
   * ends by itself, and the session is then told interrupted. One that waits is interrupted at once.
   *
   * @param id - The identifier of the session.
   * @throws `UnknownSessionError` when there is no such session, `SessionEndedError` when it had already ended.
   */
  async interrupt(id: string): Promise<void> {
    const running = this.#executions.find(id);
    if (running !== undefined) return running.stop.abort();
    await this.#host.store.interrupt(id);
    this.#waiting.remove(id);
    this.#notifications.notify(id);
  }

  /** Puts the store in order after whatever process hosted the sessions before, then starts the first session that waits. */
  async #recover(): Promise<void> {
    const { store, repository, logger } = this.#host;
    if (repository !== undefined) await store.saveProject(await repositoryProject(repository));
    const left = await store.abandonRunning();
    if (left.length > 0)
      logger.warn(`${left.length} ${left.length === 1 ? "session was" : "sessions were"} left running by a process that stopped, and interrupted.`);
    for (const id of left) this.#notifications.notify(id);
    // A host without a test repository runs nothing: what waits is left to one that has one.
    if (repository === undefined) return;
    // The store lists the latest first: the line is in the order the sessions were asked for.
    for (const session of (await store.sessions()).reverse()) if (session.state === "queued") this.#waiting.add(session.id);
    await this.#startNext(repository);
  }

  /**
   * Starts the session that waited the longest, when none runs and the host does not stop.
   *
   * @remarks
   * The execution enters the registry before anything is awaited: whatever is asked meanwhile finds that a
   * session runs. It leaves the registry when it ended, and the next session then starts.
   *
   * @param repository - The test repository the session runs in.
   * @returns The session started; `undefined` when none was: one runs already, none waits, or the store refused.
   */
  #startNext(repository: string): Promise<Session | undefined> {
    const id = this.#stopping || this.#executions.all().length > 0 ? undefined : this.#waiting.next();
    if (id === undefined) return Promise.resolve(undefined);
    const inbox = new SessionInbox();
    const stop = new AbortController();
    const wrote = (): void => this.#notifications.notify(id);
    const started = this.#begin(id);
    const ended = started
      .then(async (session) => {
        if (session === undefined) return;
        await new SessionExecution(this.#host, { session, repository, inbox, stop, abandoned: this.#abandoned.signal, wrote }).run();
        this.#host.logger.log(`The session ${id} is over.`);
      })
      .finally(() => this.#executions.remove(id))
      .then(() => void this.#startNext(repository));
    this.#executions.add(id, { inbox, stop, ended });
    return started;
  }

  /**
   * Has the store start a session.
   *
   * @returns The session, now running; `undefined` when the store refused, which is reported: the session was
   * interrupted while it waited, or the store does not answer and keeps it `queued` for a host that starts.
   */
  async #begin(id: string): Promise<Session | undefined> {
    try {
      const session = await this.#host.store.start(id);
      this.#host.logger.log(`The session ${id} starts.`);
      this.#notifications.notify(id);
      return session;
    } catch (error) {
      this.#host.logger.warn(`The session ${id} does not start: ${(error as Error).message}`);
      return undefined;
    }
  }
}
