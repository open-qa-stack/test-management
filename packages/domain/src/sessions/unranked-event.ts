import type { SessionEvent } from "./session-event.ts";

/** An event of one type without its rank. */
type Unranked<Event> = Event extends unknown ? Omit<Event, "id"> : never;

/** An event of a session that has no rank yet: whoever keeps the session gives it one when it is appended. */
export type UnrankedEvent = Unranked<SessionEvent>;
