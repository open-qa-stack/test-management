/** The first argument of a test, a step or a group of tests: its title, in any of the three quotes. */
const TITLE = /\b(test(?:\.step|\.describe)?\s*\(\s*)(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;
/** The tags of a test, which say what its scenario is and nothing of what it does. */
const TAGS = /\{\s*tag:\s*\[[^\]]*\]\s*,?\s*\}\s*,/g;
/** A comment that takes its whole line, and a block comment. */
const COMMENT = /^\s*\/\/.*$|\/\*[\s\S]*?\*\//gm;

/**
 * What a test does, whatever its titles, its comments and its layout say: two tests of the same body run the
 * same actions and the same assertions.
 *
 * @param content - The text of a test file.
 * @returns The text without its comments, the titles of its tests, steps and groups and its tags, its spaces collapsed.
 */
export function testBody(content: string): string {
  return content.replace(COMMENT, "").replace(TITLE, "$1").replace(TAGS, "").replace(/\s+/g, " ").trim();
}
