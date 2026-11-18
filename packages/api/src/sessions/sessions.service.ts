import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { catchError, EMPTY, type Observable, ReplaySubject, takeUntil } from "rxjs";
import { SessionError } from "./session-error.ts";
import { SessionSource } from "./session-source.ts";
import type { MessageReceipt, Project, Session, SessionEvent, SessionMessage, SessionOpening } from "@open-qa-stack/shared/sessions";

/** What a client that names a session the source does not hold is told. */
function unknownSession(id: string): SessionError {
  return new SessionError("unknown_session", `No session ${id}.`);
}

/** The project and the sessions of the instance, read from their source for the routes. */
@Injectable()
export class SessionsService implements OnModuleDestroy {
  readonly #source: SessionSource;
  readonly #logger = new Logger("Sessions");
  /** Replayed, so that a stream subscribed to once the API closes ends at once instead of holding the server open. */
  readonly #closing = new ReplaySubject<void>(1);

  constructor(source: SessionSource) {
    this.#source = source;
  }

  /** @returns The project of the instance. */
  project(): Promise<Project> {
    return this.#source.project();
  }

  /** @returns Every session, the latest first. */
  sessions(): Promise<Session[]> {
    return this.#source.sessions();
  }

  /**
   * @param id - The identifier of a session.
   * @returns The session as it is now.
   * @throws {@link SessionError} `unknown_session` when there is none.
   */
  async session(id: string): Promise<Session> {
    const session = await this.#source.session(id);
    if (session === undefined) throw unknownSession(id);
    return session;
  }

  /**
   * Follows the events of a session.
   *
   * @param id - The identifier of the session.
   * @param after - The identifier of the last event the client got; 0 for every event.
   * @returns The events after that one, then each new one as it happens. The stream ends once the session is
   * no longer running, when the events can no longer be read, which is logged, and when the API closes.
   * @throws {@link SessionError} `unknown_session` when there is no such session.
   */
  async events(id: string, after: number): Promise<Observable<SessionEvent>> {
    await this.session(id);
    return this.#source.events(id, after).pipe(
      catchError((error: unknown) => {
        this.#logger.warn(`The events of the session ${id} can no longer be read: ${error instanceof Error ? error.message : String(error)}`);
        return EMPTY;
      }),
      takeUntil(this.#closing),
    );
  }

  /**
   * Opens a session.
   *
   * @param opening - What to test, and where.
   * @returns The session, running.
   * @throws {@link SessionError} What the source raises when it cannot open the session.
   */
  open(opening: SessionOpening): Promise<Session> {
    return this.#source.open(opening);
  }

  /**
   * Takes a message a person sends to a session that is going on.
   *
   * @param id - The identifier of the session.
   * @param message - What the person says.
   * @returns The receipt, which numbers the message: the events of the session tell its delivery later.
   * @throws {@link SessionError} `unknown_session` when there is no such session, and what the source raises
   * when it cannot take the message.
   */
  async send(id: string, message: SessionMessage): Promise<MessageReceipt> {
    const receipt = await this.#source.send(id, message);
    if (receipt === undefined) throw unknownSession(id);
    return receipt;
  }

  /** Ends every stream of events, those still open and those opened from now on, so that the server can close. */
  onModuleDestroy(): void {
    this.#closing.next();
  }
}
