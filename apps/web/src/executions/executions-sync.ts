import type { ApiClient } from "../api/api-client.ts";
import { poll } from "../api/poll.ts";
import type { ExecutionsAction } from "./executions-state.ts";

/** How long the screen waits between an answer of the API and the next time it lists the executions, in milliseconds. */
export const EXECUTIONS_PAUSE_MS = 5000;

/**
 * What keeps the screen of the executions in step with their instance: it lists the executions again and again, so
 * that the screen shows the one a session just ran, and tells the state.
 */
export class ExecutionsSync {
  readonly #api: ApiClient;
  readonly #dispatch: (action: ExecutionsAction) => void;

  /**
   * @param api - The API of the instance.
   * @param dispatch - What applies an action to the state of the screen.
   */
  public constructor(api: ApiClient, dispatch: (action: ExecutionsAction) => void) {
    this.#api = api;
    this.#dispatch = dispatch;
  }

  /** @returns What stops listing them. */
  public read(): () => void {
    return poll(
      {
        ask: () => this.#api.executions(),
        told: (executions) => this.#dispatch({ type: "listed", executions }),
        failed: (error) => this.#dispatch({ type: "unread", message: error.message }),
      },
      EXECUTIONS_PAUSE_MS,
    );
  }
}
