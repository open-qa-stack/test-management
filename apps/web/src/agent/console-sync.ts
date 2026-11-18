import type { Session } from "@open-qa-stack/shared/sessions";
import type { ApiClient } from "../api/api-client.ts";
import type { ApiError } from "../api/api-error.ts";
import { followEvents } from "../api/event-stream.ts";
import { poll } from "../api/poll.ts";
import type { ConsoleAction } from "./console-state.ts";

/** How long the console waits between an answer of the API and the next time it asks the same, in milliseconds. */
export const PAUSE_MS = 2000;

/**
 * What keeps the state of the console in step with its instance: it asks the API, follows the stream of a
 * session, and tells the state what came back. Whatever it starts, it gives what stops it.
 */
export class ConsoleSync {
  readonly #api: ApiClient;
  readonly #dispatch: (action: ConsoleAction) => void;
  /** How many lists were asked and sessions opened so far: the rank of the last, which orders their answers. */
  #calls = 0;

  /**
   * @param api - The API of the instance.
   * @param dispatch - What applies an action to the state of the console.
   */
  public constructor(api: ApiClient, dispatch: (action: ConsoleAction) => void) {
    this.#api = api;
    this.#dispatch = dispatch;
  }

  /**
   * Reads the project, again for as long as the API fails to describe it: it does not change while the console is open.
   *
   * @returns What stops reading it.
   */
  public project(): () => void {
    const stop = poll(
      {
        ask: () => this.#api.project(),
        told: (project) => {
          this.#dispatch({ type: "project", project });
          stop();
        },
        failed: (error) => this.#unanswered(error),
      },
      PAUSE_MS,
    );
    return stop;
  }

  /**
   * Lists the sessions of the project, again and again: the entry of the agent shows them as they are now.
   *
   * @returns What stops listing them.
   */
  public sessions(): () => void {
    return poll(
      {
        ask: async () => {
          this.#calls += 1;
          const askedAt = this.#calls;
          return { askedAt, sessions: await this.#api.sessions() };
        },
        told: ({ askedAt, sessions }) => this.#dispatch({ type: "sessions", sessions, askedAt }),
        failed: (error) => {
          this.#unanswered(error);
          if (error.code !== "unreachable") this.#dispatch({ type: "unlisted", message: error.message });
        },
      },
      PAUSE_MS,
    );
  }

  /**
   * Follows a session: its stream of events, and the session itself, read on arrival and once its stream
   * ended, when the API knows what it came to. A session the instance does not keep is no longer followed.
   *
   * @param id - The identifier of the session.
   * @returns What leaves the session.
   */
  public follow(id: string): () => void {
    this.#dispatch({ type: "followed", id });
    const stopStream = followEvents(id, {
      events: (events) => this.#dispatch({ type: "events", id, events }),
      state: (state) => {
        this.#dispatch({ type: "stream", id, state });
        if (state !== "ended") return;
        stopReading();
        stopReading = this.#read(id, stopStream);
      },
    });
    let stopReading = this.#read(id, stopStream);
    return () => {
      stopStream();
      stopReading();
      this.#dispatch({ type: "left" });
    };
  }

  /**
   * Opens a session.
   *
   * @param request - What to test, in the words of the person.
   * @param opened - What to do once the API opened it.
   */
  public open(request: string, opened: (session: Session) => void): void {
    this.#dispatch({ type: "opening" });
    this.#api.open({ request }).then(
      (session) => {
        this.#calls += 1;
        this.#dispatch({ type: "opened", session, answeredAt: this.#calls });
        opened(session);
      },
      (error: ApiError) => this.#dispatch({ type: "refused", message: error.message }),
    );
  }

  /** Reads a session until the API told it, or said it keeps none of that name. */
  #read(id: string, missing: () => void): () => void {
    const stop = poll(
      {
        ask: () => this.#api.session(id),
        told: (session) => {
          this.#dispatch({ type: "session", session });
          stop();
        },
        failed: (error) => {
          this.#unanswered(error);
          if (error.code !== "unknown_session") return;
          this.#dispatch({ type: "missing", id });
          stop();
          missing();
        },
      },
      PAUSE_MS,
    );
    return stop;
  }

  /** Says the instance unreachable when that is why a call failed: any other failure is an answer. */
  #unanswered(error: ApiError): void {
    if (error.code === "unreachable") this.#dispatch({ type: "unreachable" });
  }
}
