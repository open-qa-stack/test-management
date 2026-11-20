import { useEffect, useReducer, useRef } from "react";
import { poll } from "./poll.ts";
import { polledAfter, type PolledAction, type PolledState } from "./polled-state.ts";

/** How long a screen waits between an answer of the API and the next time it asks again, in milliseconds. */
export const POLL_PAUSE_MS = 5000;

/**
 * Asks the instance the same question again and again while the screen shows, so that it shows what changed.
 *
 * @param ask - Asks once.
 * @param key - What the question is about: a new key asks a new question; the screen gives its page a new key too, so
 * that the answer to the former one is not shown.
 * @returns The latest answer, and why the instance could not answer.
 */
export function usePolled<T>(ask: () => Promise<T>, key: string, pauseMs: number = POLL_PAUSE_MS): PolledState<T> {
  const [state, dispatch] = useReducer(polledAfter<T>, {});
  const asked = useRef(ask);
  asked.current = ask;
  useEffect(
    () =>
      poll<T>(
        {
          ask: () => asked.current(),
          told: (value) => dispatch({ type: "read", value } as PolledAction<T>),
          failed: (error) => dispatch({ type: "unread", message: error.message }),
        },
        pauseMs,
      ),
    [key, pauseMs],
  );
  return state;
}
