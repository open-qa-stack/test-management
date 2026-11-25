import { Box, Text, useInput } from "ink";
import { createElement as h, useEffect, useReducer, type ReactNode } from "react";
import type { Knowledge, Model, ModelConnectionCheck, RepositoryPreparation, SourceCheck } from "@open-qa-stack/domain";
import { t } from "../../i18n/i18n.ts";
import { ModelSetup } from "../model-setup/model-setup.ts";
import type { Theme } from "../../view/palette.ts";
import { choiceLines, setupField, waitingLine } from "../setup-parts.ts";
import { knowledgeOf, slugOf, sourceIds, type DraftSource, type ProjectDraft } from "./project-draft.ts";
import { EXPOSES, PROJECT_START, projectSetupAfter, SOURCE_CHOICES, type ProjectSetupState } from "./project-setup-state.ts";

/** How the setting up ended: the project created, with what setting its repository up did; nothing when the person left it; or why it could not go on. */
export interface ProjectSetupEnd {
  readonly created?: RepositoryPreparation;
  readonly error?: string;
}

/** What the setting up of a project is given. */
export interface ProjectSetupProps {
  /** The folder the project is set up in. */
  readonly folder: string;
  /** Tests a knowledge source, with the connection string typed for a database. */
  readonly check: (source: Knowledge, value?: string) => Promise<SourceCheck>;
  /** Tests a connection to the model, with the key typed when one was. */
  readonly checkModel: (model: Model, key?: string) => Promise<ModelConnectionCheck>;
  /** Creates the project the person set up. */
  readonly create: (draft: ProjectDraft) => Promise<RepositoryPreparation>;
  /** Says why an operation failed, in the words of the person. */
  readonly reasonOf: (error: unknown) => string;
  /** Called once, when the setting up ends. */
  readonly onEnd: (end: ProjectSetupEnd) => void;
  readonly theme: Theme;
}

/** The steps whose input is a field, where Esc gives up the source being declared rather than the setting up. */
const SOURCE_FIELDS = new Set(["where", "variable", "value"]);

/** The steps whose input is a list, where Enter chooses: in a field, the field takes it, and the list that follows does not. */
const LISTS = new Set(["exposes", "sources", "summary"]);

/**
 * Sets a project up in a terminal, as the console does in « Get started »: the application to test and its address,
 * what the agents may read — each source tested as soon as it is declared —, the model, then a summary that creates
 * the project. Esc leaves it, and nothing is written; in the field of a source, it gives that source up.
 *
 * @param props - The folder, what tests a source and the model, what creates the project, and what to call at the end.
 * @returns The setting up, step by step.
 */
export function ProjectSetup({ folder, check, checkModel, create, reasonOf, onEnd, theme }: ProjectSetupProps): ReactNode {
  const [state, dispatch] = useReducer(projectSetupAfter, PROJECT_START);
  const { step, draft, pending } = state;

  useEffect(() => {
    if (step === "checking") {
      const source = knowledgeOf(pending!, sourceIds([...draft.sources, pending!]).at(-1)!, slugOf(draft.name));
      check(source, pending!.value).then(
        (found) => dispatch({ type: "checked", check: found }),
        (error: unknown) => dispatch({ type: "checked", check: { state: "failed", reason: reasonOf(error) } }),
      );
    }
    if (step === "creating")
      create(draft).then(
        (created) => onEnd({ created }),
        (error: unknown) => onEnd({ error: reasonOf(error) }),
      );
  }, [step]);

  useInput(
    (_input, key) => {
      if (key.escape) {
        if (SOURCE_FIELDS.has(step)) dispatch({ type: "dropped" });
        else onEnd({});
      } else if (key.upArrow || key.downArrow) dispatch({ type: "moved", by: key.upArrow ? -1 : 1 });
      else if (key.return && LISTS.has(step)) dispatch({ type: "chosen" });
    },
    { isActive: step !== "model" },
  );

  const typing = { theme, text: state.text, onType: (text: string) => dispatch({ type: "typed", text }), onEnter: () => dispatch({ type: "entered" }) };
  const field = (label: string, hint: string, mask?: string): ReactNode =>
    setupField({
      ...typing,
      label,
      hint,
      ...(mask === undefined ? {} : { mask }),
      ...(state.failure === undefined ? {} : { warning: t("setup.unanswered", { reason: state.failure }) }),
      ...(state.refusal === undefined ? {} : { refusal: t(`setup.refused.${state.refusal}`) }),
    });
  const list = (lines: readonly string[]): ReactNode[] => choiceLines(theme, lines, state.selected);
  const waiting = (text: string): ReactNode => waitingLine(theme, text);

  if (step === "model")
    return h(
      Box,
      { flexDirection: "column" },
      h(Text, { ...theme.ink("accent"), bold: true }, t("setup.title")),
      h(ModelSetup, {
        inForce: { mode: "github", model: "" },
        check: checkModel,
        // The connection is kept as it is set, and the setting up goes on to its summary: the setting of the model, let
        // go, never ends with it; only leaving it, or failing, ends the setting up here.
        save: (model, key) => {
          dispatch({ type: "modelled", model, key });
          return new Promise(() => undefined);
        },
        reasonOf,
        onEnd: ({ error }) => onEnd(error === undefined ? {} : { error }),
        theme,
      }),
    );
  return h(
    Box,
    { flexDirection: "column", marginTop: 1 },
    h(Text, { ...theme.ink("accent"), bold: true }, t("setup.title")),
    ...stepOf(state, folder, { field, list, waiting, theme }),
    h(
      Text,
      theme.ink("muted"),
      t(step === "exposes" || step === "sources" ? "setup.keys.list" : step === "summary" ? "setup.keys.summary" : "setup.keys.field"),
    ),
  );
}

