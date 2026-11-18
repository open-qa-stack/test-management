import { useEffect, useMemo, useReducer, useRef, useSyncExternalStore, type FormEvent, type KeyboardEvent as FieldKeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { consoleAfter, INITIAL_STATE, playbackOf } from "./agent/console-state.ts";
import { ConsoleSync } from "./agent/console-sync.ts";
import type { LiveSession, SessionControls } from "./agent/live-session.ts";
import { focusAfterLook, openedLookOf, withoutLook } from "./agent/opened-look.ts";
import { frameOf, type PlaybackAction } from "./agent/playback.ts";
import { scriptOf } from "./agent/session-steps.ts";
import { asksToStop, focusAfterStop, withoutStop } from "./agent/stop-request.ts";
import { api } from "./api/instance-api.ts";
import { i18n } from "./i18n/i18n.ts";
import { Console, documentTitleOf, isEntry, sessionAt, type ConsoleProps } from "./console.tsx";
import { hrefTo, parseRoute } from "./routing/route.ts";

/** How long a beat of a replay lasts, in milliseconds. */
const BEAT_MS = 45;

/** How far below the window the end of the thread may be for the console to keep following it, in pixels. */
const FOLLOWED_PX = 600;

/** Tells React when the address changes. */
function onAddressChange(changed: () => void): () => void {
  window.addEventListener("hashchange", changed);
  return () => window.removeEventListener("hashchange", changed);
}

/** The fragment of the address. */
function currentHash(): string {
  return window.location.hash;
}

/**
 * The console in a browser: it follows the address, keeps its state in step with the instance, names the page
 * and moves the focus as the person goes from screen to screen, keeps the end of a thread in view, sends what
 * the person says to the agents of a session — or resumes it with that, once it ended — and empties its field
 * once the instance took it, asks the
 * instance to stop a session once the person confirmed it, takes the
 * keyboard into the look a person opens and back to its action when it closes, and beats the clock of a replay.
 *
 * @returns The console at the address of the page.
 */
export function App(): ReactNode {
  const hash = useSyncExternalStore(onAddressChange, currentHash);
  const route = useMemo(() => parseRoute(hash), [hash]);
  const [state, dispatch] = useReducer(consoleAfter, INITIAL_STATE);
  const sync = useMemo(() => new ConsoleSync(api, dispatch), []);
  const id = sessionAt(route);
  const followed = state.followed?.id === id ? state.followed : undefined;
  const session = followed?.session;
  const events = followed?.events;
  // The console speaks the language of the configuration in force, once the instance told it: everything it draws follows.
  const { language } = state;
  const spoken = useTranslation().i18n.resolvedLanguage;
  useEffect(() => {
    if (language !== undefined) void i18n.changeLanguage(language);
  }, [language]);
  useEffect(() => {
    if (spoken !== undefined) document.documentElement.lang = spoken;
  }, [spoken]);
  // The words of a thread are those of the language it is read in: it is read again in another.
  const script = useMemo(() => (session === undefined || events === undefined ? undefined : scriptOf(session, events)), [session, events, spoken]);

  useEffect(() => sync.project(), [sync]);
  useEffect(() => sync.language(), [sync]);
  useEffect(() => sync.sessions(), [sync]);
  useEffect(() => (id === undefined ? undefined : sync.follow(id)), [sync, id]);

  const playback = script === undefined ? undefined : playbackOf(state, script.id);
  const replaying = playback?.following === false && playback.playing;
  useEffect(() => {
    if (!replaying || script === undefined) return undefined;
    const beat = window.setInterval(() => dispatch({ type: "playback", script, action: { type: "beat" } }), BEAT_MS);
    return () => window.clearInterval(beat);
  }, [replaying, script]);

  // The configuration names the applications of the project and its language: once it is saved, both are read again.
  const configured = useMemo(() => sync.configured.bind(sync), [sync]);

  const open = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const request = (event.currentTarget.elements.namedItem("request") as HTMLTextAreaElement).value.trim();
    if (request === "") return;
    sync.open(request, (opened) => {
      // A person who left the entry while the session opened is not taken away from where they went.
      if (isEntry(parseRoute(currentHash()))) window.location.hash = hrefTo(`/agent/sessions/${opened.id}`);
    });
  };

  const frame = script === undefined || playback === undefined ? undefined : frameOf(script, playback);
  let live: LiveSession | undefined;
  if (session !== undefined && script !== undefined && playback !== undefined && frame !== undefined && followed !== undefined) {
    const act = (action: PlaybackAction) => dispatch({ type: "playback", script, action });
    const controls: SessionControls = {
      toggle: () => act({ type: "toggle" }),
      restart: () => act({ type: "restart" }),
      faster: () => act({ type: "faster" }),
      skip: () => act({ type: "skip" }),
      follow: () => act({ type: "follow" }),
      say: (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        const text = (event.currentTarget.elements.namedItem("message") as HTMLTextAreaElement).value.trim();
        if (text === "") return;
        // A session that ended takes no message: what the person says more resumes it, for a new turn.
        if (script.stage === "ended") sync.resume(session.id, text);
        else sync.say(session.id, text);
      },
      // Once the instance took the request, its confirmation closes: the bar of the session says the stop was asked.
      unfold: (index: number) => dispatch({ type: "unfold", id: session.id, index }),
      stop: () => sync.interrupt(session.id, () => (window.location.hash = withoutStop(parseRoute(currentHash())))),
      sayOnEnter: (event: FieldKeyboardEvent<HTMLTextAreaElement>): void => {
        // Enter sends, as in a conversation; with Shift it starts a new line, and while a character is being composed it chooses it.
        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.currentTarget.form!.requestSubmit();
      },
    };
    live = {
      session,
      stream: followed.stream,
      script,
      playback,
      frame,
      saying: followed.saying,
      stopping: followed.stopping,
      unfolded: followed.unfolded,
      controls,
    };
  }
  const shown: ConsoleProps = {
    route,
    unreachable: state.unreachable,
    missing: followed?.missing === true,
    opening: state.opening,
    onOpen: open,
    onConfigured: configured,
    ...(state.project === undefined ? {} : { project: state.project }),
    ...(state.sessions === undefined ? {} : { sessions: state.sessions }),
    ...(state.unlisted === undefined ? {} : { unlisted: state.unlisted }),
    ...(live === undefined ? {} : { live }),
  };

  const title = documentTitleOf(shown);
  const titled = useRef(title);
  useEffect(() => {
    document.title = title;
    if (titled.current === title) return;
    titled.current = title;
    // Another screen came without the page loading again: a screen reader and the keyboard would stay on the one left.
    document.querySelector<HTMLElement>("main h1")?.focus({ preventScroll: true });
  }, [title]);

  const saying = followed?.saying.state;
  const last = frame?.shown.length ?? 0;
  const shownBefore = useRef(0);
  useEffect(() => {
    const opening = shownBefore.current === 0;
    shownBefore.current = last;
    const end = document.querySelector(".session-end");
    // A session opens on its latest step; after that, a person who scrolled back up to read is left where they are.
    const near = end !== null && end.getBoundingClientRect().top - window.innerHeight < FOLLOWED_PX;
    // A person who asked for less motion gets the new step without the glide.
    const still = opening || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (opening || near) end?.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
    // The composer grows when it says why a message was refused: the end of the thread is brought back over it.
  }, [last, saying]);

  const sayingBefore = useRef(saying);
  useEffect(() => {
    const answered = sayingBefore.current === "sending";
    sayingBefore.current = saying;
    const field = document.querySelector<HTMLTextAreaElement>(".composer textarea");
    if (!answered || field === null) return;
    // A message the instance took leaves the field; one it refused stays there, to be sent again. The field lost the focus while it waited.
    if (saying === "idle") field.value = "";
    field.focus();
  }, [saying]);

  const looked = script === undefined ? undefined : openedLookOf(route, script)?.index;
  const lookedBefore = useRef(looked);
  useEffect(() => {
    const target = focusAfterLook(lookedBefore.current, looked);
    lookedBefore.current = looked;
    if (target !== undefined) document.querySelector<HTMLElement>(target)?.focus();
    // A wide screen makes room for the look beside the thread, whose lines wrap again: the action looked into comes back in sight.
    document.querySelector(".act.selected")?.scrollIntoView({ block: "nearest" });
  }, [looked]);
  useEffect(() => {
    if (looked === undefined) return undefined;
    const close = (event: KeyboardEvent): void => {
      if (event.key === "Escape") window.location.hash = withoutLook(route);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [looked, route]);

  const stopAsked = asksToStop(route);
  const stopAskedBefore = useRef(stopAsked);
  useEffect(() => {
    const target = focusAfterStop(stopAskedBefore.current, stopAsked);
    stopAskedBefore.current = stopAsked;
    if (target !== undefined) document.querySelector<HTMLElement>(target)?.focus();
  }, [stopAsked]);

  return <Console {...shown} />;
}
