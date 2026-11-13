/**
 * What a knowledge source holds, read without the model: the elements a card or an index must place, the
 * structural facts known of each, and the fingerprint of the source.
 */
export interface SourceInventory {
  /** Names of the elements, in the order of the source. */
  readonly items: readonly string[];
  /** Facts of each element, by name; an element may have none. */
  readonly facts: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  /** Fingerprint of the source as it was read. */
  readonly fingerprint: string;
}