/** What draws a step: a field, a list, or a wait. */
interface Drawing {
  readonly field: (label: string, hint: string, mask?: string) => ReactNode;
  readonly list: (lines: readonly string[]) => ReactNode[];
  readonly waiting: (text: string) => ReactNode;
  readonly theme: Theme;
}

/** The line of a source declared, with what its test found. */
function sourceLine(source: DraftSource, id: string): string {
  // A source is kept once it answers; documents, which are given later, are not tested.
  const found = source.check;
  const told = found?.state === "ok" ? t("setup.answered", { count: found.items }) : t("setup.sourceLater");
  return `${id}  ${t(`setup.kinds.${source.kind}`)}  ${told}`;
}

/** The lines of the step the setting up is at. */
function stepOf(state: ProjectSetupState, folder: string, { field, list, waiting, theme }: Drawing): ReactNode[] {
  const { draft, pending } = state;
  switch (state.step) {
    case "name":
      return [h(Text, theme.ink("muted"), t("setup.folder", { folder })), field(t("setup.name"), t("setup.nameHint"))];
    case "exposes":
      return [h(Text, null, t("setup.exposes")), ...list(EXPOSES.map((exposes) => t(`setup.exposesChoices.${exposes}`)))];
    case "uiUrl":
      return [field(t("setup.uiUrl"), t("setup.urlHint"))];
    case "apiUrl":
      return [field(t("setup.apiUrl"), t("setup.urlHint"))];
    case "sources": {
      const ids = sourceIds(draft.sources);
      return [
        h(Text, null, t("setup.sources")),
        ...draft.sources.map((source, index) => h(Text, { key: `s${index}`, ...theme.ink("ok") }, sourceLine(source, ids[index]!))),
        ...list(SOURCE_CHOICES.map((choice) => t(`setup.add.${choice}`))),
      ];
    }
    case "where":
      return [field(t(`setup.where.${pending!.kind as "openapi" | "source-code"}`), t(`setup.whereHint.${pending!.kind as "openapi" | "source-code"}`))];
    case "variable":
      return [field(t("setup.variable"), t("setup.variableHint"))];
    case "value":
      return [field(t("setup.value"), t("setup.valueHint", { variable: pending!.variable }), "•")];
    case "checking":
      return [waiting(t("setup.checking"))];
    case "summary":
      return [h(Text, null, t("setup.summary", { folder })), ...summaryLines(draft).map((line, index) => h(Text, { key: index }, `  ${line}`))];
    default:
      // The project is being created: the model, the one step left, is drawn by the setting of the model.
      return [waiting(t("setup.creating"))];
  }
}

/**
 * What the setting up will write, said before it does.
 *
 * @param draft - The project as the person set it up.
 * @returns A line for the application, one for the knowledge, one for the model.
 */
export function summaryLines(draft: ProjectDraft): string[] {
  const addresses = [draft.uiUrl, draft.apiUrl].filter((url) => url !== undefined).join(", ");
  const model = draft.model!;
  return [
    t("setup.summaryApplication", { name: draft.name, addresses }),
    t("setup.summaryKnowledge", { count: draft.sources.length }),
    model.mode === "github" ? t("setup.summaryGithub", { model: model.model }) : t("setup.summaryProvider", { model: model.model }),
  ];
}
