/** The first argument of a test, a step or a group of tests: its title, in any of the three quotes. */
const TITLE = /\b(test(?:\.step|\.describe)?\s*\(\s*)(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;
/** A comment that takes its whole line, and a block comment. */
const COMMENT = /^\s*\/\/.*$|\/\*[\s\S]*?\*\//gm;

/**
 * What a test does, whatever its titles, its comments and its layout say: two tests of the same body run the
 * same actions and the same assertions.
 *
 * @param content - The text of a test file.
 * @returns The text without its comments and the titles of its tests, steps and groups, its spaces collapsed.
 */
export function testBody(content: string): string {
  return content.replace(COMMENT, "").replace(TITLE, "$1").replace(/\s+/g, " ").trim();
}
