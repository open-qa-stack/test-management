import type { ReactNode } from "react";
import type { Look } from "./look.ts";

/**
 * What an agent looked at: a file, or the page a browser tool rendered for it.
 *
 * @param props - The look, and what the agent did, in a sentence, which captions it.
 * @returns The look, drawn as its kind asks, with its caption.
 */
export function LookView({ look, caption }: { readonly look: Look; readonly caption: string }): ReactNode {
  return (
    <div className="look">
      <div className="look-frame">
        {look.kind === "code" ? (
          <pre className="look-code mono">
            {look.lines.map((line, index) => (
              <span key={index} className="look-line">
                {line === "" ? " " : line}
              </span>
            ))}
          </pre>
        ) : (
          <ul className="look-document">
            {look.excerpt.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="small muted">{caption}</div>
    </div>
  );
}
