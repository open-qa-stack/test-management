import type { AgentEvent } from "@open-qa-stack/domain";

/**
 * Passes the events of a session to whoever reads the current turn, in order.
 *
 * @remarks
 * Events arrive from SDK callbacks; the reader pulls them as an async iterable. Once a turn is
 * finished, events are dropped until the next turn starts, so that nothing late leaks into it.
 */
export class EventRelay {
  private queue: AgentEvent[] = [];
  private finished = true;
  private wake: (() => void) | undefined;

  /**
   * Starts a turn.
   *
   * @returns The events of the turn, until `finish` is called.
   */
  public startTurn(): AsyncIterable<AgentEvent> {
    this.queue = [];
    this.finished = false;
    return this.drain();
  }

  /**
   * Adds an event to the current turn; dropped when no turn is running.
   *
   * @param event - The event, delivered after those already added.
   */
  public push(event: AgentEvent): void {
    if (this.finished) return;
    this.queue.push(event);
    this.wake?.();
    this.wake = undefined;
  }

  /**
   * Adds the last event of the current turn; dropped when no turn is running.
   *
   * @param event - The event that ends the turn.
   */
  public finish(event: AgentEvent): void {
    this.push(event);
    this.finished = true;
  }

  private async *drain(): AsyncIterable<AgentEvent> {
    for (;;) {
      const event = this.queue.shift();
      if (event !== undefined) {
        yield event;
        continue;
      }
      if (this.finished) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
    }
  }
}
