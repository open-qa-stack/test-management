import { useState, type ReactNode } from "react";
import { t } from "../i18n/i18n.ts";
import { Icon } from "./icon.tsx";

/** Where a copy is: not asked, done, or refused by the browser. */
type Copy = "idle" | "copied" | "failed";

/** What a button that copies needs. */
export interface CopyButtonProps {
  /** What it copies. */
  readonly text: string;
  /** What it copies, in words: its name for a screen reader, or what it reads when it is the primary action. */
  readonly label: string;
  /** Whether the text is a link of the console, which is copied whole, its address included. */
  readonly link?: boolean;
  /** Whether it is the primary action of its screen, which reads its label; an icon alone otherwise. */
  readonly primary?: boolean;
}

/**
 * A button that copies a text, such as the name of a branch or the link of a trace, and says once it did; when the
 * browser refuses, or offers no clipboard to a page it does not serve securely, it says to select the text instead.
 *
 * @param props - The text, what it is, whether it is a link, and whether the button is the primary action.
 * @returns The button, and what came of the copy.
 */
export function CopyButton({ text, label, link = false, primary = false }: CopyButtonProps): ReactNode {
  const [copy, setCopy] = useState<Copy>("idle");
  const copied = (): void => setCopy("copied");
  const failed = (): void => setCopy("failed");
  const copyText = (): void => {
    const copiedText = link ? new URL(text, document.baseURI).href : text;
    if ("clipboard" in navigator) void navigator.clipboard.writeText(copiedText).then(copied, failed);
    else failed();
  };
  return (
    <>
      {primary ? (
        <button type="button" className="btn primary copy-button" onClick={copyText}>
          <Icon name={copy === "copied" ? "check" : "copy"} /> {label}
        </button>
      ) : (
        <button type="button" className="btn ghost sm copy-button" aria-label={label} onClick={copyText}>
          <Icon name={copy === "copied" ? "check" : "copy"} />
        </button>
      )}
      <span className={copy === "failed" ? "copy-state failed" : "copy-state sr-only"} role="status">
        {copy === "idle" ? "" : t(`copy.${copy}`)}
      </span>
    </>
  );
}
