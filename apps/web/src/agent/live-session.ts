import type { Session } from "@open-qa-stack/shared/sessions";
import type { StreamState } from "../api/event-stream.ts";
import type { Frame, Playback } from "./playback.ts";
import type { SessionScript } from "./session-script.ts";

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
  readonly controls: SessionControls;
}
