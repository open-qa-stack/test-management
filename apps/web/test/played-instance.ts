import type {
  AgentRole,
  Language,
  Problem,
  ProblemCode,
  Session,
  SessionEvent,
  SessionList,
  SessionMessage,
  SessionOpening,
} from "@open-qa-stack/domain/sessions";
import { COMPLETED, EVENTS, RUNNING, SESSION_ID, type EventBody } from "./agent/session-fixture.ts";
import { VIEW } from "./configuration/configuration-fixture.ts";
import { UNREACHABLE, type Api, type ApiAnswer } from "./built-console.ts";

/** The identifier of the session the played instance opens on request. */
export const OPENED_ID = "oqas-2026-11-16T09-00-00-000Z";

/**
 * A problem, as the API answers one.
 *
 * @param code - Its code.
 * @param status - Its status.
 * @param detail - What it says went wrong.
 * @returns The answer.
 */
function problem(code: ProblemCode, status: number, detail: string): ApiAnswer {
  const body: Problem = { type: `/problems/${code}`, title: "A problem", status, detail, code };
  return { status, contentType: "application/problem+json", body: JSON.stringify(body) };
}

/**
 * The API of an instance that holds one session, which a test may change as it goes, and opens another on
 * request: that one waits, queued, until the test starts it.
 */
export class PlayedInstance {
  /** The session, as the API tells it now. */
  public session: Session = RUNNING;
  /** The language of its configuration: French, the language the tests of the console were written in. */
  public language: Language = "fr";
  /** How many events of the fixtures the session has so far. */
  public happened = EVENTS.length;
  /** Whether the instance cannot be reached. */
  public down = false;
  /** Whether the list of the project has the session. */
  public listed = true;
  /** Whether the API fails to list the sessions. */
  public unlisted = false;
  /** Whether the API fails to open the stream of a session. */
  public streamDown = false;
  /** Why the API refuses to open a session, when it does. */
  public refusal: ProblemCode | undefined;
  /** Whether the API refuses a message or an interruption, as it does to a session that just ended. */
  public deaf = false;
  /** What the API waits for before it answers a request to open a session, a message, or an interruption. */
  public hold: Promise<void> = Promise.resolve();
  /** The requests to open a session the API received. */
  public readonly asked: SessionOpening[] = [];
  /** The messages the API took for the session, in order. */
  public readonly said: SessionMessage[] = [];
  /** The sessions the API was asked to interrupt, in order. */
  public readonly interrupted: string[] = [];
  /** What the session was resumed with once it ended, in order. */
  public readonly resumedWith: SessionMessage[] = [];
  /** The event each stream of the session was asked to resume after; none for a stream asked from its start. */
  public readonly resumed: (string | undefined)[] = [];
  /** The session the API opened on request, once it did. */
  private opened: Session | undefined;
  /** What happened in the session the API opened, from what the person asked. */
  private readonly openedEvents: SessionEvent[] = [];
  /** What happened in the session after the events of the fixtures: the messages the person sent, and their deliveries. */
  private readonly since: SessionEvent[] = [];

  /** Completes the session: its last event says so, and the API tells what it came to. */
  public complete(): void {
    this.happened = EVENTS.length;
    this.session = COMPLETED;
  }

  /** Has the process that runs the session obey an interruption: the session is interrupted, and its last event says so. */
  public obey(): void {
    this.session = { ...RUNNING, state: "interrupted" };
  }

  /** Starts the session the API opened: it runs, its stream tells so, and its planner speaks. */
  public take(): void {
    this.opened = { ...this.opened!, state: "running" };
    this.tell({ type: "state_changed", state: "running" }, { type: "agent_message", agent: "planner", text: "I read what was asked.", reasoning: false });
  }

  /** Completes the session the API opened: its last event says so, and the API tells what it came to. */
  public completeOpened(): void {
    this.opened = { ...this.opened!, state: "completed", result: COMPLETED.result! };
    this.tell({ type: "state_changed", state: "completed", result: COMPLETED.result! });
  }

  /**
   * Delivers a message the API took to an agent: the stream of the session tells it.
   *
   * @param message - The number of the message.
   * @param agent - The agent that receives it.
   */
  public deliver(message: number, agent: AgentRole): void {
    this.since.push({ ...this.next(), type: "message_delivered", message, agent });
  }

