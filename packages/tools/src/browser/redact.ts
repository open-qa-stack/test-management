/** What replaces a secret in what a tool returns. */
export const SECRET_MASK = "[secret]";

/**
 * Lists the forms in which a secret may show in what a tool returns.
 *
 * @remarks
 * A password typed in a field may come back as it is, escaped in the quoted value of an accessibility
 * snapshot, with its spaces collapsed, or encoded in an address by a form or a script.
 *
 * @param secret - The secret.
 * @returns Its forms, each once.
 */
export function secretForms(secret: string): string[] {
  const forms = [
    secret,
    JSON.stringify(secret).slice(1, -1),
    secret.replace(/\s+/g, " "),
    encodeURIComponent(secret),
    new URLSearchParams({ v: secret }).toString().slice(2),
  ];
  return [...new Set(forms)];
}

/**
 * Replaces every occurrence of a secret in the strings of a value, however deep.
 *
 * @param value - What a tool is about to return.
 * @param secrets - Values that must never reach the model, in every form `secretForms` gives.
 * @returns The value, with each secret replaced by `SECRET_MASK`.
 */
export function redact(value: unknown, secrets: readonly string[]): unknown {
  if (secrets.length === 0) return value;
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, secrets)]));
  }
  return value;
}

/**
 * Replaces every occurrence of a secret in a text.
 *
 * @param text - A text a tool is about to return.
 * @param secrets - Values that must never reach the model.
 * @returns The text, with each secret replaced by `SECRET_MASK`, the longest first.
 */
export function redactText(text: string, secrets: readonly string[]): string {
  return [...secrets].sort((a, b) => b.length - a.length).reduce((masked, secret) => masked.replaceAll(secret, SECRET_MASK), text);
}
