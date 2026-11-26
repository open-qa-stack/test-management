import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { t } from "../i18n/i18n.ts";
import type { Opening } from "./console-state.ts";
import type { ScopeChoices } from "./scope-choices.ts";
import { ScopePicker } from "./scope-picker.tsx";

/** What the form of a request needs. */
export interface RequestFormProps {
  /** Where the opening of a session is. */
  readonly opening: Opening;
  /** The request the address already writes; none by default. */
  readonly request?: string;
  /** Opens the session the form asks for. */
  readonly onOpen?: (event: FormEvent<HTMLFormElement>) => void;
  /** What a session may be kept to; none until the configuration was read. */
  readonly choices?: ScopeChoices;
}

/**
 * Sends the form of the request when the person presses Ctrl+Enter in its field, or Cmd+Enter on a Mac; Enter alone starts a new line.
 *
 * @param event - The key pressed in the field.
 */
function startOnKeys(event: KeyboardEvent<HTMLTextAreaElement>): void {
  if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.nativeEvent.isComposing) return;
  event.preventDefault();
  event.currentTarget.form!.requestSubmit();
}

/**
 * The request that opens a session: its field, what of the project to keep the session to, and the button that sends
 * it, which waits for a word. While the request is on its way nothing else can be sent; a refusal is said beside the button.
 *
 * @param props - Where the opening is, the request the address writes, what opens the session, and the choices of its scope.
 * @returns The form.
 */
export function RequestForm({ opening, request, onOpen, choices }: RequestFormProps): ReactNode {
  const sending = opening.state === "sending";
  const unwritten = (request ?? "").trim() === "";
  const [blank, setBlank] = useState(unwritten);
  // The field starts again from the request the address writes, and so does the button.
  useEffect(() => setBlank(unwritten), [unwritten]);
  return (
    <form className="agent-home-prompt" onSubmit={onOpen}>
      <label className="sr-only" htmlFor="agent-home-request">
        {t("home.requestLabel")}
      </label>
      <textarea
        key={request}
        id="agent-home-request"
        name="request"
        defaultValue={request}
        required
        disabled={sending}
        placeholder={t("home.requestPlaceholder")}
        onChange={(event) => setBlank(event.currentTarget.value.trim() === "")}
        onKeyDown={startOnKeys}
      />
      {choices !== undefined && <ScopePicker choices={choices} disabled={sending} />}
      <div className="agent-home-actions">
        {opening.state === "refused" && (
          <span className="small agent-home-refused" role="alert">
            {opening.message}
          </span>
        )}
        <button type="submit" className="btn primary" disabled={sending || blank} aria-keyshortcuts="Control+Enter Meta+Enter">
          {t(sending ? "home.sending" : "home.start")}
        </button>
      </div>
    </form>
  );
}
