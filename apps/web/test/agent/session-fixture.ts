import type { Session, SessionEvent } from "@open-qa-stack/domain/sessions";
import type { LiveSession, SessionControls } from "../../src/agent/live-session.ts";
import { frameOf, INITIAL_PLAYBACK, type Playback } from "../../src/agent/playback.ts";
import type { SessionScript } from "../../src/agent/session-script.ts";
import { scriptOf } from "../../src/agent/session-steps.ts";

/** Controls that do nothing: a rendering in a test listens to none of them. */
export const NO_CONTROLS: SessionControls = {
  toggle: () => {},
  restart: () => {},
  faster: () => {},
  skip: () => {},
  follow: () => {},
  say: () => {},
  stop: () => {},
  sayOnEnter: () => {},
};

/** The identifier of the session of the fixtures. */
export const SESSION_ID = "oqas-2026-11-15T14-44-06-348Z";

/** A session whose agents are working. */
export const RUNNING: Session = {
  id: SESSION_ID,
  request: "tester la recherche d'un client",
  openedAt: "2026-11-15T14:44:06.348Z",
  lastEventAt: "2026-11-15T14:44:30.000Z",
  state: "running",
};

/** The same session before it started. */
export const QUEUED: Session = { ...RUNNING, lastEventAt: RUNNING.openedAt, state: "queued" };

/** The same session once completed, every test passed. */
export const COMPLETED: Session = {
  ...RUNNING,
  state: "completed",
  environment: "local",
  result: {
    outcome: "passed",
    durationMs: 113_600,
    modelRequests: 50,
    branch: "oqas/design-20261115T144408Z",
    tests: [{ id: "customer-management › search-customer.spec.ts:3 › Rechercher un client par son nom", verdict: "passed", reason: "Every attempt passed." }],
  },
};

/** What an event of a fixture is written with: everything but its rank and its date. */
export type EventBody = SessionEvent extends infer E ? (E extends SessionEvent ? Omit<E, "id" | "at"> : never) : never;

/**
 * Numbers the events of a session and dates them, one second apart from 14:44:06.
 *
 * @param bodies - The events, in order, without rank nor date.
 * @returns The events, numbered from 1.
 */
export function numbered(bodies: readonly EventBody[]): SessionEvent[] {
  return bodies.map((body, index) => ({ ...body, id: index + 1, at: `2026-11-15T14:44:${String(6 + index).padStart(2, "0")}.000Z` }) as SessionEvent);
}

/**
 * A short session: a configuration, a plan asked at the level smoke, a reasoning, a browser action with its
 * page, a plan accepted, a refusal with its code, then the writing of a test whose run has not answered.
 */
export const EVENTS: readonly SessionEvent[] = numbered([
  { type: "phase_started", phase: "configuration" },
  { type: "note", phase: "configuration", text: "The configuration is valid; the run targets the environment local." },
  { type: "phase_started", phase: "plan" },
  { type: "user_message", text: "tester la recherche d'un client" },
  { type: "harness_message", to: "planner", text: "This plan is of the level smoke alone.", level: "smoke" },
  { type: "agent_message", agent: "planner", text: "I should open the application first.", reasoning: true },
  { type: "action_started", action: "c1", agent: "planner", tool: "customer_management_goto", arguments: { url: "/" } },
  {
    type: "action_finished",
    action: "c1",
    outcome: "done",
    result: '{"url":"http://localhost:3020/"}',
    durationMs: 900,
    look: { kind: "page", name: "http://localhost:3020/", lines: ['- heading "Customers"', '- textbox "Search..."'] },
  },
  { type: "action_started", action: "c2", agent: "planner", tool: "propose_plan", arguments: { scenarios: [{ id: "search" }] } },
  { type: "action_finished", action: "c2", outcome: "passed", result: "The plan was accepted: search.", durationMs: 40 },
  { type: "plan_accepted", scenarios: [{ id: "search", title: "Search a customer", level: "smoke", application: "customer-management", case: "nominal" }] },
  { type: "refusal", phase: "plan", code: "PLAN-ELEMENT", text: "The plan was refused by the harness: name an element." },
  { type: "phase_started", phase: "write", scenario: "search" },
  { type: "agent_message", agent: "writer", text: "I write the test now.", reasoning: false },
  { type: "action_started", action: "c3", agent: "writer", tool: "run_test", arguments: { file: "search-customer.spec.ts" } },
]);

/**
 * The steps of the session of the fixtures.
 *
 * @param session - The session; the one whose agents are working by default.
 * @param events - Its events; those of the fixtures by default.
 * @returns Its script.
 */
export function fixtureScript(session: Session = RUNNING, events: readonly SessionEvent[] = EVENTS): SessionScript {
  return scriptOf(session, events);
}

/**
 * The session of the fixtures as the console shows it.
 *
 * @param session - The session; the one whose agents are working by default.
 * @param changes - What differs from the playback of a session just opened.
 * @param events - Its events; those of the fixtures by default.
 * @returns The session, its stream open, no message on its way, with controls that do nothing.
 */
export function liveOf(session: Session = RUNNING, changes: Partial<Playback> = {}, events: readonly SessionEvent[] = EVENTS): LiveSession {
  const script = scriptOf(session, events);
  const playback = { ...INITIAL_PLAYBACK, ...changes };
  return {
    session,
    stream: "open",
    script,
    playback,
    frame: frameOf(script, playback),
    saying: { state: "idle" },
    stopping: { state: "idle" },
    controls: NO_CONTROLS,
  };
}
