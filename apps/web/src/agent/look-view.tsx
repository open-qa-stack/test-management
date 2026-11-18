import type { ReactNode } from "react";
import type { Look } from "./session-script.ts";

/**
 * What an agent looked at: a file, or a text such as the page a browser tool rendered for it.
 *
 * @param props - The look.
 * @returns The look, drawn as its kind asks, with its caption.
 */
export function LookView({ look }: { readonly look: Look }): ReactNode {
  return (
    <div className="look">
      {look.kind === "code" ? (
        <div className="look-frame">
          <div className="look-bar mono xs">{look.file}</div>
          <pre className="look-code mono">
            {look.lines.map((line, index) => (
              <span key={index} className="look-line">
                {line === "" ? " " : line}
              </span>
            ))}
          </pre>
        </div>
      ) : (
        <div className="look-frame">
          <div className="look-bar mono xs">{look.source}</div>
          <ul className="look-document">
            {look.excerpt.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="small muted">{look.caption}</div>
    </div>
  );
}
