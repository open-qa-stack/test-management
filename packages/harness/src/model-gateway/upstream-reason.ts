/** Longest reason kept from an error answer of the upstream server. */
export const MAX_REASON_LENGTH = 300;

/**
 * Reads why the upstream server refused a request, from the body of its error answer.
 *
 * @remarks
 * The reason is the `error.message` of an OpenAI-compatible error body, or `error` when it is a text. It is
 * kept on one line, cut to {@link MAX_REASON_LENGTH} characters, and never holds the key sent to the server.
 *
 * @param body - The body of the error answer.
 * @param apiKey - The key sent to the server, if any.
 * @returns The reason, or `undefined` when the body gives none.
 */
export function upstreamReason(body: string, apiKey: string | undefined): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  const error = (parsed as { error?: unknown } | null)?.error;
  const message = typeof error === "string" ? error : (error as { message?: unknown } | null | undefined)?.message;
  if (typeof message !== "string") return undefined;
  const masked = apiKey === undefined || apiKey === "" ? message : message.split(apiKey).join("[masked]");
  const line = masked.replace(/\s+/g, " ").trim();
  if (line === "") return undefined;
  return line.length > MAX_REASON_LENGTH ? `${line.slice(0, MAX_REASON_LENGTH)}…` : line;
}
