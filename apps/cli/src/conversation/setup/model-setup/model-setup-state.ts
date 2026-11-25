import { ENV_VAR_PATTERN, MODEL_PROVIDERS, providerOf, type Model, type ModelConnectionCheck } from "@open-qa-stack/domain";
import { keptTuning } from "../../../output/model-lines.ts";

/** The choice of the GitHub account of the machine, first of the list of the connections. */
export const GITHUB = "github";

/** The choice of a server the list does not name, last of the list. */
export const OTHER = "other";

/** The connections offered, in their order: the GitHub account of the machine, the providers by name, another server. */
export const CONNECTIONS: readonly string[] = [GITHUB, ...MODEL_PROVIDERS.map(({ name }) => name), OTHER];

/**
 * Where the setting of the connection to the model stands.
 *
 * - `connection`: the person chooses how to reach the model, in `CONNECTIONS`.
 * - `address`: they type the address of another server.
 * - `key`: they type the variable that holds the key of a provider.
 * - `testing`: the connection is tested.
 * - `model`: they choose the model among those the connection offers.
 * - `name`: they type the name of the model, the server listing none.
 * - `failed`: the model does not answer; they test again, or choose another connection.
 * - `saving`: the connection is recorded.
 * - `saved`: it is; the setting ends.
 */
export type SetupStep = "connection" | "address" | "key" | "secret" | "testing" | "model" | "name" | "failed" | "saving" | "saved";

/** The setting of the connection to the model, as it stands. */
export interface SetupState {
  readonly step: SetupStep;
  /** The connection in force when the setting started, whose tuning is kept for the same model. */
  readonly inForce: Model;
  /** The connection as it is set so far. */
  readonly draft: Model;
  /** The line chosen in the list of the step. */
  readonly selected: number;
  /** What is typed in the field of the step. */
  readonly text: string;
  /** What the latest test found. */
  readonly check?: ModelConnectionCheck;
  /** Why what was typed is refused, until it is typed again. */
  readonly refusal?: "address" | "variable" | "secret" | "name";
  /** The variable of the key to offer once the address of another server is typed. */
  readonly pendingKey?: string;
  /** The key the person typed for a variable that holds none, saved with the connection. */
  readonly typedKey?: string;
}

/** What happens to the setting. */
export type SetupAction =
  /** The person moved in a list. */
  | { readonly type: "moved"; readonly by: number }
  /** They pressed Enter on a list. */
  | { readonly type: "chosen" }
  /** They typed in a field. */
  | { readonly type: "typed"; readonly text: string }
  /** They pressed Enter in a field. */
  | { readonly type: "entered" }
  /** The test of the connection found something. */
  | { readonly type: "tested"; readonly check: ModelConnectionCheck }
  /** The connection was recorded. */
  | { readonly type: "saved" };

/** What a failed test offers: to test again, or to choose another connection. */
export const AFTER_FAILURE = ["retry", "change"] as const;

/**
 * The setting as it starts: the list of the connections, on the one in force.
 *
 * @param inForce - The connection in force.
 * @returns The first step.
 */
export function setupStart(inForce: Model): SetupState {
  const current = inForce.mode === "github" ? GITHUB : (providerOf(inForce.baseUrl)?.name ?? OTHER);
  return { step: "connection", inForce, draft: inForce, selected: CONNECTIONS.indexOf(current), text: "" };
}

/**
 * The models the latest test offers.
 *
 * @param state - The setting.
 * @returns The models, or none when the test found none.
 */
export function offeredModels(state: SetupState): readonly { readonly id: string; readonly name: string }[] {
  return state.check?.state === "connected" ? (state.check.models ?? []) : [];
}

/** How many lines the list of a step has. */
function lengthOf(state: SetupState): number {
  if (state.step === "connection") return CONNECTIONS.length;
  if (state.step === "model") return offeredModels(state).length;
  return state.step === "failed" ? AFTER_FAILURE.length : 0;
}

