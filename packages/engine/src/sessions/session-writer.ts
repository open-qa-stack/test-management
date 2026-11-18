import { setTimeout as pause } from "node:timers/promises";
import { MessageNotPendingError, SessionEndedError, SessionStateError, UnknownSessionError, type SessionCommands } from "@open-qa-stack/domain";
import type { MessageDeliveredEvent, SessionResult, UnrankedEvent } from "@open-qa-stack/domain/sessions";
import type { SessionsLogger } from "./sessions-logger.ts";

/** The end of a session, as the last thing written to it: its result when its run gave one, an interruption otherwise. */
interface End {
  readonly result: SessionResult | undefined;
}

/** What is still to be written to the session, in order: an event of its thread, or its end. */
type Pending = UnrankedEvent | End;

/** Whether what waits is an event the store appends as it is: any but a delivery, which has a command of its own. */
function appended(waiting: Pending): boolean {
  return "type" in waiting && waiting.type !== "message_delivered";
}

/** The refusals that tell the session takes nothing more from its execution: whatever is written from then on is refused the same. */
const LOST = [SessionEndedError, SessionStateError, UnknownSessionError];

/** The commands of the store a writer tells a session with. */
type WriterStore = Pick<SessionCommands, "append" | "deliver" | "complete" | "interrupt">;

/** What a writer tells whoever runs the session of what becomes of its writes. */
export interface WriterSignals {
  /** Called each time the store took a write: the session gained events. */
  wrote(): void;
  /** Called once, when the session takes nothing more: its execution has no one left to tell, and should stop. */
  lost(): void;
}

/** How the writer paces what it writes again after a failure. */
export interface WriterPace {
  /** How long after a first failure a write is made again, in milliseconds. */
  readonly firstRetryMs: number;
  /** The longest that delay grows to, in milliseconds. */
  readonly maxRetryMs: number;
}

/** The pace of a writer a host does not set: 250 milliseconds at first, 10 seconds at most. */
const DEFAULT_PACE: WriterPace = { firstRetryMs: 250, maxRetryMs: 10_000 };

/**
 * Writes what a run tells of its session to the store, in the order it was told, one write at a time.
 *
 * @remarks
 * What is told while a write is under way waits, and goes together in the next one: a burst of events is a
 * few writes, not one each. An event leaves the buffer once the store took it, and never before: a write
 * that fails is made again, the same, after a delay that doubles up to a bound, until it succeeds, so that a
 * database that goes away for a while costs the session no event and gives it none twice. One case escapes
 * that: a write the database made and could not answer for is made again, and its events are then held twice.
 *
 * The store tells itself what a person says and what reaches an agent. What the run repeats of the words of
 * the person is therefore left out, and a delivery the run tells becomes the command that marks the message
 * delivered, which writes its event: each is told once.
 *
 * A host that stops and cannot wait any longer aborts the signal the writer was given: a write that fails is
 * then made no more, and what waited is dropped. The session is left as the store holds it, for the host that
 * starts next.
 *
 * A session that ended under its execution — its host went silent for longer than the other processes on the
 * same store allow, and one of them took it for one that was left — takes nothing more: the first refusal of that kind is reported and signalled, what waited
 * is dropped, and what the run still tells is ignored.
 */
export class SessionWriter {
  readonly #store: WriterStore;
  readonly #session: string;
  readonly #logger: SessionsLogger;
  readonly #signals: WriterSignals;
  readonly #abandoned: AbortSignal;
  readonly #pace: WriterPace;
  readonly #pending: Pending[] = [];
  #writing: Promise<void> | undefined;
  #ended = false;
  #lost = false;
  #failing = false;

  /**
   * @param store - The commands of the store the session is told with.
   * @param session - The identifier of the session, which runs.
   * @param logger - Where a write that fails, then succeeds again, and a session that was lost are reported.
   * @param signals - What is told of the writes: each one the store took, and a session that takes nothing more.
   * @param abandoned - Aborted by a host that stops without waiting any longer: a write that fails is then given up.
   * @param pace - How a failed write is paced; 250 milliseconds at first, 10 seconds at most, by default.
   */
  constructor(store: WriterStore, session: string, logger: SessionsLogger, signals: WriterSignals, abandoned: AbortSignal, pace: WriterPace = DEFAULT_PACE) {
    this.#store = store;
    this.#session = session;
    this.#logger = logger;
    this.#signals = signals;
    this.#abandoned = abandoned;
    this.#pace = pace;
  }

