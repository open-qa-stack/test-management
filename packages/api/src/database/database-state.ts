/** What a check of the database found: it answers with every migration applied, it cannot be reached, or migrations are pending. */
export type DatabaseState =
  | { readonly check: "up" }
  | { readonly check: "unreachable" }
  | { readonly check: "migrations_pending"; readonly pending: number };
