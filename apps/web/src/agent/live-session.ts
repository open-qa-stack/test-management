import type { FormEvent, KeyboardEvent } from "react";
import type { Session, SessionScript } from "@open-qa-stack/domain/sessions";
import type { StreamState } from "../api/event-stream.ts";
import type { Sending, Stopping } from "./console-state.ts";
import type { Frame, Playback } from "./playback.ts";

/** What the person may do to the session they read. */
export interface SessionControls {
  /** Starts the replay, or stops it where it is. */
  readonly toggle: () => void;
  /** Replays the session from its first step. */
  readonly restart: () => void;
  /** Goes to the next speed. */
  readonly faster: () => void;
  /** Goes to the next decision of the harness. */
  readonly skip: () => void;
  /** Leaves the replay and shows the session as it is now. */
  readonly follow: () => void;
  /** Sends to the agents the message the form of the composer holds. */
  readonly say: (event: FormEvent<HTMLFormElement>) => void;
  /** Resumes a session that stopped without ending, where it stopped. */
  readonly pickUp: () => void;
  /** Asks the instance to stop the session: what the confirmation of a stop does, and nothing else. */
  readonly stop: () => void;
  /** Unfolds a part of the thread, by its key — a long text to be read to the end, a row of actions or of refusals, a stretch of work —; folds it again when it is. */
  readonly unfold: (key: string) => void;
  /** Hears a key of the field of the composer: Enter sends, Shift+Enter starts a new line. */
  readonly sayOnEnter: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

/** A session as the console shows it now. */
export interface LiveSession {
  /** The session, as the API last told it. */
  readonly session: Session;
  /** Where the stream of its events is. */
  readonly stream: StreamState;
  readonly script: SessionScript;
  readonly playback: Playback;
  /** What the playback shows of the script. */
  readonly frame: Frame;
  /** Where the message the person sends to its agents is. */
  readonly saying: Sending;
  /** Where the request of the person to stop it is. */
  readonly stopping: Stopping;
  /** What of its thread the person unfolded, by key. */
  readonly unfolded: readonly string[];
  readonly controls: SessionControls;
}
