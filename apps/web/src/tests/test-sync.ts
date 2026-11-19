import type { ApiClient } from "../api/api-client.ts";
import { poll } from "../api/poll.ts";
import type { TestAction } from "./test-state.ts";

/** How long the screen waits between an answer of the API and the next time it reads the test, in milliseconds. */
export const READ_PAUSE_MS = 5000;

/**
 * What keeps the screen of a test in step with its instance: it reads the test in steps again and again, so that
 * the screen shows the run that ran it last, and tells the state.
 */
export class TestSync {
  readonly #api: ApiClient;
  readonly #dispatch: (action: TestAction) => void;

  /**
   * @param api - The API of the instance.
   * @param dispatch - What applies an action to the state of the screen.
   */
  public constructor(api: ApiClient, dispatch: (action: TestAction) => void) {
    this.#api = api;
    this.#dispatch = dispatch;
  }

  /**
   * @param path - The path of the test, relative to the root of the test repository.
   * @returns What stops reading it.
   */
  public read(path: string): () => void {
    return poll(
      {
        ask: () => this.#api.testReading(path),
        told: (reading) => this.#dispatch({ type: "read", reading }),
        failed: (error) => this.#dispatch({ type: "unread", message: error.message }),
      },
      READ_PAUSE_MS,
    );
  }
}