/** The step once a connection is chosen in the list. */
function connectionChosen(chosen: SetupState): SetupState {
  // A key typed for another connection is not this one's.
  const { typedKey: _, ...state } = chosen;
  const { inForce } = state;
  const choice = CONNECTIONS[state.selected]!;
  if (choice === GITHUB) return testing(state, { mode: "github", model: inForce.mode === "github" ? inForce.model : "" });
  const provider = MODEL_PROVIDERS.find(({ name }) => name === choice);
  const sameServer =
    inForce.mode === "provider-key" && (provider === undefined ? providerOf(inForce.baseUrl) === undefined : inForce.baseUrl === provider.baseUrl);
  const draft: Model = {
    mode: "provider-key",
    provider: "openai",
    baseUrl: provider?.baseUrl ?? (sameServer ? inForce.baseUrl : ""),
    model: sameServer ? inForce.model : "",
  };
  const key = sameServer && inForce.apiKeyEnv !== undefined ? inForce.apiKeyEnv : (provider?.apiKeyEnv ?? "");
  if (provider === undefined)
    return { ...without(state), step: "address", draft, text: draft.baseUrl, selected: 0, ...(key === "" ? {} : { pendingKey: key }) };
  return { ...without(state), step: "key", draft, text: key, selected: 0 };
}

/** The state without what a step left: the refusal, the check, the variable kept aside. */
function without(state: SetupState): SetupState {
  const { refusal: _, check: __, pendingKey: ___, ...kept } = state;
  return kept;
}

/** The step that tests a connection. */
function testing(state: SetupState, draft: Model): SetupState {
  return { ...without(state), step: "testing", draft, selected: 0, text: "" };
}

/** The step once a text is entered in its field. */
function enteredText(state: SetupState): SetupState {
  const text = state.text.trim();
  const { draft } = state;
  if (draft.mode === "github") return state.step === "name" ? named(state, text) : state;
  switch (state.step) {
    case "address": {
      if (!URL.canParse(text) || !/^https?:$/.test(new URL(text).protocol)) return { ...state, refusal: "address" };
      return { ...without(state), step: "key", draft: { ...draft, baseUrl: text }, text: state.pendingKey ?? "" };
    }
    case "key": {
      if (text !== "" && !new RegExp(ENV_VAR_PATTERN).test(text)) return { ...state, refusal: "variable" };
      const { apiKeyEnv: _, ...keyless } = draft;
      return testing(state, text === "" ? keyless : { ...keyless, apiKeyEnv: text });
    }
    case "secret":
      if (text === "") return { ...state, refusal: "secret" };
      return { ...testing(state, draft), typedKey: text };
    case "name":
      return named(state, text);
    default:
      return state;
  }
}

/** The step once the name of the model is typed. */
function named(state: SetupState, text: string): SetupState {
  if (text === "") return { ...state, refusal: "name" };
  return { ...without(state), step: "saving", draft: keptTuning({ ...state.draft, model: text }, state.inForce), text: "" };
}

/** The step once the test found something: the models to choose from, the name to type, or what to do. */
function tested(state: SetupState, check: ModelConnectionCheck): SetupState {
  // A variable that holds no key asks for the key itself, saved on this machine with the connection.
  if (check.state === "key-missing") return { ...state, step: "secret", check, text: "" };
  if (check.state !== "connected") return { ...state, step: "failed", check, selected: 0 };
  if (check.models === undefined) return { ...state, step: "name", check, text: state.draft.model };
  const chosen = check.models.findIndex(({ id }) => id === state.draft.model);
  return { ...state, step: "model", check, selected: Math.max(chosen, 0) };
}

/**
 * Gives the setting after something happened. It calls nothing: whoever shows it tests the connection while the
 * step is `testing`, records it while it is `saving`, and comes back with what they found.
 *
 * @param state - The setting.
 * @param action - What happened.
 * @returns The setting after it.
 */
export function setupAfter(state: SetupState, action: SetupAction): SetupState {
  switch (action.type) {
    case "moved": {
      const length = lengthOf(state);
      return length === 0 ? state : { ...state, selected: (state.selected + action.by + length) % length };
    }
    case "chosen":
      if (state.step === "connection") return connectionChosen(state);
      if (state.step === "model") return named(state, offeredModels(state)[state.selected]!.id);
      if (state.step === "failed") return AFTER_FAILURE[state.selected] === "retry" ? testing(state, state.draft) : setupStart(state.inForce);
      return state;
    case "typed": {
      const { refusal: _, ...rest } = state;
      return { ...rest, text: action.text };
    }
    case "entered":
      return enteredText(state);
    case "tested":
      return state.step === "testing" ? tested(state, action.check) : state;
    case "saved":
      return state.step === "saving" ? { ...state, step: "saved" } : state;
  }
}
