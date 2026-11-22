import type {
  Autonomy,
  ConfigError,
  ConfigurationView,
  Model,
  ModelConnectionCheck,
  OqasConfig,
  ProblemCode,
  RepositoryPreparation,
  RepositoryState,
  RevisionSummary,
  SecretState,
  Knowledge,
  SourceCheck,
} from "@open-qa-stack/domain/sessions";
import { withFollowers } from "./derived-names.ts";
import { modelFor } from "./model-connection.ts";
import { appendedAt, changedAt, removedAt, valueAt } from "./json-pointer.ts";

/** What the screen of the configuration holds: what the instance told, and the change the person is making. */
export interface ConfigurationState {
  /** The configuration as the instance last told it; `undefined` before it did. */
  readonly view?: ConfigurationView;
  /** The revisions, the latest first; `undefined` before the instance listed them. */
  readonly revisions?: readonly RevisionSummary[];
  /** The configuration as the person is changing it; that of the revision in force while they change nothing. */
  readonly draft?: OqasConfig;
  /** The number of the revision the draft was made from, which a change is saved on; 0 for none. */
  readonly basedOn: number;
  /** The errors the instance found in the draft, each where it is. */
  readonly errors: readonly ConfigError[];
  /** Where the person changed the draft since it was read, as JSON Pointers: the errors there are shown at once. */
  readonly touched?: readonly string[];
  /** Whether the person asked to save the draft since it was read: every error is shown then. */
  readonly tried?: boolean;
  /** Whether a change is on its way to the instance. */
  readonly saving: boolean;
  /** The revision the person saved last, which the screen tells. */
  readonly saved?: number;
  /** Why the instance refused what the person asked, in their words. */
  readonly refusal?: { readonly code: ProblemCode | "unreachable"; readonly text: string };
  /** Why the instance could not tell the configuration, when it answered so. */
  readonly unread?: string;
  /** Where the test repository stands, once the instance told it to a person who sets it up. */
  readonly repository?: RepositoryState;
  /** What setting the test repository up did, once the first configuration is saved; `undefined` before. */
  readonly preparation?: RepositoryPreparation;
  /** The latest test of the connection to the model; `undefined` before the person asked for one, and once they chose another connection. */
  readonly connection?: ConnectionTest;
  /** The variables the configuration in force names, and where the value of each comes from; `undefined` before the instance told them. */
  readonly secrets?: readonly SecretState[];
  /** The values the person typed for variables, by name, which are saved with the configuration. */
  readonly values: Readonly<Record<string, string>>;
  /** Whether the values the person typed last were saved, which the screen tells. */
  readonly valued?: boolean;
  /** The latest test of each knowledge source, by its rank in the draft; one made of a source since changed no longer holds. */
  readonly sourceChecks?: Readonly<Record<number, SourceTest>>;
}

/** A test of a knowledge source, under way or done. */
export interface SourceTest {
  /** The source of the draft when the test was asked for. */
  readonly source: Knowledge;
  /** What the test found; `undefined` while it runs, and when it could not be made. */
  readonly check?: SourceCheck;
  /** Why the test could not be made, in the words of the instance. */
  readonly failure?: string;
}

/** A test of the connection to the model, under way or done. */
export interface ConnectionTest {
  /** The section `model` of the draft when the test was asked for. */
  readonly model: Model;
  /** What the test found; `undefined` while it runs, and when it could not be made. */
  readonly check?: ModelConnectionCheck;
  /** Why the test could not be made, in the words of the instance. */
  readonly failure?: string;
}

