import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { Icon } from "../ui/icon.tsx";
import type { Sending } from "./console-state.ts";

/** What the composer of a session needs. */
export interface ComposerProps {
  /** Where the message the person sends is. */
  readonly saying: Sending;
  /** Whether the session ended: what the person sends then resumes it, for a new turn of its work. */
  readonly ended: boolean;
  /** Sends what the field holds. */
  readonly onSay: (event: FormEvent<HTMLFormElement>) => void;
  /** Hears the keys of the field: Enter sends, as in a conversation. */
  readonly onKey: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

/** What the composer says, while the session goes on and once it ended. */
const WORDS = {
  going: { asks: "Dites aux agents ce qu’il faut corriger", sends: "Envoyer" },
  ended: { asks: "Dites aux agents quoi faire ensuite : corriger un test, ajouter un scénario…", sends: "Poursuivre la session" },
} as const;

/**
 * Where the person speaks to the agents, under the thread: a field and its button. While the session goes on, what
 * they send corrects its direction; once it ended, what they send resumes it for a new turn, under the turns before.
 * While a message is on its way nothing else can be sent; a message the instance refused stays in the field, under
 * which the console says why.
 *
 * @param props - Where the message sent is, whether the session ended, and what sends one.
 * @returns The composer.
 */
export function Composer({ saying, ended, onSay, onKey }: ComposerProps): ReactNode {
  const sending = saying.state === "sending";
  const words = WORDS[ended ? "ended" : "going"];
  return (
    <form className="composer" onSubmit={onSay}>
      <div className="composer-field">
        <label className="sr-only" htmlFor="composer-message">
          {words.asks}
        </label>
        <textarea
          id="composer-message"
          name="message"
          rows={2}
          disabled={sending}
          placeholder={`${words.asks}…`}
          onKeyDown={onKey}
          aria-describedby={saying.state === "refused" ? "composer-refused" : undefined}
        />
        <button type="submit" className="btn primary" disabled={sending}>
          <Icon name="send" />
          <span className="btn-label">{words.sends}</span>
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
