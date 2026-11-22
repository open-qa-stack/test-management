import { ENV_VAR_PATTERN, type Model, type SourceCheck } from "@open-qa-stack/domain";
import { isAddress, SOURCE_KINDS, type DraftSource, type Exposes, type ProjectDraft, type SourceKind } from "./project-draft.ts";

/** What an application may expose, in the order of the list. */
export const EXPOSES: readonly Exposes[] = ["web", "api", "web-and-api"];

/** The choices of the step of the knowledge: a kind to add, or going on. */
export const SOURCE_CHOICES: readonly (SourceKind | "done")[] = [...SOURCE_KINDS, "done"];

/** The variable a connection string is kept under unless the person names another. */
export const DATABASE_VARIABLE = "DATABASE_URL";

/** A step of the setting up of a project in the terminal. */
export type ProjectStep = "name" | "exposes" | "uiUrl" | "apiUrl" | "sources" | "where" | "variable" | "value" | "checking" | "model" | "summary" | "creating";

/** The setting up of a project in the terminal, as it stands. */
export interface ProjectSetupState {
  readonly step: ProjectStep;
  /** The project as it is set so far. */
  readonly draft: ProjectDraft;
  /** The line chosen in the list of the step. */
  readonly selected: number;
  /** What is typed in the field of the step. */
  readonly text: string;
  /** Why what was typed is refused, until it is typed again. */
  readonly refusal?: "name" | "address" | "where" | "variable";
  /** The source being declared, until its test answered. */
  readonly pending?: DraftSource;
  /** Why the last source tested does not answer, which the person corrects. */
  readonly failure?: string;
}

/** What changes the setting up. */
export type ProjectSetupAction =
  /** The person moved in a list. */
  | { readonly type: "moved"; readonly by: number }
  /** They pressed Enter on a list. */
  | { readonly type: "chosen" }
  /** They typed in a field. */
  | { readonly type: "typed"; readonly text: string }
  /** They pressed Enter in a field. */
  | { readonly type: "entered" }
  /** They gave up the source being declared. */
  | { readonly type: "dropped" }
  /** The test of the source being declared found something. */
  | { readonly type: "checked"; readonly check: SourceCheck }
  /** The connection to the model is set, with the key typed when one was. */
  | { readonly type: "modelled"; readonly model: Model; readonly key: string | undefined };

/** The setting up before anything is typed: the name of the application is asked first. */
export const PROJECT_START: ProjectSetupState = { step: "name", draft: { name: "", exposes: "web", sources: [] }, selected: 0, text: "" };

/** The state without what a step left: the refusal, the failure. */
function settled(state: ProjectSetupState): ProjectSetupState {
  const { refusal: _, failure: __, ...kept } = state;
  return kept;
}

/** The state once the person goes back to the list of the knowledge, the source being declared given up. */
function toSources(state: ProjectSetupState): ProjectSetupState {
  const { pending: _, ...kept } = settled(state);
  return { ...kept, step: "sources", selected: 0, text: "" };
}

/** The length of the list of the step; none for a field. */
function lengthOf(step: ProjectStep): number {
  if (step === "exposes") return EXPOSES.length;
  return step === "sources" ? SOURCE_CHOICES.length : 0;
}

/** The step once a choice of a list is made. */
function chosen(state: ProjectSetupState): ProjectSetupState {
  if (state.step === "exposes") {
    const exposes = EXPOSES[state.selected]!;
    return { ...state, draft: { ...state.draft, exposes }, step: exposes === "api" ? "apiUrl" : "uiUrl", text: "" };
  }
  if (state.step === "summary") return { ...state, step: "creating" };
  if (state.step !== "sources") return state;
  const choice = SOURCE_CHOICES[state.selected]!;
  if (choice === "done") return { ...state, step: "model", selected: 0 };
  if (choice === "documents") return { ...state, draft: { ...state.draft, sources: [...state.draft.sources, { kind: "documents" }] } };
  return { ...state, pending: { kind: choice }, step: choice === "postgresql" ? "variable" : "where", text: choice === "postgresql" ? DATABASE_VARIABLE : "" };
}

/** The step once a text is entered. */
function entered(state: ProjectSetupState): ProjectSetupState {
  const text = state.text.trim();
  switch (state.step) {
    case "name":
      return text === "" ? { ...state, refusal: "name" } : { ...settled(state), draft: { ...state.draft, name: text }, step: "exposes", selected: 0, text: "" };
    case "uiUrl": {
      if (!isAddress(text)) return { ...state, refusal: "address" };
      const draft = { ...state.draft, uiUrl: text };
      return state.draft.exposes === "web-and-api" ? { ...settled(state), draft, step: "apiUrl", text: "" } : toSources({ ...state, draft });
    }
    case "apiUrl":
      return isAddress(text) ? toSources({ ...state, draft: { ...state.draft, apiUrl: text } }) : { ...state, refusal: "address" };
    case "where":
      return text === "" ? { ...state, refusal: "where" } : { ...settled(state), pending: { ...state.pending!, where: text }, step: "checking" };
    case "variable":
      return new RegExp(ENV_VAR_PATTERN).test(text)
        ? { ...settled(state), pending: { ...state.pending!, variable: text }, step: "value", text: "" }
        : { ...state, refusal: "variable" };
    case "value": {
      // A connection string left empty is read from the environment, as in a CI.
      const { value: _, ...pending } = state.pending!;
      return { ...settled(state), pending: text === "" ? pending : { ...pending, value: text }, step: "checking" };
    }
    default:
      return state;
  }
}

/** The step once the test of the source being declared answered: kept when it answers, corrected when it does not. */
function checked(state: ProjectSetupState, check: SourceCheck): ProjectSetupState {
  const pending = state.pending!;
  if (check.state === "failed")
    return pending.kind === "postgresql"
      ? { ...state, step: "value", text: "", failure: check.reason }
      : { ...state, step: "where", text: pending.where!, failure: check.reason };
  return toSources({ ...state, draft: { ...state.draft, sources: [...state.draft.sources, { ...pending, check }] } });
}

/**
 * Gives the setting up after an action.
 *
 * @param state - The setting up before.
 * @param action - What the person did, or what a test or the model answered.
 * @returns The setting up after.
 */
export function projectSetupAfter(state: ProjectSetupState, action: ProjectSetupAction): ProjectSetupState {
  switch (action.type) {
    case "moved": {
      const length = lengthOf(state.step);
      return length === 0 ? state : { ...state, selected: (state.selected + action.by + length) % length };
    }
    case "chosen":
      return chosen(state);
    case "typed": {
      const { refusal: _, ...rest } = state;
      return { ...rest, text: action.text };
    }
    case "entered":
      return entered(state);
    case "dropped":
      return state.pending === undefined ? state : toSources(state);
    case "checked":
      return state.step === "checking" ? checked(state, action.check) : state;
    case "modelled":
      return state.step === "model"
        ? { ...state, step: "summary", draft: { ...state.draft, model: action.model, ...(action.key === undefined ? {} : { key: action.key }) } }
        : state;
  }
}
