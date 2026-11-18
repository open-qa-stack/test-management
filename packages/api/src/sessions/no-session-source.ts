import { EMPTY, type Observable } from "rxjs";
import { SessionError } from "./session-error.ts";
import { SessionSource } from "./session-source.ts";
import type { Project, Session, SessionEvent } from "@open-qa-stack/shared/sessions";

/** The source of an instance that is given none: it has no session, and cannot open one. */
export class NoSessionSource extends SessionSource {
  /** @returns A project without name nor application. */
  override async project(): Promise<Project> {
    return { applications: [] };
  }

  /** @returns No session. */
  override async sessions(): Promise<Session[]> {
    return [];
  }

  /** @returns Nothing: no session exists. */
  override async session(): Promise<undefined> {
    return undefined;
  }

  /** @returns No event. */
  override events(): Observable<SessionEvent> {
    return EMPTY;
  }

  /** @throws {@link SessionError} `unavailable`, always. */
  override async open(): Promise<never> {
    throw new SessionError("unavailable", "No source of sessions is configured: set OQAS_SOLO_REPOSITORY to the test repository whose runs are the sessions.");
  }
}
