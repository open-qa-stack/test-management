/** A database of its own, created empty and removed after use. */
export interface TestDatabase {
  /** Its connection URL. */
  readonly url: string;
  /** Removes the database, closing whatever connection is still open to it. */
  drop(): Promise<void>;
}
