/** A JSONB column of the schema that is never filtered on, and so carries no GIN index. */
export interface JsonbException {
  /** `schema.table`. */
  readonly table: string;
  readonly column: string;
  /** Why the column is never filtered on, reviewed with the change that adds it. */
  readonly reason: string;
}

/** The JSONB columns allowed without a GIN index. */
export const JSONB_WITHOUT_GIN: readonly JsonbException[] = [];
