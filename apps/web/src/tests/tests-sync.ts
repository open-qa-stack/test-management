import type { ApiClient } from "../api/api-client.ts";
import { poll } from "../api/poll.ts";
import type { TestsAction } from "./tests-state.ts";

/** How long the screen waits between an answer of the API and the next time it lists the tests, in milliseconds. */
export const LIST_PAUSE_MS = 5000;

/**
 * What keeps the screen of the tests in step with their instance: it lists the tests of the repository again and
 * again, so that the screen shows a test a design or a person added, changed or removed, and tells the state.
 */
export class TestsSync {
  readonly #api: ApiClient;
  readonly #dispatch: (action: TestsAction) => void;

  /**
   * @param api - The API of the instance.
   * @param dispatch - What applies an action to the state of the screen.
   */
  public constructor(api: ApiClient, dispatch: (action: TestsAction) => void) {
    this.#api = api;
    this.#dispatch = dispatch;
  }

  /** @returns What stops listing them. */
  public read(): () => void {
    return poll(
      {
        ask: () => this.#api.tests(),
        told: (tests) => this.#dispatch({ type: "listed", tests }),
        failed: (error) => this.#dispatch({ type: "unread", message: error.message }),
      },
      LIST_PAUSE_MS,
    );
  }
}
