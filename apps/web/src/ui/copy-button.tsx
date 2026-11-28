import { useState, type ReactNode } from "react";
import { t } from "../i18n/i18n.ts";
import { Icon } from "./icon.tsx";

/** Where a copy is: not asked, done, or refused by the browser. */
type Copy = "idle" | "copied" | "failed";

/**
 * A button that copies a text, such as the name of a branch, and says once it did; when the browser refuses, or offers
 * no clipboard to a page it does not serve securely, it says to select the text instead.
 *
 * @param props - The text, and what the button copies, for a screen reader.
 * @returns The button, and what came of the copy.
 */
export function CopyButton({ text, label }: { readonly text: string; readonly label: string }): ReactNode {
  const [copy, setCopy] = useState<Copy>("idle");
  const copied = (): void => setCopy("copied");
  const failed = (): void => setCopy("failed");
  const copyText = (): void => {
    if ("clipboard" in navigator) void navigator.clipboard.writeText(text).then(copied, failed);
    else failed();
  };
  return (
    <>
      <button type="button" className="btn ghost sm copy-button" aria-label={label} onClick={copyText}>
        <Icon name={copy === "copied" ? "check" : "copy"} />
      </button>
      <span className={copy === "failed" ? "copy-state failed" : "copy-state sr-only"} role="status">
        {copy === "idle" ? "" : t(`copy.${copy}`)}
      </span>
    </>
  );
}
