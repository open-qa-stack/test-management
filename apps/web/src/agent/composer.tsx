import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { Icon } from "../ui/icon.tsx";
import type { Sending } from "./console-state.ts";

/** What the composer of a session needs. */
export interface ComposerProps {
  /** Where the message the person sends is. */
  readonly saying: Sending;
  /** Sends what the field holds. */
  readonly onSay: (event: FormEvent<HTMLFormElement>) => void;
  /** Hears the keys of the field: Enter sends, as in a conversation. */
  readonly onKey: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

/**
 * Where the person speaks to the agents until the session ended: a field and its button, under the thread. While a
 * message is on its way nothing else can be sent; a message the instance refused stays in the field, under
 * which the console says why.
 *
 * @param props - Where the message sent is, and what sends one.
 * @returns The composer.
 */
export function Composer({ saying, onSay, onKey }: ComposerProps): ReactNode {
  const sending = saying.state === "sending";
  return (
    <form className="composer" onSubmit={onSay}>
      <div className="composer-field">
        <label className="sr-only" htmlFor="composer-message">
          Dites aux agents ce qu’il faut corriger
        </label>
        <textarea
          id="composer-message"
          name="message"
          rows={2}
          disabled={sending}
          placeholder="Dites aux agents ce qu’il faut corriger…"
          onKeyDown={onKey}
          aria-describedby={saying.state === "refused" ? "composer-refused" : undefined}
        />
        <button type="submit" className="btn primary" disabled={sending}>
          <Icon name="send" />
          <span className="btn-label">Envoyer</span>
        </button>
      </div>
      {saying.state === "refused" && (
        <p id="composer-refused" className="composer-refused" role="alert">
          {saying.message}
        </p>
      )}
    </form>
  );
}
