/**
 * A text that cannot end the tag it is put between: what a person or a page wrote goes to the agent between
 * tags, and must not be able to close them to pass what follows for words of the harness.
 *
 * @param text - The text as it was written.
 * @param tag - Name of the tag the text is put between.
 * @returns The text, the `<` of each closing of that tag written `&lt;`, whatever its case.
 */
export function withoutClosing(text: string, tag: string): string {
  return text.replace(new RegExp(`<(?=/\\s*${tag})`, "gi"), "&lt;");
}
