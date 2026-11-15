/** The words of an identifier of an application or of a route, in lower case. */
function words(text: string): string[] {
  return text
    .split(/[^a-zA-Z0-9]+/)
    .filter((part) => part !== "")
    .map((part) => part.toLowerCase());
}

/** A word with its first letter in upper case. */
const capital = (word: string) => `${word[0]!.toUpperCase()}${word.slice(1)}`;

/**
 * A name a program may bear, from a text: its words in camel case, and never one that starts with a digit.
 *
 * @param text - The text, such as `customer-management`.
 * @param fallback - The word written before a name that would start with a digit, or for a text without a word.
 * @returns The name, such as `customerManagement`.
 */
export function camelName(text: string, fallback: string): string {
  const [first = fallback, ...rest] = words(text);
  const name = [first, ...rest.map(capital)].join("");
  return /^[0-9]/.test(name) ? `${fallback}${capital(name)}` : name;
}

/**
 * The name of the class of something, from a text: its words in Pascal case.
 *
 * @param text - The text, such as `customer-management`.
 * @param fallback - The word written before a name that would start with a digit, or for a text without a word.
 * @returns The name, such as `CustomerManagement`.
 */
export function className(text: string, fallback: string): string {
  return capital(camelName(text, fallback));
}

/**
 * The name of an application in a test: that of the fixture that gives its screens.
 *
 * @param application - Identifier of the application, such as `customer-management`.
 * @returns The name, such as `customerManagement`.
 */
export function applicationVariable(application: string): string {
  return camelName(application, "app");
}
