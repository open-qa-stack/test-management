import type { Session, SessionEvent, UnrankedEvent } from "@open-qa-stack/domain/sessions";
import { initialState, type ConversationContext, type ConversationState } from "../../src/conversation/state/conversation-state.ts";
import { conversationReducer, type ConversationAction } from "../../src/conversation/state/conversation-reducer.ts";

/** An event without its rank nor its date, which the tests give in order. */
export type EventBody = UnrankedEvent extends infer Event ? (Event extends unknown ? Omit<Event, "at"> : never) : never;

/** The time of the clock the fixtures start at, in milliseconds: when their session was opened. */
export const NOW = Date.parse("2026-11-13T14:44:05.000Z");

/** A session whose agents are working. */
export const RUNNING: Session = {
  id: "session-2026-11-13T14-44-05-000Z-0a1b2c3d",
  request: "Test the search of a customer.",
  environment: "local",
  openedAt: "2026-11-13T14:44:05.000Z",
  lastEventAt: "2026-11-13T14:44:06.000Z",
  state: "running",
};

/** The same session, once every test passed. */
export const COMPLETED: Session = {
  ...RUNNING,
  state: "completed",
  result: {
    outcome: "passed",
    durationMs: 72_300,
    modelRequests: 17,
    branch: "oqas/design-20261113T144405Z",
    tests: [
      { id: "shop › tests/search.spec.ts:3 › searches a customer", verdict: "passed", reason: "It passed." },
      { id: "shop › tests/open.spec.ts:3 › opens a customer", verdict: "passed", reason: "It passed." },
    ],
  },
};

/** An earlier session, which failed. */
export const FAILED: Session = {
  id: "session-2026-11-12T09-00-00-000Z-9f8e7d6c",
  request: "Test the returns\n  of an order.",
  openedAt: "2026-11-12T09:00:00.000Z",
  lastEventAt: "2026-11-12T09:10:00.000Z",
  state: "completed",
  result: { outcome: "failed", durationMs: 600_000, modelRequests: 1, tests: [{ id: "returns an order", verdict: "failed", reason: "The total is wrong." }] },
};

/** Where the conversations of the tests take place. */
export const CONTEXT: ConversationContext = { project: "shop-tests", repository: "/work/shop-tests", environment: "local", database: "SQLite" };

/**
 * Ranks events and dates them a second apart.
 *
 * @param bodies - The events, in order.
 * @param from - The rank of the first; 1 by default.
 * @returns The events, the first at 14:44:06 for the rank 1.
 */
export function numbered(bodies: readonly EventBody[], from = 1): SessionEvent[] {
  return bodies.map((body, index) => ({ ...body, id: from + index, at: `2026-11-13T14:44:${String(5 + from + index).padStart(2, "0")}.000Z` }) as SessionEvent);
}

/** A thread that shows every kind of block: a request, phases, a brief, an agent that thinks, acts and speaks, notes, a plan, a refusal and a message. */
export const THREAD: readonly EventBody[] = [
  { type: "user_message", text: "Test the search of a customer." },
  { type: "state_changed", state: "running" },
  { type: "phase_started", phase: "configuration" },
  { type: "note", phase: "configuration", text: "The configuration is valid; the run targets the environment local." },
  { type: "phase_started", phase: "plan" },
  { type: "harness_message", to: "planner", text: "Plan Playwright tests for the environment local.", level: "smoke" },
  { type: "agent_message", agent: "planner", text: "I should open the application first.", reasoning: true },
  { type: "action_started", action: "a1", agent: "planner", tool: "shop_goto", arguments: { url: "/customers" } },
  { type: "action_finished", action: "a1", outcome: "done", result: "Opened.", durationMs: 900 },
  { type: "action_started", action: "a2", agent: "planner", tool: "propose_plan", arguments: { scenarios: [{}] } },
  { type: "action_finished", action: "a2", outcome: "failed", result: "The plan names no element of the page.", durationMs: 40 },
  { type: "refusal", phase: "plan", code: "PLAN-ELEMENT", text: "The plan was refused: name the element each step acts on, then propose it again." },
  { type: "action_started", action: "a3", agent: "planner", tool: "propose_plan", arguments: { scenarios: [{}, {}] } },
  { type: "action_finished", action: "a3", outcome: "passed", result: "The plan was accepted.", durationMs: 35 },
  { type: "agent_message", agent: "planner", text: "The plan holds two scenarios.", reasoning: false },
  {
    type: "plan_accepted",
    scenarios: [
      { id: "search", title: "Search a customer by name", level: "smoke", case: "nominal", application: "shop" },
      { id: "open", title: "Open the profile of a customer", level: "smoke" },
    ],
  },
  { type: "user_message", text: "Leave the archived customers out.", number: 1 },
  { type: "phase_started", phase: "write", scenario: "search" },
  { type: "action_started", action: "a4", agent: "writer", tool: "run_test", arguments: {} },
];

/**
 * The event a session that completed tells its end with.
 *
 * @param session - The session, completed with its result.
 * @returns The change of state, with the result.
 */
export function completion(session: Session): EventBody {
  return { type: "state_changed", state: "completed", result: session.result! };
}

/**
 * What the end of the session of the thread is told by, after the events of the thread: the event that tells it,
 * for one that completed, then the session as it came to.
 *
 * @param session - The session, as it ended.
 * @returns The actions.
 */
export function endOf(session: Session): ConversationAction[] {
  const told: ConversationAction[] =
    session.state === "completed" ? [{ type: "told", session: session.id, events: numbered([completion(session)], THREAD.length + 1) }] : [];
  return [...told, { type: "ended", session }];
}

/**
 * Plays actions on a conversation.
 *
 * @param actions - What happens, in order.
 * @param state - The conversation they happen to; one that just started, with two sessions to recall, by default.
 * @returns The conversation after them.
 */
export function after(actions: readonly ConversationAction[], state: ConversationState = initialState([RUNNING, FAILED], NOW)): ConversationState {
  return actions.reduce((conversation, action) => conversationReducer(conversation, action), state);
}

/**
 * A conversation whose screen shows the thread of a session.
 *
 * @param bodies - The events the session told so far.
 * @param hosted - Whether this process opened the session.
 * @returns The conversation.
 */
export function showing(bodies: readonly EventBody[] = THREAD, hosted = true): ConversationState {
  return after([
    { type: "opened", session: { ...RUNNING, state: "queued" }, hosted },
    { type: "told", session: RUNNING.id, events: numbered(bodies) },
  ]);
}
