import { useInput, useWindowSize } from "ink";
import { createElement as h, useEffect, useReducer, type ReactNode } from "react";
import { hasEnded, type Session, type SessionEvent } from "@open-qa-stack/domain/sessions";
import type { Sessions } from "@open-qa-stack/engine";
import { conversationReducer } from "./conversation-reducer.ts";
import { initialState, type ConversationContext } from "./conversation-state.ts";
import { ConversationView } from "./conversation-view.ts";
import { interruptionOf } from "./interruption.ts";
import { requestOf, type Request } from "./request.ts";
import type { Theme } from "./palette.ts";

/** How often the clock of the conversation moves, in milliseconds: what goes on is timed to the second. */
const TICK_MS = 1000;

/** The operations on sessions the conversation calls. */
export type ConversationSessions = Pick<Sessions, "open" | "say" | "interrupt" | "sessions" | "session" | "events">;

/** How the person left the conversation. */
export interface Leaving {
  /** Whether they left at once, without waiting for the sessions this process runs. */
  readonly atOnce: boolean;
  /** The sessions this process opened, the latest last. */
  readonly hosted: readonly string[];
}

/** What the conversation needs. */
export interface ConversationProps {
  /** The operations on the sessions of the test repository. */
  readonly sessions: ConversationSessions;
  readonly context: ConversationContext;
  /** The sessions of the instance when the conversation starts, the latest first. */
  readonly latest: readonly Session[];
  readonly theme: Theme;
  /** The clock, in milliseconds. */
  readonly now: () => number;
  /**
   * Serves the web console from this process.
   *
   * @param port - The port to listen on, 0 for any free one.
   * @returns Its address. Asked again, it answers the address it already serves.
   */
  readonly serve: (port: number) => Promise<string>;
  /** Says why something failed, in the words the other commands use; never a stack trace. */
  readonly reasonOf: (error: unknown) => string;
  /** Called once, when the person leaves, with how they did. */
  readonly onLeave: (leaving: Leaving) => void;
}

/**
 * The conversation: the one stateful component, which wires the operations on sessions to the state of the screen.
 *
 * @remarks
 * Everything the screen shows is in the state the reducer gives, and everything a key asks is read from that
 * state by `requestOf` and `interruptionOf`. This component does the rest, and nothing else: it follows the
 * events of the session on screen — subscribed when a thread comes on screen, left when another does or when
 * the conversation ends —, calls the operation a key asked for, and tells the reducer what came back. The
 * events a session tells in one go are given to the reducer together, so that a long thread reopened is read
 * once and not once per event.
 *
 * It ends by telling how the person left, a {@link Leaving}, to whoever opened it, which then closes the screen.
 *
 * @param props - The operations, where the conversation takes place, what draws and times it, and who hears it end.
 * @returns The screen.
 */
export function Conversation({ sessions, context, latest, theme, now, serve, reasonOf, onLeave }: ConversationProps): ReactNode {
  const [state, dispatch] = useReducer(conversationReducer, undefined, () => initialState(latest, now()));
  const { columns } = useWindowSize();
  const fail = (error: unknown): void => dispatch({ type: "failed", why: reasonOf(error) });

  const followed = state.shown?.session.id;
  useEffect(() => {
    if (followed === undefined) return undefined;
    let left = false;
    let leave = (): void => undefined;
    let told: SessionEvent[] = [];
    const flush = (): void => {
      if (told.length === 0) return;
      dispatch({ type: "told", session: followed, events: told });
      told = [];
    };
    const listener = {
      event: (event: SessionEvent): void => {
        if (told.length === 0) queueMicrotask(flush);
        told.push(event);
      },
      ended: (): void => {
        flush();
        void sessions.session(followed).then((session) => dispatch({ type: "ended", session }), fail);
      },
      failed: fail,
    };
    void sessions.events(followed, 0).then((events) => {
      if (!left) leave = events.subscribe(listener);
    }, fail);
    return () => {
      left = true;
      leave();
    };
  }, [followed]);

  const timed = state.shown !== undefined && !hasEnded(state.shown.session.state);
  useEffect(() => {
    if (!timed) return undefined;
    const clock = setInterval(() => dispatch({ type: "ticked", now: now() }), TICK_MS);
    return () => clearInterval(clock);
  }, [timed]);

  const { leaving } = state;
  useEffect(() => {
    if (leaving !== undefined) onLeave({ atOnce: leaving.atOnce, hosted: state.hosted });
  }, [leaving]);

  const perform = (request: Request): void => {
    switch (request.kind) {
      case "open":
        return void sessions
          .open({ request: request.request, ...(context.environment === undefined ? {} : { environment: context.environment }) })
          .then((session) => dispatch({ type: "opened", session, hosted: true }), fail);
      case "say":
        return void sessions.say(request.session, { text: request.text }).catch(fail);
      case "confirm-stop":
        return void sessions.interrupt(request.session).catch(fail);
      case "pick":
        return dispatch({ type: "opened", session: request.session, hosted: false });
      case "sessions":
        return void sessions.sessions().then((listed) => dispatch({ type: "listed", sessions: listed }), fail);
      case "new":
        return void sessions.sessions().then((listed) => dispatch({ type: "restarted", sessions: listed }), fail);
      case "ui":
        return void serve(request.port).then((url) => dispatch({ type: "served", url }), fail);
      default:
        return undefined;
    }
  };

  const submit = (): void => {
    const request = requestOf(state);
    dispatch({ type: "submitted", request });
    perform(request);
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      const interruption = interruptionOf(state);
      if (interruption.kind === "stop") void sessions.interrupt(interruption.session).catch(fail);
      dispatch({ type: "interrupted" });
    } else if (key.escape) dispatch({ type: "dismissed" });
    else if (key.tab) dispatch({ type: "completed" });
    else if (key.upArrow || key.downArrow) dispatch({ type: "moved", by: key.upArrow ? -1 : 1 });
    // The input hears Enter by itself; what stands over it has no input to hear it.
    else if (key.return && state.overlay !== undefined) submit();
  });

  return h(ConversationView, { state, context, theme, width: columns, onChange: (input) => dispatch({ type: "typed", input }), onSubmit: submit });
}
