import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { MAX_TEST_TEXT } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { SidePanel } from "../ui/side-panel.tsx";

/** Where the saving of a text of a test stands: going on, or refused with why. */
export interface TextSaving {
  readonly pending: boolean;
  readonly refusal?: string;
}

/** What the panel that changes a text of a test is drawn from. */
export interface TestTextPanelProps {
  /** What the panel is about, such as the title of the test or one of its steps. */
  readonly title: string;
  /** The label of the field. */
  readonly label: string;
  /** What the field asks for, in a sentence. */
  readonly hint: string;
  /** The text as the file has it. */
  readonly value: string;
  /** The link that closes the panel. */
  readonly close: string;
  /** Where the saving stands. */
  readonly saving: TextSaving;
  /** Why the text cannot be saved as it is, beside the rules every text keeps to, if anything. */
  readonly refuse?: (text: string) => string | undefined;
  /** Saves the text, trimmed. */
  readonly onSave: (text: string) => void;
}

/** The identifier of the title of the panel, and of its form. */
const PANEL = "test-text-panel";

/** Why the console does not send a text: an empty one, or one too long. */
function refusalOf(text: string): string | undefined {
  if (text === "") return t("test.textEmpty");
  return text.length > MAX_TEST_TEXT ? t("test.textLong", { max: MAX_TEST_TEXT }) : undefined;
}

/**
 * A text of a test — its title, or one of its steps — changed in a side panel: one field, and what saves it or leaves
 * it as it is. A text is one line: the field wraps it, and Enter saves it.
 *
 * @param props - What the panel is about, the text, where its saving stands and what saves it.
 * @returns The panel.
 */
export function TestTextPanel({ title, label, hint, value, close, saving, refuse, onSave }: TestTextPanelProps): ReactNode {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState<string | undefined>(undefined);
  const trimmed = text.trim();
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const refusal = refusalOf(trimmed) ?? refuse?.(trimmed);
    setShown(refusal);
    if (refusal === undefined && trimmed !== value) onSave(trimmed);
  };
  const enter = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.currentTarget.form!.requestSubmit();
  };
  const error = shown ?? saving.refusal;
  const footer = (
    <div className="save-bar action-bar">
      <span className="small muted save-state" role="status">
        {saving.pending ? t("test.saving") : ""}
      </span>
      <a className="btn ghost" href={close}>
        {t("test.cancel")}
      </a>
      <button type="submit" form={PANEL} className="btn primary" disabled={saving.pending || trimmed === value}>
        {t("test.save")}
      </button>
    </div>
  );
  return (
    <SidePanel id={`${PANEL}-title`} title={title} close={close} footer={footer}>
      <form id={PANEL} className="config-field" onSubmit={submit} noValidate>
        <label htmlFor={`${PANEL}-text`}>{label}</label>
        <span id={`${PANEL}-hint`} className="field-hint">
          {hint}
        </span>
        <textarea
          id={`${PANEL}-text`}
          className="test-text"
          rows={3}
          value={text}
          maxLength={MAX_TEST_TEXT + 1}
          onChange={(event) => setText(event.target.value.replaceAll(/[\r\n]+/g, " "))}
          onKeyDown={enter}
          aria-invalid={error !== undefined}
          aria-describedby={error === undefined ? `${PANEL}-hint` : `${PANEL}-hint ${PANEL}-error`}
        />
        {error !== undefined && (
          <p id={`${PANEL}-error`} className="field-error" role="alert">
            {error}
          </p>
        )}
        <p className="field-hint">{t("test.writtenNote")}</p>
      </form>
    </SidePanel>
  );
}
