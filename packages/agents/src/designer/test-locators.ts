/** A locator a test uses, as far as a screen can vouch for it. */
export interface UsedLocator {
  /** The call as the test writes it, to name it to the agent. */
  readonly code: string;
  /** The role, for a locator by role. */
  readonly role?: string;
  /** The accessible name, the text, the label, the placeholder or the test id it looks for, when it is a string. */
  readonly text?: string;
}

const QUOTED = `(["'\`])((?:\\\\.|(?!\\1).)*)\\1`;
const BY_ROLE = new RegExp(`getByRole\\(\\s*${QUOTED}\\s*(?:,\\s*\\{([^}]*)\\})?\\s*\\)`, "g");
const NAME = new RegExp(`name:\\s*${QUOTED}`);
const BY_TEXT = new RegExp(`getBy(?:Text|Label|Placeholder|TestId|Title|AltText)\\(\\s*${QUOTED}[^)]*\\)`, "g");
const EXPECTED = new RegExp(`\\.to(?:HaveText|ContainText|HaveValue)\\(\\s*${QUOTED}`, "g");

/**
 * The locators a text of a test uses: those by role, with the name they give, and those by text, label,
 * placeholder, test id, title or alternative text.
 *
 * @remarks
 * Only what is written as a string is read: a name or a text given as a regular expression or a variable
 * is left out, for no screen can vouch for it.
 *
 * @param content - Text of a test, or of one of its assertions.
 * @returns The locators, in the order of the text.
 */
export function usedLocators(content: string): UsedLocator[] {
  const byRole = [...content.matchAll(BY_ROLE)].map((match) => {
    const name = NAME.exec(match[3] ?? "")?.[2];
    return { at: match.index, locator: { code: match[0], role: match[2]!, ...(name === undefined ? {} : { text: unescaped(name) }) } };
  });
  const byText = [...content.matchAll(BY_TEXT)].map((match) => ({ at: match.index, locator: { code: match[0], text: unescaped(match[2]!) } }));
  return [...byRole, ...byText].sort((a, b) => a.at - b.at).map(({ locator }) => locator);
}

/**
 * The texts an assertion names: those its locators look for, and those it expects.
 *
 * @param assertion - Text of an assertion.
 * @returns The texts, each as written.
 */
export function namedTexts(assertion: string): string[] {
  const located = usedLocators(assertion).flatMap((locator) => (locator.text === undefined ? [] : [locator.text]));
  return [...located, ...[...assertion.matchAll(EXPECTED)].map((match) => unescaped(match[2]!))];
}

/** A string literal without the escapes of its quotes. */
function unescaped(literal: string): string {
  return literal.replace(/\\(.)/g, "$1");
}
