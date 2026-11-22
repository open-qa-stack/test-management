import { Box, Text, useInput } from "ink";
import { createElement as h, useEffect, useReducer, type ReactNode } from "react";
import { providerOf, type Model, type ModelConnectionCheck } from "@open-qa-stack/domain";
import { t } from "../i18n/i18n.ts";
import type { Theme } from "../palette.ts";
import { choiceLines, setupField, waitingLine } from "../setup-parts.ts";
import { AFTER_FAILURE, CONNECTIONS, GITHUB, OTHER, offeredModels, setupAfter, setupStart, type SetupState } from "./model-setup-state.ts";

/** How the setting ended: the connection recorded, or nothing when the person left it, or why it could not go on. */
export interface SetupEnd {
  readonly saved?: Model;
  readonly error?: string;
}

/** What the setting of the connection to the model is given. */
export interface ModelSetupProps {
  /** The connection in force. */
  readonly inForce: Model;
  /** Tests a connection, with the key the person typed when they typed one. */
  readonly check: (model: Model, key?: string) => Promise<ModelConnectionCheck>;
  /** Records a connection, and saves the key the person typed for its variable when they typed one. */
  readonly save: (model: Model, key?: string) => Promise<void>;
  /** Says why an operation failed, in the words of the person. */
  readonly reasonOf: (error: unknown) => string;
  /** Called once, when the setting ends. */
  readonly onEnd: (end: SetupEnd) => void;
  readonly theme: Theme;
}

/**
 * Sets the connection to the model in a terminal, as the card of the console does: the person chooses how to
 * reach it in a list, types the address and the variable of the key when the connection needs them, and the key
 * itself, unseen, when that variable holds none; the connection is tested, and they choose the model among those it
 * offers. Escape leaves it, and nothing is recorded.
 *
 * @param props - The connection in force, what tests and records one, and what to call at the end.
 * @returns The setting, step by step.
 */
export function ModelSetup({ inForce, check, save, reasonOf, onEnd, theme }: ModelSetupProps): ReactNode {
  const [state, dispatch] = useReducer(setupAfter, inForce, setupStart);
  const { step, draft } = state;

  useEffect(() => {
    if (step === "testing")
      check(draft, state.typedKey).then(
        (found) => dispatch({ type: "tested", check: found }),
        (error: unknown) => onEnd({ error: reasonOf(error) }),
      );
    if (step === "saving")
      save(draft, state.typedKey).then(
        () => dispatch({ type: "saved" }),
        (error: unknown) => onEnd({ error: reasonOf(error) }),
      );
    if (step === "saved") onEnd({ saved: draft });
  }, [step]);

  useInput((_input, key) => {
    if (key.escape) onEnd({});
    else if (key.upArrow || key.downArrow) dispatch({ type: "moved", by: key.upArrow ? -1 : 1 });
    else if (key.return) dispatch({ type: "chosen" });
  });

  const typing = { theme, text: state.text, onType: (text: string) => dispatch({ type: "typed", text }), onEnter: () => dispatch({ type: "entered" }) };
  const field = (label: string, hint: string, mask?: string): ReactNode =>
    setupField({
      ...typing,
      label,
      hint,
      ...(mask === undefined ? {} : { mask }),
      ...(state.refusal === undefined ? {} : { refusal: t(`model.refused.${state.refusal}`) }),
    });
  const list = (lines: readonly string[]): ReactNode[] => choiceLines(theme, lines, state.selected);
  const waiting = (text: string): ReactNode => waitingLine(theme, text);

  return h(
    Box,
    { flexDirection: "column", marginTop: 1 },
    h(Text, { ...theme.ink("accent"), bold: true }, t("model.title")),
    ...stepOf(state, { field, list, waiting, theme }),
    h(Text, theme.ink("muted"), t(step === "connection" || step === "model" || step === "failed" ? "model.keys.list" : "model.keys.field")),
  );
}

/** What draws a step: a field, a list, or a wait. */
interface Drawing {
  readonly field: (label: string, hint: string, mask?: string) => ReactNode;
  readonly list: (lines: readonly string[]) => ReactNode[];
  readonly waiting: (text: string) => ReactNode;
  readonly theme: Theme;
}

/** The lines of the step the setting is at. */
function stepOf(state: SetupState, { field, list, waiting, theme }: Drawing): ReactNode[] {
  switch (state.step) {
    case "connection":
      return [h(Text, null, t("model.choose")), ...list(CONNECTIONS.map(connectionLabel))];
    case "address":
      return [field(t("model.address"), t("model.addressHint"))];
    case "key":
      return [field(t("model.key"), t("model.keyHint"))];
    case "secret":
      return [
        field(t("model.secret"), t("model.secretHint", { variable: (state.check as Extract<ModelConnectionCheck, { state: "key-missing" }>).variable }), "•"),
      ];
    case "testing":
      return [waiting(t("model.testing"))];
    case "model":
      return [h(Text, theme.ink("ok"), checkText(state.check!)), ...list(offeredModels(state).map(({ id, name }) => (name === id ? id : `${name} (${id})`)))];
    case "name":
      return [h(Text, theme.ink("ok"), checkText(state.check!)), field(t("model.name"), t("model.nameHint"))];
    case "failed":
      return [h(Text, theme.ink("warn"), checkText(state.check!)), ...list(AFTER_FAILURE.map((choice) => t(`model.after.${choice}`)))];
    case "saving":
    case "saved":
      return [waiting(t("model.saving", { model: state.draft.model, reach: reachText(state.draft) }))];
  }
}

/** How a connection of the list is named. */
function connectionLabel(choice: string): string {
  if (choice === GITHUB) return t("model.github");
  return choice === OTHER ? t("model.other") : choice;
}

/** How the model is reached, in a few words. */
export function reachText(model: Model): string {
  return model.mode === "github" ? t("model.github") : (providerOf(model.baseUrl)?.name ?? model.baseUrl);
}

/**
 * What a test of the connection found, in the words of the person: what works, or what to do.
 *
 * @param check - What the test found.
 * @returns A sentence.
 */
export function checkText(check: ModelConnectionCheck): string {
  switch (check.state) {
    case "connected": {
      const answers = check.account === undefined ? t("model.check.connected") : t("model.check.connectedAs", { account: check.account });
      return `${answers} ${check.models === undefined ? t("model.check.noList") : t("model.check.pick")}`;
    }
    case "signed-out":
      return t("model.check.signedOut");
    case "no-models":
      return t("model.check.noModels", { account: check.account });
    case "key-missing":
      return t("model.check.keyMissing", { variable: check.variable });
    case "key-refused":
      return t("model.check.keyRefused", { status: check.status });
    case "unreachable":
      return t("model.check.unreachable", { url: check.url });
  }
}
