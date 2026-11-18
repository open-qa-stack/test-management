import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { UnknownSessionError } from "@open-qa-stack/domain";
import type { MessageReceipt, Project, Session, SessionEvent, SessionMessage, SessionOpening } from "@open-qa-stack/domain/sessions";
import { EventNotifications } from "./event-notifications.ts";
import { NoRepositoryError } from "./no-repository-error.ts";
import { repositoryProject } from "./repository-project.ts";
import { RunningExecutions } from "./running-executions.ts";
import { SessionEventStream } from "./session-event-stream.ts";
import { SessionExecution } from "./session-execution.ts";
import { SessionInbox } from "./session-inbox.ts";
import { WaitingSessions } from "./waiting-sessions.ts";
import { DEFAULT_PACE, type SessionsPace } from "./sessions-pace.ts";
import type { SessionsHost } from "./sessions-host.ts";

/**
 * The operations on the sessions of an instance: open one, say something to it, resume it once it ended,
 * interrupt it, read them, and follow what one tells. Whatever shows the sessions — a REST API, a terminal —
 * calls these and holds no rule of its own.
 *
 * @remarks
 * The operations run the sessions in the process that hosts them, by calling the engine: no other process
 * executes for it. The store keeps the truth — the sessions, their events, the messages — and three things
 * live in the memory of the process: the line of the sessions that wait, the registry of the executions that
 * run, and the notifications that wake whoever follows a session once the store took what it gained.
 *
 * One session runs at a time in a process, in the order they were asked for: the next starts when the one
 * that runs ends.
 *
 * Several processes may reach the same store, a server and commands in terminals: the store is where they
 * meet. A process hosts the sessions it opened, and those alone; it has a name of its own, and beats on its
 * sessions as long as it lives. What another process says to a session is taken by the store, and the host
 * reads it at its next beat; an interruption another process asks for is kept by the store, and the host
 * obeys it at its next beat. A process that only reads or posts — it never started, and opens nothing —
 * hosts nothing, beats on nothing and touches no session of another.
 *
 * A host whose beat is older than the pace allows died. The sessions it left running are interrupted by
 * whichever host beats next, since nothing runs them any more; those it left waiting are taken over by a host
 * that stays, and wait until then.
 *
 * A failure is never left as a session that runs for ever: an execution tells its session why it stopped and
 * interrupts it, and a session the store refuses to start is reported and passed over.
 */
export class Sessions {
  readonly #host: SessionsHost;
  readonly #pace: SessionsPace;
  /** What names this process among those that host sessions on the same store. */
  readonly #identity = `host-${randomUUID()}`;
  readonly #waiting = new WaitingSessions();
  readonly #executions = new RunningExecutions();
  readonly #notifications = new EventNotifications();
  /** The startup under way or done; `undefined` until it is asked for, and again when it failed. */
  #started: Promise<void> | undefined;
  #stopping = false;
  /** Aborted when the host stops: it beats no more. */
  readonly #beating = new AbortController();
  /** The beats under way, which end once the host stopped; `undefined` until the host started. */
  #beats: Promise<void> | undefined;
  /** Whether the last beat failed: a store that does not answer is reported once, not at each beat. */
  #missed = false;
  /** Aborted when the host stopped without the execution under way having ended: what it still writes is given up when the store fails. */
  readonly #abandoned = new AbortController();

  /** @param host - Where the sessions are kept, and what their runs work with. */
  constructor(host: SessionsHost) {
    this.#host = host;
    this.#pace = host.pace ?? DEFAULT_PACE;
  }

  /**
   * Starts hosting sessions: the configuration is brought in step with the file of the test repository, the
   * project it names is saved to the store, the sessions a host
   * that died left running are interrupted, those it left waiting are taken over when this host stays, and
   * started in the order they were asked for, one at a time. The process beats from then on.
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
   * session may stay `running` in the store until another host interrupts it. The beats of the process are
   * withdrawn, so that the sessions it still hosts — one that did not end, those that waited — are seen as
   * left at once.
   */
  async stop(withinMs: number): Promise<boolean> {
    this.#stopping = true;
    this.#beating.abort();
    const running = this.#executions.all();
    for (const { stop } of running) stop.abort();
    const ended = Promise.all(running.map((execution) => execution.ended)).then(() => true);
    const bound = new AbortController();
    const late = pause(withinMs, false, { signal: bound.signal }).catch(() => false);
    const inTime = await Promise.race([ended, late]);
    // The wait is given up once it is settled: no timer outlives the stop.
    bound.abort();
    if (!inTime) this.#abandoned.abort();
    await this.#withdraw();
    return inTime;
  }

