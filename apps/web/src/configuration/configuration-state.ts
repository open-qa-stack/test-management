import type {
  Autonomy,
  ConfigError,
  ConfigurationView,
  Model,
  ModelConnectionCheck,
  OqasConfig,
  ProblemCode,
  RevisionSummary,
} from "@open-qa-stack/domain/sessions";
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
  /** Whether a change is on its way to the instance. */
  readonly saving: boolean;
  /** The revision the person saved last, which the screen tells. */
  readonly saved?: number;
  /** Why the instance refused what the person asked, in their words. */
  readonly refusal?: { readonly code: ProblemCode | "unreachable"; readonly text: string };
  /** Why the instance could not tell the configuration, when it answered so. */
  readonly unread?: string;
  /** The latest test of the connection to the model; `undefined` before the person asked for one, and once they chose another connection. */
  readonly connection?: ConnectionTest;
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
  /** The instance refused it. */
  | { readonly type: "refused"; readonly code: ProblemCode | "unreachable"; readonly text: string; readonly errors: readonly ConfigError[] };

/** The state of the screen before the instance told anything. */
export const INITIAL_CONFIGURATION: ConfigurationState = { errors: [], saving: false, basedOn: 0 };

/**
 * Tells whether the person changed the configuration since the instance last told it.
 *
 * @param state - The state of the screen.
 * @returns Whether the draft is not the document of the revision in force.
 */
export function isChanged(state: ConfigurationState): boolean {
  return state.draft !== state.view?.revision?.document;
}

/** The autonomy of a level, with the guardrail the draft had: a bounded level starts bounded by thirty minutes a task. */
function autonomyOf(level: Autonomy["level"], draft: OqasConfig): Autonomy {
  const guardrail = valueAt(draft, "/autonomy/guardrailMinutes");
  const kept = typeof guardrail === "number" ? { guardrailMinutes: guardrail } : {};
  return level === "bounded" ? { level, task: { maxMinutes: 30 }, ...kept } : { level, ...kept };
}

/** The state once the draft changed: what the instance found in the draft before no longer holds. */
function edited(state: ConfigurationState, change: (draft: OqasConfig) => OqasConfig): ConfigurationState {
  if (state.draft === undefined) return state;
  const { saved: _, refusal: __, ...rest } = state;
  return { ...rest, draft: change(state.draft) };
}

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
    case "connection": {
      const { connection: _, ...rest } = state;
      return edited(rest, (draft) => changedAt(draft, "/model", modelFor(action.choice, draft.model)));
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
      return edited(state, (draft) => changedAt(draft, action.pointer, action.value));
    case "toggle":
      return edited(state, (draft) => {
        const members = valueAt(draft, action.pointer);
        const kept = (Array.isArray(members) ? (members as string[]) : action.defaults).filter((member) => member !== action.member);
        return changedAt(draft, action.pointer, action.on ? [...kept, action.member] : kept);
      });
    case "level":
      return edited(state, (draft) => changedAt(draft, "/autonomy", autonomyOf(action.level, draft)));
    case "add":
      return edited(state, (draft) => appendedAt(draft, action.pointer, action.item));
    case "remove":
      return edited(state, (draft) => removedAt(draft, action.pointer));
    case "discard": {
      const { refusal: _, saved: __, draft: ___, ...rest } = state;
      const revision = state.view?.revision;
      return { ...rest, errors: [], basedOn: revision?.number ?? 0, ...(revision === undefined ? {} : { draft: revision.document }) };
    }
    case "checked":
      return action.draft === state.draft ? { ...state, errors: action.errors } : state;
    case "saving": {
      const { refusal: _, ...rest } = state;
      return { ...rest, saving: true };
    }
    case "saved": {
      const { refusal: _, ...rest } = state;
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
    case "refused":
      return { ...state, saving: false, refusal: { code: action.code, text: action.text }, errors: action.errors.length > 0 ? action.errors : state.errors };
  }
}
