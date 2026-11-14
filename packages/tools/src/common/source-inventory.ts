import type { SourceExport } from "./source-export.ts";

/**
 * What a knowledge source holds, read without the model: the elements a card or an index must place, the
 * structural facts known of each, and the fingerprint of the source.
 */
export interface SourceInventory {
  /** Names of the elements, in the order of the source. */
  readonly items: readonly string[];
  /** Facts of each element, by name; an element may have none. */
  readonly facts: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  /**
   * What the harness read of each element beyond its facts, by name, for the request of its card only: the
   * columns of a table, the start of a section.
   */
  readonly excerpts?: ReadonlyMap<string, string>;
  /** Fingerprint of the source as it was read. */
  readonly fingerprint: string;
  /** Whether the harness read only part of the source, which was too large; the elements are then partial. */
  readonly truncated?: boolean;
  /** The export the inventory was read from, for a source that has one: a database, a contract. */
  readonly export?: SourceExport;
}
