import { useSyncExternalStore, type ReactNode } from "react";
import { loadCodeColours, type CodeColours } from "./code-colours.ts";
import { CodeColoursStore } from "./code-colours-store.ts";

/** What colours the code of the console, loaded once for every block of code. */
const COLOURS = new CodeColoursStore(loadCodeColours);

/** What draws a block of code: its lines, the class of the block, and what colours them once loaded. */
export interface CodeLinesProps {
  readonly lines: readonly string[];
  readonly className: string;
  readonly colours: CodeColours | undefined;
}

/**
 * A block of code, a line under a line, coloured when it can be.
 *
 * @param props - The lines, the class of the block, and what colours them, when loaded.
 * @returns The block; an empty line keeps its height.
 */
export function CodeLines({ lines, className, colours }: CodeLinesProps): ReactNode {
  const coloured = colours?.(lines);
  return (
    <pre className={`${className} code mono`}>
      {lines.map((line, index) => (
        <span key={index} className="code-line">
          {line === ""
            ? " "
            : (coloured?.[index]?.map((token, at) => (
                <span key={at} style={{ color: token.colour }}>
                  {token.text}
                </span>
              )) ?? line)}
        </span>
      ))}
    </pre>
  );
}

/**
 * A block of code of the console, coloured once what colours it is loaded.
 *
 * @param props - The lines and the class of the block.
 * @returns The block.
 */
export function Code({ lines, className }: { readonly lines: readonly string[]; readonly className: string }): ReactNode {
  const colours = useSyncExternalStore(COLOURS.subscribe, COLOURS.snapshot, () => undefined);
  return <CodeLines lines={lines} className={className} colours={colours} />;
}
