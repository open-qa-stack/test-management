import { Box, Static, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import { scriptOf } from "@open-qa-stack/domain/sessions";
import { BlockView } from "./block-view.ts";
import { CommandHints } from "./command-hints.ts";
import { hintsOf } from "./key-hints.ts";
import { PrintedItem } from "./printed-item.ts";
import { ModelSetup, type ModelSetupProps } from "./model-setup/model-setup.ts";
import { Prompt } from "./prompt.ts";
import { SessionPicker } from "./session-picker.ts";
import { hintedCommands } from "./slash-commands.ts";
import { StatusLine } from "./status-line.ts";
import { StopConfirmation } from "./stop-confirmation.ts";
import { blocksOf } from "./thread-blocks.ts";
import { progressOf } from "./thread-progress.ts";
import { wording } from "./wording.ts";
import type { ConversationContext, ConversationState, Printed } from "./conversation-state.ts";
import { GUTTER, type Theme } from "./palette.ts";

/** What the screen of the conversation needs. */
export interface ConversationViewProps {
  readonly state: ConversationState;
  readonly context: ConversationContext;
  readonly theme: Theme;
  /** The width of the terminal, in columns. */
  readonly width: number;
  /** Hears what the person types in the input. */
  readonly onChange: (input: string) => void;
  /** Hears Enter in the input. */
  readonly onSubmit: () => void;
  /** What the setting of the model is given, when it opens over the input. */
  readonly setup?: Omit<ModelSetupProps, "inForce" | "theme">;
}

/**
 * The screen of the conversation, a function of its state: what is written for good goes to the scrollback of
 * the terminal, once, and under it stays the live part — the blocks of the thread that may still change, then
 * what stands over the input or the input itself, with the state of the session above it while it goes on, and the keys below.
 *
 * @param props - The conversation, where it takes place, the theme, the width and what hears the input.
 * @returns The screen.
 */
export function ConversationView({ state, context, theme, width, onChange, onSubmit, setup }: ConversationViewProps): ReactNode {
  const { shown, overlay } = state;
  const script = shown === undefined ? undefined : scriptOf(shown.session, shown.events, wording());
  const live = script === undefined || shown === undefined ? [] : blocksOf(script.steps).slice(shown.settled);
  const hints = hintsOf(state);
  const commands = overlay === undefined ? hintedCommands(state.input) : [];
  const muted = theme.ink("muted");
  return h(
    Box,
    { flexDirection: "column", width },
    h(Static<Printed>, { items: [...state.printed], style: { width }, children: (item, index) => h(PrintedItem, { key: index, item, context, theme, width }) }),
    ...live.map((block, index) => h(BlockView, { key: index, block, live: true, theme, width })),
    shown === undefined || script === undefined || script.stage === "ended"
      ? h(Box, { marginTop: overlay === undefined ? 1 : 0 })
      : h(StatusLine, { session: shown.session, progress: progressOf(script), now: state.now, theme }),
    overlay?.kind === "picker" ? h(SessionPicker, { picker: overlay, theme }) : null,
    overlay?.kind === "stop" ? h(StopConfirmation, { session: overlay.session, theme }) : null,
    overlay?.kind === "model" && setup !== undefined ? h(ModelSetup, { ...setup, inForce: overlay.inForce, theme }) : null,
    state.notice === undefined ? null : h(Text, theme.ink("warn"), state.notice),
    overlay === undefined ? h(Prompt, { value: state.input, epoch: state.inputEpoch, placeholder: hints.placeholder, onChange, onSubmit, theme }) : null,
    commands.length > 0
      ? h(CommandHints, { commands, theme })
      : h(Box, { paddingLeft: GUTTER }, h(Text, { ...muted, wrap: "truncate-end" }, hints.keys.join(` ${theme.glyphs.separator} `))),
  );
}
