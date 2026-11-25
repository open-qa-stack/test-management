import { Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import type { Session } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { Marked } from "./marked.ts";
import { standing } from "./session-facts.ts";
import type { Theme, Tone } from "./palette.ts";

/** How many characters of the end of an identifier name a session in a list: what tells it from the others. */
const NAMED_BY = 8;

/** What a session of a list needs. */
export interface SessionLineProps {
  readonly session: Session;
  /** Whether the list has this line selected. */
  readonly selected?: boolean;
  readonly theme: Theme;
}

/**
 * The tone of how a session stands.
 *
 * @param session - The session.
 * @returns The accent while it goes on, a warning when it was interrupted or has no clear verdict, and otherwise that of how it ended.
 */
export function standingTone(session: Session): Tone {
  if (session.state === "queued" || session.state === "running") return "accent";
  const outcome = session.state === "completed" ? session.result?.outcome : undefined;
  return outcome === "passed" ? "ok" : outcome === "failed" ? "ko" : "warn";
}

/**
 * A session, on one line of a list: the end of its identifier, how it stands, and what was asked — or that it maps the
 * knowledge —, cut to the line.
 *
 * @param props - The session, whether it is selected, and the theme.
 * @returns The line.
 */
export function SessionLine({ session, selected = false, theme }: SessionLineProps): ReactNode {
  const asked = session.purpose === "map" ? t("facts.mapping") : (session.request ?? "").replace(/\s+/g, " ").trim();
  return h(
    Marked,
    { mark: selected ? theme.glyphs.pointer : "", style: theme.ink("accent") },
    h(
      Text,
      { wrap: "truncate-end", bold: selected },
      h(Text, theme.ink("muted"), session.id.slice(-NAMED_BY)),
      "  ",
      h(Text, theme.ink(standingTone(session)), standing(session)),
      asked === "" ? null : `  ${asked}`,
    ),
  );
}
