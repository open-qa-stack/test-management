import type { Session } from "../sessions/session.ts";

/**
 * What asking to map the knowledge again gave:
 *
 * - `opened`: the card of the source named, or of every source, was dropped, and a session that maps it opened — it runs,
 *   or waits its turn; the source goes through `waiting` and `mapping` again.
 * - `busy`: a session that maps the knowledge waits or runs already: no second one opened, and nothing was dropped.
 * - `unknown`: the configuration in force declares no such source for the environment mapped.
 */
export type KnowledgeRemap =
  | { readonly state: "opened"; readonly session: Session }
  | { readonly state: "busy"; readonly session: Session }
  | { readonly state: "unknown"; readonly source: string };
