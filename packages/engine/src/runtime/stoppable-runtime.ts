import type { AgentEvent, AgentRuntime, AgentSession, SessionOptions } from "@open-qa-stack/domain";
import { RunStoppedError } from "./run-stopped-error.ts";

/**
 * A runtime of the agents that refuses to go on once the host of the run asked it to stop: how a run is
 * interrupted, in the process that hosts it.
 *
 * @remarks
 * Nothing is killed. Once the stop is asked, opening a session raises {@link RunStoppedError}, and so does
 * the turn under way of every session, at once: a turn does not wait for the model to answer a call that
 * may last minutes. The step of the run that led the session stops on that error, as it does on any other,
 * and the run goes to its summary. What runs outside the sessions — an installation, the tests — is not
 * stopped here: the run starts no other step once the stop is asked.
 */
export class StoppableRuntime implements AgentRuntime {
  private readonly inner: AgentRuntime;
  private readonly stop: AbortSignal;
  /**
   * Rejects when the stop is asked, and never settles otherwise: what every turn under way waits against. Made
   * by the first turn, so that a stop asked of a run that had none is a refusal nobody has to hear.
   */
  private asked: Promise<never> | undefined;

  /**
   * @param inner - The runtime the sessions are opened on.
   * @param stop - The signal the host aborts to ask the run to stop.
   */
  public constructor(inner: AgentRuntime, stop: AbortSignal) {
    this.inner = inner;
    this.stop = stop;
  }

  /**
   * {@inheritDoc @open-qa-stack/domain#AgentRuntime.openSession}
   *
   * @throws {@link RunStoppedError} once the stop is asked.
   */
  public async openSession(options: SessionOptions): Promise<AgentSession> {
    if (this.stop.aborted) throw new RunStoppedError();
    const session = await this.inner.openSession(options);
    return { send: (message) => this.turn(session.send(message)), close: () => session.close() };
  }

  /** {@inheritDoc @open-qa-stack/domain#AgentRuntime.close} */
  public close(): Promise<void> {
    return this.inner.close();
  }

  /** The events of a turn, until the turn ends or the stop is asked, whichever comes first. */
  private async *turn(events: AsyncIterable<AgentEvent>): AsyncIterable<AgentEvent> {
    const turn = events[Symbol.asyncIterator]();
    this.asked ??= new Promise<never>((_resolve, reject) => {
      if (this.stop.aborted) reject(new RunStoppedError());
      else this.stop.addEventListener("abort", () => reject(new RunStoppedError()), { once: true });
    });
    for (;;) {
      const next = await Promise.race([turn.next(), this.asked]);
      if (next.done === true) return;
      yield next.value;
    }
  }
}