/** What changes the state of the screen. */
export type ConfigurationAction =
  /** The person starts the configuration of an instance that has none, from a first draft. */
  | { readonly type: "begin"; readonly document: OqasConfig }
  /** The instance told where the test repository stands. */
  | { readonly type: "repository"; readonly repository: RepositoryState }
  /** The test repository was set up after the first configuration was saved. */
  | { readonly type: "prepared"; readonly preparation: RepositoryPreparation }
  /** The person chose how to reach the model: the GitHub account of the machine, a provider of the list, or another server. */
  | { readonly type: "connection"; readonly choice: string }
  /** The person asked for a test of the connection to the model. */
  | { readonly type: "testing"; readonly model: Model }
  /** The instance answered a test of the connection to the model, or could not make it. */
  | { readonly type: "tested"; readonly model: Model; readonly check?: ModelConnectionCheck; readonly failure?: string }
  /** The instance told the configuration and its revisions. */
  | { readonly type: "read"; readonly view: ConfigurationView; readonly revisions: readonly RevisionSummary[] }
  /** The instance could not tell them. */
  | { readonly type: "unread"; readonly message: string }
  /** The person set a field: `undefined` leaves it out. */
  | { readonly type: "edit"; readonly pointer: string; readonly value: unknown }
  /** The person checked or unchecked a member of a set, such as a level of the pyramid of tests, which holds its defaults when the draft leaves it out. */
  | { readonly type: "toggle"; readonly pointer: string; readonly member: string; readonly on: boolean; readonly defaults: readonly string[] }
  /** The person chose a level of autonomy, which keeps its guardrail. */
  | { readonly type: "level"; readonly level: Autonomy["level"] }
  /** The person added an item to a list. */
  | { readonly type: "add"; readonly pointer: string; readonly item: unknown }
  /** The person removed an item of a list. */
  | { readonly type: "remove"; readonly pointer: string }
  /** The person dropped their change. */
  | { readonly type: "discard" }
  /** The instance checked a draft. */
  | { readonly type: "checked"; readonly draft: OqasConfig; readonly errors: readonly ConfigError[] }
  /** A change left for the instance. */
  | { readonly type: "saving" }
  /** The instance took a change, or the file, as the revision in force. */
  | { readonly type: "saved"; readonly view: ConfigurationView }
  /** The instance listed the revisions. */
  | { readonly type: "listed"; readonly revisions: readonly RevisionSummary[] }
  /** The person asked for a test of a knowledge source. */
  | { readonly type: "sourceChecking"; readonly rank: number; readonly source: Knowledge }
  /** The instance answered a test of a knowledge source, or could not make it. */
  | { readonly type: "sourceChecked"; readonly rank: number; readonly source: Knowledge; readonly check?: SourceCheck; readonly failure?: string }
  /** The instance told the variables the configuration names. */
  | { readonly type: "secrets"; readonly secrets: readonly SecretState[] }
  /** The person typed the value of a variable: an empty one is not saved. */
  | { readonly type: "value"; readonly name: string; readonly value: string }
  /** The instance saved the values the person typed. */
  | { readonly type: "valued"; readonly secrets: readonly SecretState[] }
  /** The instance refused it. */
  | { readonly type: "refused"; readonly code: ProblemCode | "unreachable"; readonly text: string; readonly errors: readonly ConfigError[] };

/** The state of the screen before the instance told anything. */
export const INITIAL_CONFIGURATION: ConfigurationState = { errors: [], saving: false, basedOn: 0, values: {} };

/**
 * Tells whether the person changed the configuration since the instance last told it.
 *
 * @param state - The state of the screen.
 * @returns Whether the draft is not the document of the revision in force.
 */
export function isChanged(state: ConfigurationState): boolean {
  return state.draft !== state.view?.revision?.document;
}

/**
 * Tells whether the person has something to save: a change of the configuration, or values typed.
 *
 * @param state - The state of the screen.
 * @returns Whether saving would change something.
 */
export function isPending(state: ConfigurationState): boolean {
  return isChanged(state) || Object.keys(state.values).length > 0;
}

/**
 * @param model - The section `model` of the draft.
 * @param values - The values the person typed, by the name of their variable.
 * @returns The key typed for the variable of the model; `undefined` when none was.
 */
export function typedKey(model: Model, values: Readonly<Record<string, string>>): string | undefined {
  return model.mode === "provider-key" && model.apiKeyEnv !== undefined ? values[model.apiKeyEnv] : undefined;
}

/**
 * @param source - A knowledge source of the draft.
 * @param values - The values the person typed, by the name of their variable.
 * @returns The connection string typed for a database; `undefined` for any other source, and when none was typed.
 */
export function typedConnection(source: Knowledge, values: Readonly<Record<string, string>>): string | undefined {
  return source.type === "postgresql" ? values[source.connectionStringEnv] : undefined;
}

/** The autonomy of a level, with the guardrail the draft had: a bounded level starts bounded by thirty minutes a task. */
function autonomyOf(level: Autonomy["level"], draft: OqasConfig): Autonomy {
  const guardrail = valueAt(draft, "/autonomy/guardrailMinutes");
  const kept = typeof guardrail === "number" ? { guardrailMinutes: guardrail } : {};
  return level === "bounded" ? { level, task: { maxMinutes: 30 }, ...kept } : { level, ...kept };
}

/** The state once the draft changed: what the instance found in the draft before no longer holds. */
function edited(state: ConfigurationState, change: (draft: OqasConfig) => OqasConfig, at?: string): ConfigurationState {
  if (state.draft === undefined) return state;
  const { saved: _, refusal: __, ...rest } = state;
  return { ...rest, draft: change(state.draft), ...(at === undefined ? {} : { touched: [...(state.touched ?? []), at] }) };
}

/**
 * The errors the screen shows: every error once the person asked to save; before, those of what they changed alone, so
 * that an item they add is not shown wrong before they filled it.
 *
 * @param state - The state of the screen.
 * @returns The errors to show, each where it is.
 */
