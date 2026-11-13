import { createHash } from "node:crypto";

/**
 * Computes the fingerprint of what a source holds, to tell whether it changed.
 *
 * @param content - A stable text of the source: its document, or its structure as JSON.
 * @returns `sha256:` followed by the hexadecimal digest.
 */
export function fingerprintOf(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
