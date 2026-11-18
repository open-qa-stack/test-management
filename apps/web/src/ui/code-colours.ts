/** A run of a line of code, with the colour of what it is: a variable of the sheet, such as `var(--code-token-keyword)`. */
export interface CodeToken {
  readonly text: string;
  readonly colour: string | undefined;
}

/** Colours the lines of a file of tests: the runs of each line, a line for a line. */
export type CodeColours = (lines: readonly string[]) => readonly (readonly CodeToken[])[];

/**
 * Loads the grammar of TypeScript, in which the tests are written, with the engine of regular expressions of
 * JavaScript: no WebAssembly reaches the browser. All of it is loaded apart from the console, when code is first
 * drawn, in a theme whose colours are variables of the sheet, so that the code takes the colours of the console.
 *
 * @returns What colours the lines of a file. It colours a file once, however often the thread is drawn again.
 */
export async function loadCodeColours(): Promise<CodeColours> {
  const [{ createCssVariablesTheme, createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
  ]);
  const highlighter = await createHighlighterCore({
    themes: [createCssVariablesTheme({ name: "console", variablePrefix: "--code-", fontStyle: false })],
    langs: [import("shiki/langs/typescript.mjs")],
    engine: createJavaScriptRegexEngine(),
  });
  const coloured = new WeakMap<readonly string[], readonly (readonly CodeToken[])[]>();
  return (lines) => {
    const known = coloured.get(lines);
    if (known !== undefined) return known;
    const tokens = highlighter
      // A file of tests is short: it is coloured whole, however slow the machine, rather than left plain from a line on.
      .codeToTokensBase(lines.join("\n"), { lang: "typescript", theme: "console", tokenizeTimeLimit: 0 })
      .map((line) => line.map((token) => ({ text: token.content, colour: token.color })));
    coloured.set(lines, tokens);
    return tokens;
  };
}
