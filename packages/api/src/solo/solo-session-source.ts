import { Observable } from "rxjs";
import { SessionError } from "../sessions/session-error.ts";
import { SessionSource } from "../sessions/session-source.ts";
import { RunFolder } from "./run-folder.ts";
import { RunLauncher } from "./run-launcher.ts";
import { RunReading } from "./run-reading.ts";
import type { Project, Session, SessionEvent, SessionOpening } from "@open-qa-stack/shared/sessions";
import type { SoloOptions } from "./solo-options.ts";

/**
 * The sessions of an instance that has no worker yet: the runs of the `oqas` command line in a test
 * repository on the same machine. A session is a run, under the identifier of the run; its events are read
 * from the journal and the traces the run writes; opening a session starts a run.
 *
 * @remarks
 * This is a bridge. Workers will write the events of a session to the database of the instance, and a source
 * that reads them there will replace this one.
 *
 * Its one limit: the events of a session are numbered by reading its files from their start, so their
 * identifiers are stable as long as those files only grow, which is what a run does. A file that is
 * rewritten or removed, or a run that writes again after it was called interrupted, renumbers the events
 * that follow, and a client that resumes from an identifier it got before may then miss or get twice an
 * event around it.
 */
export class SoloSessionSource extends SessionSource {
  readonly #folder: RunFolder;
  readonly #launcher: RunLauncher | undefined;
  readonly #now: () => Date;
  readonly #pollMs: number;
  readonly #settleMs: number;

  /** @param options - The test repository, the command that starts `oqas`, the clock and the paces. */
  constructor(options: SoloOptions) {
    super();
    const { repository, command, environment = {}, now = () => new Date(), pollMs = 250, settleMs = 1000, openWaitMs = 30_000 } = options;
    this.#now = now;
    this.#pollMs = pollMs;
    this.#settleMs = settleMs;
    this.#folder = new RunFolder(repository, now);
    this.#launcher = command === undefined ? undefined : new RunLauncher(this.#folder, repository, command, environment, pollMs, openWaitMs);
  }

  /** @returns The project: the test repository and the applications it declares. */
  override project(): Promise<Project> {
    return this.#folder.project();
  }

  /** @returns Each run of the repository as a session, the latest first. */
  override sessions(): Promise<Session[]> {
    return this.#folder.sessions();
  }

  /** @returns The run as a session; `undefined` when the repository holds no such run. */
  override session(id: string): Promise<Session | undefined> {
    return this.#folder.session(id);
  }

  /**
   * @returns The events of the run after the given one, then those it writes: its files are read from their
   * start when the events are subscribed to, then at each pace, until they are left or the run is told
   * completed or interrupted, which ends them. It fails when the repository no longer holds the run.
   */
  override events(id: string, after: number): Observable<SessionEvent> {
    return new Observable((subscriber) => {
      const reading = new RunReading(this.#folder, id, this.#now, this.#settleMs, this.#pollMs);
      let next: NodeJS.Timeout | undefined;
      const read = async (): Promise<void> => {
        try {
          const events = await reading.read();
          if (subscriber.closed) return;
          for (const event of events) {
            if (event.id > after) subscriber.next(event);
            if (event.type === "state_changed" && event.state !== "running") return subscriber.complete();
          }
          next = setTimeout(() => void read(), this.#pollMs);
        } catch (error) {
          subscriber.error(error);
        }
      };
      void read();
      return () => clearTimeout(next);
    });
  }

  /**
   * @returns The session of the run the command started.
   * @throws {@link SessionError} `unavailable` when the command that starts `oqas` is not configured, and
   * what {@link RunLauncher.open} raises.
   */
  override async open(opening: SessionOpening): Promise<Session> {
    if (this.#launcher === undefined) {
      throw new SessionError("unavailable", "This instance reads its sessions and cannot open one: set OQAS_SOLO_COMMAND to the command that starts oqas.");
    }
    return this.#launcher.open(opening);
  }
}
