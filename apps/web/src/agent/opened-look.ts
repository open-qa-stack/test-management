import { hrefTo, type Route } from "../routing/route.ts";
import type { SessionScript } from "@open-qa-stack/domain/sessions";
import { lookOf, type Look } from "./look.ts";

/** The identifier of the title of the panel of a look, which names the panel and takes the focus when it opens. */
export const LOOK_TITLE_ID = "look-panel-title";

/** What the address of a session opens beside its thread: what an agent had before its eyes when it acted. */
export interface OpenedLook {
  /** The rank, in the script, of the action the look belongs to. */
  readonly index: number;
  /** What that action did, in a sentence. */
  readonly action: string;
  readonly look: Look;
}

/**
 * The look the address of a session opens.
 *
 * @param route - The route, whose `look` names an action by its rank in the script.
 * @param script - The session.
 * @returns The look of that action; `undefined` when the address names none, or a step that looked at nothing.
 * It is read from the script, not from what a replay has shown so far: a look a person opened stays open
 * while they replay the session.
 */
export function openedLookOf(route: Route, script: SessionScript): OpenedLook | undefined {
  const asked = route.query["look"];
  const index = script.steps.findIndex((_, rank) => String(rank) === asked);
  const step = script.steps[index];
  return step?.kind === "tool" && step.look !== undefined ? { index, action: step.title, look: lookOf(step.look, step.tool) } : undefined;
}

/**
 * The identifier of the link that opens the look of an action, which takes the focus back when the look closes.
 *
 * @param index - The rank of the action in the script.
 * @returns The identifier.
 */
export function eyeIdOf(index: number): string {
  return `look-eye-${index}`;
}

/**
 * Writes the link that closes the look an address opens.
 *
 * @param route - The route.
 * @returns The same address without its `look`: the screen, with what else it keeps.
 */
export function withoutLook(route: Route): string {
  const { look: _closed, ...kept } = route.query;
  return hrefTo(`/${route.path.join("/")}`, kept);
}

/**
 * Tells where the focus goes when the look a session shows changes, so that the keyboard and a screen reader
 * follow the panel as it opens, and come back to where they were as it closes.
 *
 * @param before - The rank of the action whose look was open, if any.
 * @param now - The rank of the action whose look is open, if any.
 * @returns The selector of what takes the focus: the title of the panel when a look is open, the link that
 * opened the look that closed, and `undefined` when nothing was open and nothing is.
 */
export function focusAfterLook(before: number | undefined, now: number | undefined): string | undefined {
  if (now !== undefined) return `#${LOOK_TITLE_ID}`;
  return before === undefined ? undefined : `#${eyeIdOf(before)}`;
}
