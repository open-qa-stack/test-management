/**
 * A command on a session that exists: whoever hosts the sessions starts it, appends its events, is delivered
 * the messages of the person and completes it; a person says something to it; whoever stops it interrupts
 * it; and a host that starts abandons one a process that died left running.
 */
export type SessionCommand = "start" | "append" | "say" | "deliver" | "complete" | "interrupt" | "abandon";
