import type { ApiError } from "./api-error.ts";

/** What a poll asks the API, and what it does with what comes back. */
export interface Polled<T> {
  /** Asks once. */
  readonly ask: () => Promise<T>;
  /** The answer came. */
  readonly told: (answer: T) => void;
  /** The call failed. */
  readonly failed: (error: ApiError) => void;
}

/**
 * Asks the API the same question again and again, until stopped.
 *
 * @remarks
 * A question is asked only once the one before was answered, and a pause passed: answers come in the order of
 * their questions, and a slow instance is not asked faster than it answers. Nothing is asked while the page is
 * hidden; the poll resumes when it shows again. Once stopped, an answer still on its way is dropped.
 *
 * @param polled - What to ask, and what to do with the answer or the failure.
 * @param pauseMs - How long to wait between an answer and the next question, in milliseconds.
 * @returns What stops the poll.
 */
export function poll<T>(polled: Polled<T>, pauseMs: number): () => void {
  let waiting: number | undefined;
  let asking = false;
  let stopped = false;
  const settle = (apply: () => void): void => {
    asking = false;
    if (stopped) return;
    apply();
    // Stopped by what it just applied, the poll asks nothing more.
    if (!stopped) waiting = window.setTimeout(round, pauseMs);
  };
  const round = (): void => {
    waiting = undefined;
    if (document.hidden) return;
    asking = true;
    polled.ask().then(
      (answer) => settle(() => polled.told(answer)),
      (error: ApiError) => settle(() => polled.failed(error)),
    );
  };
  const resume = (): void => {
    if (waiting === undefined && !asking) round();
  };
  document.addEventListener("visibilitychange", resume);
  round();
  return () => {
    stopped = true;
    window.clearTimeout(waiting);
    document.removeEventListener("visibilitychange", resume);
  };
}