  /** What the API does with a request. */
  public readonly api: Api = async ({ path, method, after, body }) => {
    if (this.down) return UNREACHABLE;
    if (path === "/api/configuration")
      return { body: JSON.stringify({ ...VIEW, revision: { ...VIEW.revision!, document: { ...VIEW.revision!.document, language: this.language } } }) };
    if (path === "/api/project")
      return { body: JSON.stringify({ name: "lakeside", applications: [{ id: "customer-management", name: "Customer Management" }] }) };
    if (path === "/api/sessions" && method === "POST") {
      await this.hold;
      if (this.refusal !== undefined) return problem(this.refusal, 503, "The API refuses in its own words.");
      const asked = JSON.parse(body!) as SessionOpening;
      this.asked.push(asked);
      this.opened = { id: OPENED_ID, request: asked.request, openedAt: "2026-11-16T09:00:00.000Z", lastEventAt: "2026-11-16T09:00:00.000Z", state: "queued" };
      this.tell({ type: "user_message", text: asked.request });
      return { status: 201, body: JSON.stringify(this.opened) };
    }
    if (path === "/api/sessions") {
      if (this.unlisted) return problem("error", 500, "The folder of the sessions cannot be read.");
      const items = [...(this.opened === undefined ? [] : [this.opened]), ...(this.listed ? [this.session] : [])];
      return { body: JSON.stringify({ items } satisfies SessionList) };
    }
    const [, id, part] = /^\/api\/sessions\/([^/]+)(\/events|\/messages|\/resumption|\/interruption)?$/.exec(path) ?? [];
    const session = id === SESSION_ID ? this.session : id === OPENED_ID ? this.opened : undefined;
    if (session === undefined) return problem("unknown_session", 404, "No session has this identifier.");
    if (part === undefined) return { body: JSON.stringify(session) };
    if (part === "/messages") {
      await this.hold;
      if (this.deaf) return problem("session_ended", 409, "The session no longer goes on.");
      const message = JSON.parse(body!) as SessionMessage;
      this.said.push(message);
      const sent: EventBody = { type: "user_message", text: message.text, number: this.said.length };
      if (id === SESSION_ID) this.since.push({ ...this.next(), ...sent });
      else this.tell(sent);
      return { status: 202, body: JSON.stringify({ number: this.said.length }) };
    }
    if (part === "/resumption") {
      await this.hold;
      const message = JSON.parse(body!) as SessionMessage;
      this.resumedWith.push(message);
      // The end the session is resumed from stays in its thread, and the new turn starts under it: it runs at once.
      this.since.push(this.completion(session));
      this.since.push({ ...this.next(), type: "user_message", text: message.text });
      this.since.push({ ...this.next(), type: "state_changed", state: "queued" });
      this.since.push({ ...this.next(), type: "state_changed", state: "running" });
      const { result: _turn, ...going } = session;
      this.session = { ...going, state: "running" };
      return { status: 202, body: JSON.stringify(this.session) };
    }
    if (part === "/interruption") {
      await this.hold;
      if (this.deaf) return problem("session_ended", 409, "The session no longer goes on.");
      this.interrupted.push(id!);
      // The request is taken, and the session goes on until the process that runs it obeys.
      return { status: 202, body: "" };
    }
    if (this.streamDown) return problem("unavailable", 503, "The stream cannot be opened.");
    if (id === SESSION_ID) this.resumed.push(after);
    // The answer ends after what the session has so far: the console connects again, and asks for what happened since.
    const played = [...EVENTS.slice(0, this.happened), ...this.since, ...(session.state === "running" ? [] : [this.completion(session)])];
    const events = id === SESSION_ID ? played : this.openedEvents;
    const fresh = events.filter((event) => event.id > Number(after ?? 0));
    return { contentType: "text/event-stream", body: `: events\n\n${fresh.map((event) => `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`).join("")}` };
  };

  /** Adds events to the session the API opened, at the ranks and the seconds that follow its last. */
  private tell(...bodies: readonly EventBody[]): void {
    for (const body of bodies) {
      const id = this.openedEvents.length + 1;
      this.openedEvents.push({ ...body, id, at: `2026-11-16T09:00:${String(id).padStart(2, "0")}.000Z` } as SessionEvent);
    }
  }

  /** The event that tells the end of a session, with its result when it completed, after all the session has. */
  private completion(session: Session): SessionEvent {
    return session.state === "interrupted"
      ? { ...this.next(), type: "state_changed", state: "interrupted" }
      : { ...this.next(), type: "state_changed", state: "completed", ...(session.result === undefined ? {} : { result: session.result }) };
  }

  /** The rank and the date of the next event of the session, after all it has. */
  private next(): Pick<SessionEvent, "id" | "at"> {
    return { id: EVENTS.length + this.since.length + 1, at: `2026-11-15T14:45:${String(this.since.length).padStart(2, "0")}.000Z` };
  }
}
