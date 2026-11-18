const SPACE = /\s/;

/** A command without a shell: its program, then its arguments. */
export type CommandLine = readonly [program: string, ...arguments: string[]];

/**
 * Splits a command into its program and its arguments, the way a shell separates words, without being one.
 *
 * @remarks
 * Spaces separate the words; a part between two `'` or two `"` is taken as it is, spaces included. Nothing
 * else is special: no variable, no escape, no substitution.
 *
 * @param text - The command, such as `node "/my clone/packages/cli/src/main.ts"`.
 * @returns The program, then its arguments; `undefined` when a quote is not closed or the command names no program.
 */
export function splitCommandLine(text: string): CommandLine | undefined {
  const words: string[] = [];
  let word = "";
  let started = false;
  let quote: string | undefined;
  for (const character of text) {
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else word += character;
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (!SPACE.test(character)) {
      word += character;
      started = true;
    } else if (started) {
      words.push(word);
      word = "";
      started = false;
    }
  }
  if (started) words.push(word);
  const [program, ...rest] = words;
  return quote !== undefined || program === undefined || program === "" ? undefined : [program, ...rest];
}