  /**
   * Takes events of the thread of the session, to be written after those taken before.
   *
   * @param events - The events, in order; those told once the session has its end are ignored.
   */
  tell(events: readonly UnrankedEvent[]): void {
    this.#take(events);
  }

  /**
   * Ends the session, once everything told before is written: it is completed with its result, or interrupted
   * when its run gave none. Nothing is taken afterwards.
   *
   * @param result - What the session came to; `undefined` for a run that stopped before its end.
   * @returns Once the end is written, or the session no longer takes it.
   */
  async end(result: SessionResult | undefined): Promise<void> {
    this.#take([{ result }]);
    this.#ended = true;
    await this.#writing;
  }

  #take(told: readonly Pending[]): void {
    if (this.#ended || this.#lost || told.length === 0) return;
    this.#pending.push(...told);
    this.#writing ??= this.#write().finally(() => {
      this.#writing = undefined;
    });
  }

  /** Writes what waits, the oldest first, until nothing does: each write is made again until the store took it. */
  async #write(): Promise<void> {
    // What is told in the same turn goes in one write.
    await Promise.resolve();
    let retryMs = this.#pace.firstRetryMs;
    while (this.#pending.length > 0) {
      const batch = this.#next();
      try {
        await this.#send(batch);
      } catch (error) {
        if (LOST.some((refusal) => error instanceof refusal)) return this.#lose(error as Error);
        if (!this.#failing) this.#logger.warn(`The session ${this.#session} cannot be written to, and what it tells waits: ${(error as Error).message}`);
        this.#failing = true;
        // The wait ends at once for a host that stops waiting.
        await pause(retryMs, undefined, { signal: this.#abandoned }).catch(() => undefined);
        if (this.#abandoned.aborted) return this.#giveUp();
        retryMs = Math.min(retryMs * 2, this.#pace.maxRetryMs);
        continue;
      }
      this.#pending.splice(0, batch.length);
      this.#signals.wrote();
      retryMs = this.#pace.firstRetryMs;
      if (this.#failing) this.#logger.log(`The session ${this.#session} is written to again.`);
      this.#failing = false;
    }
  }

  /** What goes in the next write: the events that wait up to the next delivery or the end, or else that delivery or that end alone. */
  #next(): readonly Pending[] {
    const alone = this.#pending.findIndex((waiting) => !appended(waiting));
    return this.#pending.slice(0, alone === -1 ? this.#pending.length : Math.max(alone, 1));
  }

  /** Writes a batch with the command of the store that tells it. */
  async #send(batch: readonly Pending[]): Promise<void> {
    const [first] = batch as [Pending, ...Pending[]];
    if (!("type" in first)) return this.#finish(first.result);
    if (first.type === "message_delivered") return this.#deliver(first);
    return this.#store.append(this.#session, batch as UnrankedEvent[]);
  }

  #finish(result: SessionResult | undefined): Promise<void> {
    return result === undefined ? this.#store.interrupt(this.#session) : this.#store.complete(this.#session, result);
  }

  /** Marks a message delivered; one the store holds as delivered already was by this same write, whose answer was lost. */
  async #deliver({ message, agent }: Omit<MessageDeliveredEvent, "id">): Promise<void> {
    try {
      await this.#store.deliver(this.#session, message, agent);
    } catch (error) {
      if (!(error instanceof MessageNotPendingError)) throw error;
    }
  }

  #giveUp(): void {
    this.#logger.warn(`The session ${this.#session} is left as the store holds it: its host stops, and what its run still told is dropped.`);
    this.#pending.length = 0;
    this.#lost = true;
  }

  #lose(refusal: Error): void {
    this.#logger.warn(`The session ${this.#session} takes nothing more, and what its run still tells is dropped: ${refusal.message}`);
    this.#pending.length = 0;
    this.#lost = true;
    this.#signals.lost();
  }
}
