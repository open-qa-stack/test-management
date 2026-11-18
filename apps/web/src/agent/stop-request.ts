import { hrefTo, type Route } from "../routing/route.ts";

/** The parameter of the address of a session that opens the confirmation of its stop, and the value it takes. */
const STOP = "stop";
const ASKED = "ask";

/** The identifier of what the bar of a session holds about its stop: the link that asks for it, then the word that it was asked. */
export const STOP_CONTROL_ID = "session-stop";

/** The identifier of the link that leaves the confirmation of a stop without stopping, which takes the focus when the confirmation opens. */
export const STOP_CANCEL_ID = "session-stop-cancel";

/**
 * Tells whether an address opens the confirmation of the stop of its session.
 *
 * @param route - The route.
 * @returns Whether its `stop` asks for it.
 */
export function asksToStop(route: Route): boolean {
  return route.query[STOP] === ASKED;
}

/**
 * Writes the link that opens the confirmation of the stop of a session.
 *
 * @param route - The route of the session.
 * @returns The same address with its `stop`: the screen, with what else it keeps.
 */
export function withStop(route: Route): string {
  return hrefTo(`/${route.path.join("/")}`, { ...route.query, [STOP]: ASKED });
}

/**
 * Writes the link that closes the confirmation of the stop of a session.
 *
 * @param route - The route.
 * @returns The same address without its `stop`.
 */
export function withoutStop(route: Route): string {
  const { [STOP]: _closed, ...kept } = route.query;
  return hrefTo(`/${route.path.join("/")}`, kept);
}

/**
 * Tells where the focus goes when the confirmation of a stop opens or closes, so that the keyboard and a
 * screen reader follow it.
 *
 * @param before - Whether the address asked for the confirmation.
 * @param now - Whether it asks for it.
 * @returns The selector of what takes the focus: the link that leaves without stopping when the confirmation
 * opens — never the button that stops, which a key pressed twice would then press — what the bar holds about
 * the stop when it closes, and `undefined` when nothing changed.
 */
export function focusAfterStop(before: boolean, now: boolean): string | undefined {
  if (before === now) return undefined;
  return now ? `#${STOP_CANCEL_ID}` : `#${STOP_CONTROL_ID}`;
}
