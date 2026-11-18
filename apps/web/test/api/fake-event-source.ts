import type { SessionEvent } from "@open-qa-stack/shared/sessions";

/**
 * The source of events of a browser, as far as the stream uses it: it records its address and whether it was
 * closed, and a test plays what the network does to it.
 */
export class FakeEventSource {
  /** Every source opened since the list was last emptied. */
  public static readonly opened: FakeEventSource[] = [];

  public onopen: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public onmessage: ((message: { readonly data: string }) => void) | null = null;
  public closed = false;
  public readonly url: string;

  /**
   * @param url - The address the source reads.
   */
  public constructor(url: string) {
    this.url = url;
    FakeEventSource.opened.push(this);
  }

  /** The source opened last. */
  public static get last(): FakeEventSource {
    return FakeEventSource.opened.at(-1)!;
  }

  /** Closes the source. */
  public close(): void {
    this.closed = true;
  }

  /**
   * Receives an event of a session, as the API sends it.
   *
   * @param event - The event.
   */
  public receive(event: SessionEvent): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}
