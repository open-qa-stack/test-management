/**
 * A command on a session that exists: whoever hosts the sessions starts it, appends its events, is delivered
 * the messages of the person and completes it; a person says something to it, and resumes it once it ended;
 * whoever stops it interrupts it. A host tells it is alive by a beat on the sessions it hosts; one that stays
 * takes over those that wait for a host that went silent, and any host abandons one a silent host left running.
 */
export type SessionCommand = "start" | "append" | "say" | "resume" | "deliver" | "complete" | "interrupt" | "beat" | "takeOver" | "abandon";

/** A command that names its session: every one but those of a host on whatever sessions they are for. */
export type AddressedCommand = Exclude<SessionCommand, "beat" | "takeOver" | "abandon">;
