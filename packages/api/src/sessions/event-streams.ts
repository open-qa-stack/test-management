import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { catchError, EMPTY, Observable, ReplaySubject, takeUntil } from "rxjs";
import type { SessionEvent } from "@open-qa-stack/domain/sessions";
import type { SessionEventStream } from "@open-qa-stack/engine";

/**
 * The events of the sessions as the HTTP server streams them: the events the operations give, as an
 * observable that ends when the server must close.
 */
@Injectable()
export class EventStreams implements OnModuleDestroy {
  readonly #logger = new Logger("Sessions");
  /** Replayed, so that a stream subscribed to once the API closes ends at once instead of holding the server open. */
  readonly #closing = new ReplaySubject<void>(1);

  /**
   * @param id - The identifier of the session, named in the log.
   * @param events - Its events, as the operations give them to follow.
   * @returns The events, read while they are subscribed to and left when the client leaves. They end once the
   * session ended, when they can no longer be read, which is logged, and when the API closes.
   */
  of(id: string, events: SessionEventStream): Observable<SessionEvent> {
    const followed = new Observable<SessionEvent>((subscriber) =>
      events.subscribe({
        event: (event) => subscriber.next(event),
        ended: () => subscriber.complete(),
        failed: (error) => subscriber.error(error),
      }),
    );
    return followed.pipe(
      catchError((error: unknown) => {
        this.#logger.warn(`The events of the session ${id} can no longer be read: ${error instanceof Error ? error.message : String(error)}`);
        return EMPTY;
      }),
      takeUntil(this.#closing),
    );
  }

  /** Ends every stream of events, those still open and those opened from now on, so that the server can close. */
  onModuleDestroy(): void {
    this.#closing.next();
  }
}