  /**
   * @returns The project of the instance: for a host that has a test repository, named after it with the
   * applications of the revision in force, so that a change of the configuration names them at once; for one
   * that has none, as the store keeps it.
   */
  async project(): Promise<Project> {
    const { repository, configuration, store } = this.#host;
    if (repository === undefined) return store.project();
    return repositoryProject(repository, (await configuration.view()).revision?.document);
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
   * read from the moment they are subscribed to. A session another process hosts is read again from the store
   * at the pace of the process, since nothing here is told what that process writes.
   * @throws `UnknownSessionError` when there is no such session.
   */
  async events(id: string, after: number): Promise<SessionEventStream> {
    await this.session(id);
    const here = this.#executions.find(id) !== undefined || this.#waiting.has(id);
    return new SessionEventStream(this.#host.store, this.#notifications, id, after, here ? undefined : this.#pace.followMs);
  }

  /**
   * @param id - The identifier of a session.
   * @returns The thread of the session so far: every event it holds, in the order of their ranks.
   * @throws `UnknownSessionError` when there is no such session.
   */
  async thread(id: string): Promise<SessionEvent[]> {
    await this.session(id);
    return this.#host.store.eventsAfter(id, 0);
  }

  /**
   * Opens a session: it is asked of the store, then runs at once when no other does, and waits its turn otherwise.
   *
   * @param opening - What to test, and where.
   * @returns The session: `running` when it started at once, `queued` when it waits.
   * @throws {@link NoRepositoryError} when the host has no test repository to run it in.
   * @throws What the store raises when it cannot take the session.
   */
  open(opening: SessionOpening): Promise<Session> {
    return this.#line((store) => store.ask(opening, this.#identity));
  }

  /**
   * Resumes a session that ended with something more the person says to it: the store takes it as what is asked
   * of a new turn, and the session runs that turn at once when no other does, and waits its turn otherwise.
   *
   * @remarks
   * The run of the turn is asked what the person says now, with what the turns before did, and goes on with the
   * branch their tests are on. The process that resumes the session hosts it from then on, as the one that opens a
   * session does.
   *
   * @param id - The identifier of the session.
   * @param message - What the person asks of the new turn.
   * @returns The session: `running` when its turn started at once, `queued` when it waits.
   * @throws {@link NoRepositoryError} when the host has no test repository to run it in.
   * @throws `UnknownSessionError` when there is no such session, `SessionStateError` when it goes on: it takes a message instead.
   */
  resume(id: string, message: SessionMessage): Promise<Session> {
    return this.#line(async (store) => {
      const resumed = await store.resume(id, message.text, this.#identity);
      this.#notifications.notify(id);
      return resumed;
    });
  }

  /**
   * Says something to a session that goes on: the store takes the message, which numbers it and tells it in
   * the thread of the session, then the message is dropped in the inbox of the execution of the session.
   *
   * @remarks
   * A session that waits has no execution yet: its message stays in the store, and its execution is given it
   * when it starts. A session another process runs has its execution there: the message stays in the store,
   * and that process reads it at its next beat.
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
   * Interrupts a session that goes on. One that runs here is asked to stop: its agents refuse to go on, its
   * run ends by itself, and the session is then told interrupted. One that waits is interrupted at once. One
   * that another process runs has its interruption kept by the store, which that process obeys at its next
   * beat — unless it died, in which case the session is interrupted at once.
   *
   * @param id - The identifier of the session.
   * @throws `UnknownSessionError` when there is no such session, `SessionEndedError` when it had already ended.
   */
  async interrupt(id: string): Promise<void> {
    const running = this.#executions.find(id);
    if (running !== undefined) return running.stop.abort();
    await this.#host.store.requestInterruption(id, this.#pace.silentAfterMs);
    this.#waiting.remove(id);
    this.#notifications.notify(id);
  }

  /**
   * Has the store put a session in line for this host, then starts it when no other runs.
   *
   * @param ask - What the store is asked, which gives the session that waits.
   * @returns The session: `running` when it started at once, `queued` when it waits.
   */
  async #line(ask: (store: SessionsHost["store"]) => Promise<Session>): Promise<Session> {
    const { repository, store } = this.#host;
    if (repository === undefined) throw new NoRepositoryError();
    await this.start();
    const asked = await ask(store);
    this.#waiting.add(asked.id);
    const started = await this.#startNext(repository);
    return started?.id === asked.id ? started : asked;
  }

