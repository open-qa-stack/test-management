import { createHash } from "node:crypto";

/**
 * The SHA-256 of a text.
 *
 * @param text - The text.
 * @returns Its digest, in hexadecimal.
 */
export function textDigest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
