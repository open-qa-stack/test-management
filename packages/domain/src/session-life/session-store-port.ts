import type { SessionCommands } from "./session-commands.ts";
import type { SessionQueries } from "./session-queries.ts";

/**
 * The port of the store of the sessions: what the process that hosts the sessions asks of what keeps the
 * project, the sessions, their events and the messages sent to them, whatever keeps them.
 */
export interface SessionStorePort extends SessionCommands, SessionQueries {}