  /**
   * Brings the configuration in step with the file of the test repository, saves the project it names, puts the
   * store in order after whatever hosts died, starts the first session that waits, and beats from then on.
   */
  async #recover(): Promise<void> {
    const { store, repository } = this.#host;
    if (repository !== undefined) await store.saveProject(repositoryProject(repository, (await this.#host.configuration.inStep())?.document));
    await this.#tidy();
    this.#beats = this.#beat();
  }

  /**
   * Sees to the sessions a host that died left: those that ran are interrupted, and those that waited are
   * lined up here when this host stays and has a test repository to run them in.
   */
  async #tidy(): Promise<void> {
    const { store, repository, takesOver, logger } = this.#host;
    const { silentAfterMs } = this.#pace;
    const left = await store.abandonSilent(silentAfterMs);
    if (left.length > 0)
      logger.warn(`${left.length} ${left.length === 1 ? "session was" : "sessions were"} left running by a process that stopped, and interrupted.`);
    for (const id of left) this.#notifications.notify(id);
    if (!takesOver || repository === undefined) return;
    for (const id of await store.takeOver(this.#identity, silentAfterMs)) this.#waiting.add(id);
    await this.#startNext(repository);
  }

  /** Beats at the pace of the process until the host stops. */
  async #beat(): Promise<void> {
    const { signal } = this.#beating;
    for (;;) {
      await pause(this.#pace.beatMs, undefined, { signal }).catch(() => undefined);
      if (signal.aborted) return;
      await this.#meet();
    }
  }

  /**
   * Meets the other processes in the store, once: tells that this one is alive, sees to what a dead host
   * left, hands each execution the messages its session was sent, and stops those whose interruption was
   * asked for.
   *
   * @remarks
   * A message said in this process was dropped in its inbox already: the inbox takes a message once. A store
   * that does not answer is reported once, and met again at the next beat.
   */
  async #meet(): Promise<void> {
    const { store, logger } = this.#host;
    try {
      await store.beat(this.#identity);
      await this.#tidy();
      const asked = new Set(await store.interruptionRequests(this.#identity));
      for (const [id, { inbox, stop }] of this.#executions.entries()) {
        for (const message of await store.pendingMessages(id)) inbox.drop(message);
        if (asked.has(id)) stop.abort();
      }
      if (this.#missed) logger.log("The store answers again: the sessions of this process are seen alive.");
      this.#missed = false;
    } catch (error) {
      if (!this.#missed) logger.warn(`The store does not answer the beat of this process, which is made again: ${(error as Error).message}`);
      this.#missed = true;
    }
  }

  /** Withdraws the beats of a host that started, once the beat under way is over: nothing dates its sessions afterwards. */
  async #withdraw(): Promise<void> {
    if (this.#beats === undefined) return;
    await this.#beats;
    await this.#host.store.release(this.#identity).catch((error: unknown) => {
      this.#host.logger.warn(`The sessions of this process stay as its last beat left them: ${(error as Error).message}`);
    });
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
      .finally(() => {
        this.#executions.remove(id);
        // Whoever follows the session reads its end, also when another process wrote it.
        this.#notifications.notify(id);
      })
      .then(() => void this.#startNext(repository));
    this.#executions.add(id, { inbox, stop, ended });
    return started;
  }

  /**
   * Has the store start a session.
   *
   * @returns The session, now running; `undefined` when the store refused, which is reported: the session was
   * interrupted while it waited, or the store does not answer and keeps it `queued` for a host that stays.
   */
  async #begin(id: string): Promise<Session | undefined> {
    try {
      const session = await this.#host.store.start(id, this.#identity);
      this.#host.logger.log(`The session ${id} starts.`);
      this.#notifications.notify(id);
      return session;
    } catch (error) {
      this.#host.logger.warn(`The session ${id} does not start: ${(error as Error).message}`);
      return undefined;
    }
  }
}
