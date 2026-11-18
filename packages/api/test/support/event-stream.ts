import type { SessionEvent } from "@open-qa-stack/shared/sessions";

/** How long a test waits for an event before it fails, in milliseconds. */
const PATIENCE_MS = 5_000;

/** A message of a stream of server-sent events: the identifier it bears, and the event it carries. */
export interface StreamMessage {
  readonly id: string | undefined;
  readonly event: SessionEvent;
}

/** The client of a stream of server-sent events: reads its messages one by one, as the console does. */
export class EventStream {
  /** The answer the stream opened with. */
  readonly response: Response;
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly #decoder = new TextDecoder();
  #received = "";

  private constructor(response: Response, reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.response = response;
    this.#reader = reader;
  }

  /**
   * Opens a stream.
   *
   * @param url - The address of the stream.
   * @param lastEventId - The identifier of the last event already got, as a client that reconnects sends it.
   * @returns The stream, once the server answered.
   */
  static async open(url: string, lastEventId?: string): Promise<EventStream> {
    const response = await fetch(url, lastEventId === undefined ? {} : { headers: { "last-event-id": lastEventId } });
    if (response.body === null) throw new Error("The answer has no body.");
    return new EventStream(response, response.body.getReader());
  }

  /**
   * Waits for the next block of the stream: a message, with or without data, or a comment.
   *
   * @returns The lines of the block, as the server wrote them; `undefined` when the server ended the stream.
   */
  async block(): Promise<string | undefined> {
    const deadline = AbortSignal.timeout(PATIENCE_MS);
    for (;;) {
      const end = this.#received.indexOf("\n\n");
      if (end >= 0) {
        const block = this.#received.slice(0, end).trim();
        this.#received = this.#received.slice(end + 2);
        return block;
      }
      const chunk = await Promise.race([
        this.#reader.read(),
        new Promise<never>((_resolve, reject) => deadline.addEventListener("abort", () => reject(new Error("Nothing came in time.")))),
      ]);
      if (chunk.done) return undefined;
      this.#received += this.#decoder.decode(chunk.value, { stream: true });
    }
  }

  /**
   * Waits for the next message that carries an event.
   *
   * @returns The message; `undefined` when the server ended the stream.
   */
  async next(): Promise<StreamMessage | undefined> {
    for (;;) {
      const fields = (await this.block())?.split("\n");
      if (fields === undefined) return undefined;
      const data = fields.find((field) => field.startsWith("data: "));
      if (data === undefined) continue;
      const id = fields.find((field) => field.startsWith("id: "))?.slice("id: ".length);
      return { id, event: JSON.parse(data.slice("data: ".length)) as SessionEvent };
    }
  }

  /**
   * Waits for the next events.
   *
   * @param count - How many.
   * @returns The events, in the order they came.
   */
  async take(count: number): Promise<SessionEvent[]> {
    const events: SessionEvent[] = [];
    while (events.length < count) {
      const message = await this.next();
      if (message === undefined) throw new Error(`The stream ended after ${events.length} of ${count} events.`);
      events.push(message.event);
    }
    return events;
  }

  /** Leaves the stream, as a console that is closed does. */
  async close(): Promise<void> {
    await this.#reader.cancel();
  }
}
