import type { ReactNode } from "react";
import type { Stopping } from "./console-state.ts";
import { STOP_CANCEL_ID } from "./stop-request.ts";

/** What the confirmation of a stop needs. */
export interface StopConfirmationProps {
  /** Where the request to stop is. */
  readonly stopping: Stopping;
  /** The address of the session without the confirmation. */
  readonly cancel: string;
  /** Asks the instance to stop the session. */
  readonly onStop: () => void;
}

/**
 * What stands between a person and the stop of a session: what stopping does, the way out, and the button
 * that stops. It opens from the bar of the session, by an address, so that one press never stops anything;
 * while the request is on its way the button cannot be pressed again, and a request the instance refused is
 * told under it, the button free to ask again.
 *
 * @param props - Where the request is, the way out, and what stops.
 * @returns The confirmation.
 */
export function StopConfirmation({ stopping, cancel, onStop }: StopConfirmationProps): ReactNode {
  return (
    <section className="session-stop" aria-labelledby="session-stop-title">
      <h2 id="session-stop-title" className="session-stop-title">
        Arrêter cette session ?
      </h2>
      <p className="session-stop-note">
        Ses agents s’arrêtent dès qu’ils rendent la main, et la session ne reprend pas. Ce qu’ils ont écrit reste dans le dépôt de tests.
      </p>
      <div className="session-stop-actions">
        <a id={STOP_CANCEL_ID} className="btn" href={cancel}>
          Annuler
        </a>
        <button type="button" className="btn danger" onClick={onStop} disabled={stopping.state === "sending"}>
          Arrêter la session
        </button>
      </div>
      {stopping.state === "refused" && (
        <p className="session-stop-refused" role="alert">
          {stopping.message}
        </p>
      )}
    </section>
  );
}
