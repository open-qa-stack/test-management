import { hasEnded, type Session } from "@open-qa-stack/domain/sessions";
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
  /** What hears the session followed as the API tells it, which follows its stream again when it went on after an end. */
  #told: ((session: Session) => void) | undefined;

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
   * Follows a session: its stream of events, and the session itself, read on arrival and each time its stream
   * says it changed state — it started, or it ended and the API knows what it came to. A session the
   * instance does not keep is no longer followed. A stream ends with an end of the session: one the API tells
   * the session went on from — a person resumed it — is followed again, after the last event received.
   *
   * @param id - The identifier of the session.
   * @returns What leaves the session.
   */
  public follow(id: string): () => void {
    this.#dispatch({ type: "followed", id });
    let last: number | undefined;
    let ended = false;
    let stopStream: () => void;
    // The stream followed now, whichever it is: the session is followed again after an end it went on from.
    const leaveStream = (): void => stopStream();
    const stream = (): void => {
      ended = false;
      stopStream = followEvents(
        id,
        {
          events: (events) => {
            last = events.at(-1)!.id;
            this.#dispatch({ type: "events", id, events });
            if (!events.some(({ type }) => type === "state_changed")) return;
            stopReading();
            stopReading = this.#read(id, leaveStream);
          },
          state: (state) => {
            ended = state === "ended";
            this.#dispatch({ type: "stream", id, state });
          },
        },
        last,
      );
    };
    this.#told = (session) => {
      if (session.id === id && ended && !hasEnded(session.state)) stream();
    };
    stream();
    let stopReading = this.#read(id, leaveStream);
    return () => {
      this.#told = undefined;
      leaveStream();
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

  /**
   * Sends a message to the agents of a session that goes on. The message shows in the thread once the stream of
   * the session gives it, not before: what the thread shows is what the instance took.
   *
   * @param id - The identifier of the session.
   * @param text - What the person says.
   */
  public say(id: string, text: string): void {
    this.#dispatch({ type: "saying", id });
    this.#api.say(id, { text }).then(
      () => this.#dispatch({ type: "said", id }),
      (error: ApiError) => this.#dispatch({ type: "unsaid", id, message: error.message }),
    );
  }

  /**
   * Resumes a session that ended with what the person says more to it. The session is told as the API answered
   * it, and its stream followed again: the new turn shows in the thread as the stream gives it. One the API says
   * goes on — somebody resumed it first — is read again, and followed as it goes on.
   *
   * @param id - The identifier of the session.
   * @param text - What the person asks of the new turn.
   */
  public resume(id: string, text: string): void {
    this.#dispatch({ type: "saying", id });
    this.#api.resume(id, { text }).then(
      (session) => {
        this.#dispatch({ type: "said", id });
        this.#heard(session);
      },
      (error: ApiError) => {
        this.#dispatch({ type: "unsaid", id, message: error.message });
        if (error.code === "session_running")
          this.#api.session(id).then(
            (session) => this.#heard(session),
            (missed: ApiError) => this.#unanswered(missed),
          );
      },
    );
  }

  /**
   * Asks the instance to stop a session that goes on. The session shows as stopped once its stream says so,
   * not before: one another process runs goes on until that process obeyed.
   *
   * @param id - The identifier of the session.
   * @param taken - What to do once the instance took the request.
   */
  public interrupt(id: string, taken: () => void): void {
    this.#dispatch({ type: "stopping", id });
    this.#api.interrupt(id).then(
      () => {
        this.#dispatch({ type: "stop_asked", id });
        taken();
      },
      (error: ApiError) => this.#dispatch({ type: "unstopped", id, message: error.message }),
    );
  }

  /** Reads a session until the API told it, or said it keeps none of that name. */
  #read(id: string, missing: () => void): () => void {
    const stop = poll(
      {
        ask: () => this.#api.session(id),
        told: (session) => {
          this.#heard(session);
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

  /** Tells the state of the console a session as the API told it, and whoever follows it. */
  #heard(session: Session): void {
    this.#dispatch({ type: "session", session });
    this.#told?.(session);
  }

  /** Says the instance unreachable when that is why a call failed: any other failure is an answer. */
  #unanswered(error: ApiError): void {
    if (error.code === "unreachable") this.#dispatch({ type: "unreachable" });
  }
}