export function shownErrors(state: ConfigurationState): readonly ConfigError[] {
  if (state.tried === true) return state.errors;
  const touched = state.touched ?? [];
  return state.errors.filter(({ path }) => touched.some((at) => path === at || path.startsWith(`${at}/`)));
}

/** The list an item is in: the errors of a list, such as too few items, follow the removal of one of them. */
const listOf = (pointer: string): string => pointer.slice(0, pointer.lastIndexOf("/"));

/**
 * Gives the state of the screen after an action.
 *
 * @param state - The state before.
 * @param action - What happened.
 * @returns The state after.
 */
export function configurationAfter(state: ConfigurationState, action: ConfigurationAction): ConfigurationState {
  switch (action.type) {
    case "read": {
      const { unread: _, ...rest } = state;
      // A person who is changing the configuration keeps their draft, made from the revision they read: a change saved on another is refused.
      if (isChanged(state)) return { ...rest, view: action.view, revisions: action.revisions };
      const { revision } = action.view;
      return {
        ...rest,
        view: action.view,
        revisions: action.revisions,
        basedOn: revision?.number ?? 0,
        ...(revision === undefined ? {} : { draft: revision.document }),
      };
    }
    case "unread":
      return { ...state, unread: action.message };
    case "begin":
      return state.draft === undefined && state.view?.revision === undefined ? { ...state, draft: action.document, basedOn: 0 } : state;
    case "repository":
      return { ...state, repository: action.repository };
    case "prepared":
      return { ...state, preparation: action.preparation };
    case "connection": {
      const { connection: _, ...rest } = state;
      return edited(rest, (draft) => changedAt(draft, "/model", modelFor(action.choice, draft.model)), "/model");
    }
    case "testing":
      return { ...state, connection: { model: action.model } };
    case "tested":
      if (state.connection?.model !== action.model) return state;
      return {
        ...state,
        connection: {
          model: action.model,
          ...(action.check === undefined ? {} : { check: action.check }),
          ...(action.failure === undefined ? {} : { failure: action.failure }),
        },
      };
    case "edit":
      // The identifiers and the variables made of what the person changes follow it while they did not set them.
      return edited(
        state,
        (draft) => withFollowers(draft, changedAt(draft, action.pointer, action.value), action.pointer, state.view?.revision?.document),
        action.pointer,
      );
    case "toggle":
      return edited(
        state,
        (draft) => {
          const members = valueAt(draft, action.pointer);
          const kept = (Array.isArray(members) ? (members as string[]) : action.defaults).filter((member) => member !== action.member);
          return changedAt(draft, action.pointer, action.on ? [...kept, action.member] : kept);
        },
        action.pointer,
      );
    case "level":
      return edited(state, (draft) => changedAt(draft, "/autonomy", autonomyOf(action.level, draft)), "/autonomy");
    case "add":
      return edited(state, (draft) => appendedAt(draft, action.pointer, action.item));
    case "remove":
      return edited(state, (draft) => removedAt(draft, action.pointer), listOf(action.pointer));
    case "discard": {
      const { refusal: _, saved: __, draft: ___, touched: ____, tried: _____, ...rest } = state;
      const revision = state.view?.revision;
      return { ...rest, errors: [], values: {}, basedOn: revision?.number ?? 0, ...(revision === undefined ? {} : { draft: revision.document }) };
    }
    case "checked":
      return action.draft === state.draft ? { ...state, errors: action.errors } : state;
    case "saving": {
      const { refusal: _, valued: __, ...rest } = state;
      return { ...rest, saving: true, tried: true };
    }
    case "saved": {
      const { refusal: _, touched: __, tried: ___, ...rest } = state;
      const { revision } = action.view;
      return {
        ...rest,
        view: action.view,
        errors: [],
        saving: false,
        ...(revision === undefined ? {} : { draft: revision.document, basedOn: revision.number, saved: revision.number }),
      };
    }
    case "listed":
      return { ...state, revisions: action.revisions };
    case "secrets":
      return { ...state, secrets: action.secrets };
    case "sourceChecking":
      return { ...state, sourceChecks: { ...state.sourceChecks, [action.rank]: { source: action.source } } };
    case "sourceChecked": {
      if (state.sourceChecks?.[action.rank]?.source !== action.source) return state;
      const { type: _, rank, ...test } = action;
      return { ...state, sourceChecks: { ...state.sourceChecks, [rank]: test } };
    }
    case "value": {
      const { [action.name]: _, ...others } = state.values;
      const { valued: __, ...rest } = state;
      return { ...rest, values: action.value === "" ? others : { ...others, [action.name]: action.value } };
    }
    case "valued": {
      const { refusal: _, ...rest } = state;
      return { ...rest, secrets: action.secrets, values: {}, saving: false, valued: true };
    }
    case "refused":
      return { ...state, saving: false, refusal: { code: action.code, text: action.text }, errors: action.errors.length > 0 ? action.errors : state.errors };
  }
}
