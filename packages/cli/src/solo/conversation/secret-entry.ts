import { Box, Text, useInput } from "ink";
import { createElement as h, useState, type ReactNode } from "react";
import { t } from "./i18n/i18n.ts";
import { setupField, waitingLine } from "./setup-parts.ts";
import type { Theme } from "./palette.ts";

/** How the typing of the value of a variable ended: saved, left with Esc, or failed for the reason given. */
export interface SecretEnd {
  readonly variable: string;
  readonly saved: boolean;
  readonly error?: string;
}

/** What the typing of the value of a variable needs. */
export interface SecretEntryProps {
  /** The variable whose value is typed. */
  readonly variable: string;
  readonly theme: Theme;
  /** Saves the value of the variable, out of the test repository. */
  readonly save: (variable: string, value: string) => Promise<void>;
  /** Says why something failed, in the words the other commands use. */
  readonly reasonOf: (error: unknown) => string;
  /** Called once, when the typing ends. */
  readonly onEnd: (end: SecretEnd) => void;
}

/**
 * The value of a variable, typed over the input of the conversation without being shown, as `oqas secrets set` reads
 * it in a terminal: Enter saves it, Esc leaves, and nothing is saved.
 *
 * @param props - The variable, the theme, what saves its value, and who hears the end.
 * @returns The field, or what it waits for while the value is saved.
 */
export function SecretEntry({ variable, theme, save, reasonOf, onEnd }: SecretEntryProps): ReactNode {
  const [text, setText] = useState("");
  const [refused, setRefused] = useState(false);
  const [saving, setSaving] = useState(false);
  useInput((_input, key) => {
    if (key.escape && !saving) onEnd({ variable, saved: false });
  });
  const enter = (): void => {
    if (text === "") return setRefused(true);
    setSaving(true);
    save(variable, text).then(
      () => onEnd({ variable, saved: true }),
      (error: unknown) => onEnd({ variable, saved: false, error: reasonOf(error) }),
    );
  };
  return h(
    Box,
    { flexDirection: "column", marginTop: 1 },
    saving
      ? waitingLine(theme, t("secret.saving", { variable }))
      : setupField({
          theme,
          label: t("secret.label", { variable }),
          hint: t("secret.hint"),
          text,
          onType: setText,
          onEnter: enter,
          mask: "*",
          ...(refused ? { refusal: t("secret.refused") } : {}),
        }),
    h(Text, theme.ink("muted"), t("secret.keys")),
  );
}
