import type { SourceCard } from "@open-qa-stack/shared";
import { fingerprintOf } from "@open-qa-stack/tools";

/**
 * The fingerprint of a card, which an index records for each source it was made from.
 *
 * @param card - The card, as written or read.
 * @returns `sha256:` and a digest of its JSON content, so that a card made again, or changed, has another.
 */
export function cardFingerprint(card: SourceCard): string {
  return fingerprintOf(JSON.stringify(card));
}
