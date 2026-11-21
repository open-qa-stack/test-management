import { useInput, useWindowSize } from "ink";
import { createElement as h, useEffect, useReducer, type ReactNode } from "react";
import { hasEnded, type Session, type SessionEvent } from "@open-qa-stack/domain/sessions";
import type { Sessions } from "@open-qa-stack/engine";
import type { Model, ModelConnectionCheck } from "@open-qa-stack/domain/sessions";
import { checkText, type SetupEnd } from "./model-setup/model-setup.ts";
import { t } from "./i18n/i18n.ts";
import { conversationReducer } from "./conversation-reducer.ts";
import { initialState, type ConversationContext } from "./conversation-state.ts";
import { ConversationView } from "./conversation-view.ts";
import { interruptionOf } from "./interruption.ts";
import { requestOf, type Request } from "./request.ts";
import type { Theme } from "./palette.ts";

/** How often the clock of the conversation moves, in milliseconds: what goes on is timed to the second. */
const TICK_MS = 1000;

/** The operations on sessions the conversation calls. */
export type ConversationSessions = Pick<Sessions, "open" | "say" | "resume" | "interrupt" | "sessions" | "session" | "events">;

/** How the person left the conversation. */
/** The connection to the model, as the conversation reads, tests and sets it. */
export interface ConversationModel {
  /** The connection in force. */
  readonly inForce: () => Promise<Model>;
  /** Tests a connection. */
  readonly check: (model: Model) => Promise<ModelConnectionCheck>;
  /** Records a connection. */
  readonly save: (model: Model) => Promise<void>;
}

/**
 * Why a connection to the model does not serve, in the words of the person: the reason the test gives, or that the
 * model is not among those offered.
 *
 * @param model - The connection tested.
 * @param check - What the test found.
 * @returns The reason, or `undefined` when the model answers and is offered, or the server lists none.
 */
export function silenceOf(model: Model, check: ModelConnectionCheck): string | undefined {
  if (check.state !== "connected") return checkText(check);
  return check.models === undefined || check.models.some(({ id }) => id === model.model) ? undefined : t("model.notOffered", { model: model.model });
}

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
  /** The connection to the model: tested when the conversation opens, set with /model. */
  readonly model: ConversationModel;
}

/**
 * The conversation: the one stateful component, which wires the operations on sessions to the state of the screen.
 *
 * @remarks
 * Everything the screen shows is in the state the reducer gives, and everything a key asks is read from that
 * state by `requestOf` and `interruptionOf`. This component does the rest, and nothing else: it follows the
 * events of the session on screen — subscribed when a thread comes on screen, again after its last event when
 * the session is resumed for a new turn, left when another thread comes or when the conversation ends —, calls
 * the operation a key asked for, and tells the reducer what came back. The
 * events a session tells in one go are given to the reducer together, so that a long thread reopened is read
 * once and not once per event.
 *
 * It ends by telling how the person left, a {@link Leaving}, to whoever opened it, which then closes the screen.
 *
 * @param props - The operations, where the conversation takes place, what draws and times it, and who hears it end.
 * @returns The screen.
 */
export function Conversation({ sessions, context, latest, theme, now, serve, reasonOf, onLeave, model }: ConversationProps): ReactNode {
  const [state, dispatch] = useReducer(conversationReducer, undefined, () => initialState(latest, now()));
  const { columns } = useWindowSize();
  const fail = (error: unknown): void => dispatch({ type: "failed", why: reasonOf(error) });

  const followed = state.shown?.session.id;
  const turn = state.shown?.resumed;
  useEffect(() => {
    if (followed === undefined) return undefined;
    // A turn the conversation resumed the session for is followed after what the thread already holds.
    const after = state.shown?.events.at(-1)?.id ?? 0;
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
    void sessions.events(followed, after).then((events) => {
      if (!left) leave = events.subscribe(listener);
    }, fail);
    return () => {
      left = true;
      leave();
    };
  }, [followed, turn]);

  // The model is tested once the conversation is on screen, so that it opens at once: a model that does not answer is told as soon as it is known.
  useEffect(() => {
    void model
      .inForce()
      .then(async (inForce) => silenceOf(inForce, await model.check(inForce)))
      .then((why) => (why === undefined ? undefined : dispatch({ type: "model-silent", why })), fail);
  }, []);

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
      case "resume":
        return void sessions.resume(request.session, { text: request.text }).then((session) => dispatch({ type: "resumed", session }), fail);
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
      case "model":
        return void model.inForce().then((inForce) => dispatch({ type: "model-opened", inForce }), fail);
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
    // The setting of the model hears its own keys, Ctrl-C aside, which closes it as it closes any list.
    if (state.overlay?.kind === "model" && !(key.ctrl && input === "c")) return;
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

  const setup = { check: model.check, save: model.save, reasonOf, onEnd: (end: SetupEnd) => dispatch({ type: "model-ended", end }) };
  return h(ConversationView, { state, context, theme, width: columns, setup, onChange: (input) => dispatch({ type: "typed", input }), onSubmit: submit });
}
