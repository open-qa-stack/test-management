import type { AgentRole, Application, SessionEvent, SessionResult, SessionState } from "@open-qa-stack/domain/sessions";
import type { StoredBoolean, StoredInstant, StoredJson } from "./stored-values.ts";

/**
 * The project of the instance: one row at most, which the check on its key holds it to.
 *
 * @remarks
 * The applications are served whole and never filtered on: they are kept as JSON.
 */
export interface ProjectTable {
  only: StoredBoolean;
  name: string | null;
  applications: StoredJson<readonly Application[]>;
}

/**
 * The sessions of the instance.
 *
 * @remarks
 * The state is a text: states are added over time, and a client reads one it does not know. The result is
 * served whole and never filtered on: it is kept as JSON.
 */
export interface SessionsTable {
  id: string;
  request: string | null;
  environment: string | null;
  opened_at: StoredInstant;
  last_event_at: StoredInstant;
  state: SessionState;
  result: StoredJson<SessionResult> | null;
}

/**
 * The events of the sessions, each under its rank in its session: from 1, given once, never changed.
 *
 * @remarks
 * The payload is what the event carries besides its rank, its date and its type. It is served whole, in the
 * order its fields were written, and never filtered on.
 */
export interface SessionEventsTable {
  session_id: string;
  id: number;
  at: StoredInstant;
  type: SessionEvent["type"];
  payload: StoredJson<Readonly<Record<string, unknown>>>;
}

/**
 * The messages a person sent to a session that was going on, each under its number in its session: from 1,
 * given once, never changed.
 *
 * @remarks
 * A message waits until the work of its session hands it to an agent, which is then named with the date: a
 * message whose agent is empty is still to be delivered.
 */
export interface SessionMessagesTable {
  session_id: string;
  number: number;
  at: StoredInstant;
  text: string;
  delivered_to: AgentRole | null;
  delivered_at: StoredInstant | null;
}

/**
 * The schema of the database of an instance, on every database the store supports: the tables the migrations
 * create, and what the statements of the store are checked against.
 */
export interface StoreSchema {
  project: ProjectTable;
  sessions: SessionsTable;
  session_events: SessionEventsTable;
  session_messages: SessionMessagesTable;
}
