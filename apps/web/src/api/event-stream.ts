import { hasEnded, type SessionEvent } from "@open-qa-stack/domain/sessions";
import { API_BASE } from "./api-client.ts";

/**
 * Where a stream of events is: `connecting` until it first opens, `open` while it receives, `reconnecting`
 * after a cut, until it opens again, and `ended` once the session is over: nothing more will come.
 */
export type StreamState = "connecting" | "open" | "reconnecting" | "ended";

/** What the stream of a session tells whoever follows it. */
export interface StreamListener {
  /** Events arrived, in order; several at once when they came close together. */
  readonly events: (events: readonly SessionEvent[]) => void;
  /** The stream changed state. */
  readonly state: (state: StreamState) => void;
}

/** How long the stream gathers events before it hands them over, in milliseconds. */
export const GATHER_MS = 40;

/** How long the stream waits before it connects again after a first cut, in milliseconds; twice as long after each further one. */
export const RETRY_MS = 500;

/** The longest the stream waits before it connects again, in milliseconds. */
export const LONGEST_RETRY_MS = 8000;

/** The event a frame of the stream carries; none for a frame that is not JSON, or not an event. */
function eventOf(data: string): SessionEvent | undefined {
  try {
    const frame = JSON.parse(data) as Partial<SessionEvent> | null;
    return typeof frame?.id === "number" && typeof frame.type === "string" ? (frame as SessionEvent) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Follows the events of a session until it is over. Events that come close together are handed over at once.
 *
 * @remarks
 * The stream connects again by itself after every cut, whatever cut it: a browser gives up for good on an
 * answer that is not a success, so the stream never leaves reconnecting to it. Each new connection asks for
 * the events after the last one received, so that none comes twice, and waits longer than the one before for
 * as long as nothing comes. The event that says the session no longer goes on ends the stream: the API
 * completes it there, and connecting again would only ask for nothing. A session that waits its turn goes
 * on: its stream stays open, and gives what its agents do once they start.
 *
 * @param id - The identifier of the session.
 * @param listener - What to tell.
 * @returns What stops following the session.
 */
export function followEvents(id: string, listener: StreamListener): () => void {
  const address = `${API_BASE}/sessions/${encodeURIComponent(id)}/events`;
  let source: EventSource;
  let last: number | undefined;
  let cuts = 0;
  let gathered: SessionEvent[] = [];
  let handing: number | undefined;
  let retry: number | undefined;
  const hand = (): void => {
    handing = undefined;
    listener.events(gathered);
    gathered = [];
  };
  const stop = (): void => {
    source.close();
    window.clearTimeout(handing);
    window.clearTimeout(retry);
  };
  const connect = (): void => {
    source = new EventSource(last === undefined ? address : `${address}?after=${last}`);
    source.onopen = () => listener.state("open");
    source.onerror = () => {
      source.close();
      listener.state("reconnecting");
      retry = window.setTimeout(connect, Math.min(RETRY_MS * 2 ** cuts, LONGEST_RETRY_MS));
      cuts += 1;
    };
    source.onmessage = (message: MessageEvent<string>) => {
      const event = eventOf(message.data);
      if (event === undefined) return;
      last = event.id;
      cuts = 0;
      gathered.push(event);
      if (event.type === "state_changed" && hasEnded(event.state)) {
        stop();
        hand();
        listener.state("ended");
      } else handing ??= window.setTimeout(hand, GATHER_MS);
    };
  };
  connect();
  return stop;
}
