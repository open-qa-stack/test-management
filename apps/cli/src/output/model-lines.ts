import { ExitCode, MODEL_PROVIDERS, providerOf, type ExitCodeValue, type Model, type ModelConnectionCheck } from "@open-qa-stack/domain";
import type { ModelArguments } from "../arguments/command.ts";
import { UsageError } from "../errors/usage-error.ts";

/** What `oqas model` tells of a connection: its lines, what a program reads, and its exit code. */
export interface ModelReport {
  readonly text: string;
  readonly value: { readonly model: Model; readonly check: ModelConnectionCheck; readonly offered?: boolean };
  readonly code: ExitCodeValue;
}

/**
 * The connection to the model `oqas model set` was given.
 *
 * @param given - The options of the command.
 * @returns The section `model` it sets: the GitHub account; a provider of the list, by its name whatever its case, with
 * its address and the variable of its key unless another is named; or another server, by its address.
 * @throws `UsageError` when the provider is neither a name of the list nor the address of a server.
 */
export function modelOfArguments(given: ModelArguments): Model {
  if (given.github) return { mode: "github", model: given.model };
  const { provider, keyEnv, model } = given;
  const named =
    MODEL_PROVIDERS.find(({ name }) => name.toLowerCase() === provider.toLowerCase()) ?? (URL.canParse(provider) ? providerOf(provider) : undefined);
  if (named !== undefined) return { mode: "provider-key", provider: "openai", baseUrl: named.baseUrl, model, apiKeyEnv: keyEnv ?? named.apiKeyEnv };
  if (!URL.canParse(provider))
    throw new UsageError(
      `${provider} is no provider oqas knows nor the address of a server: name one of ${MODEL_PROVIDERS.map(({ name }) => name).join(", ")}, or give the address of an OpenAI-compatible server.`,
    );
  return { mode: "provider-key", provider: "openai", baseUrl: provider, model, ...(keyEnv === undefined ? {} : { apiKeyEnv: keyEnv }) };
}

/**
 * The connection to set, with what an expert tuned on the one in force kept when it names the same model the same
 * way: whether it reads images, its effort of reasoning and, for a provider key, its wait for an answer.
 *
 * @param given - The connection the command was given.
 * @param inForce - The connection in force.
 * @returns The connection given, with the tuning of the one in force when both are of the same mode and name the same model.
 */
export function keptTuning(given: Model, inForce: Model): Model {
  if (given.mode !== inForce.mode || given.model !== inForce.model) return given;
  const { capabilities, reasoningEffort } = inForce;
  const tuned = { ...given, ...(capabilities === undefined ? {} : { capabilities }), ...(reasoningEffort === undefined ? {} : { reasoningEffort }) };
  if (tuned.mode === "github" || inForce.mode === "github" || inForce.requestTimeoutSeconds === undefined) return tuned;
  return { ...tuned, requestTimeoutSeconds: inForce.requestTimeoutSeconds };
}

/**
 * What a test of the connection to the model found, as `oqas model` tells it.
 *
 * @param model - The connection tested.
 * @param check - What the test found.
 * @returns The lines a person reads — how the model is reached, what answered or what to do, the models offered — what
 * a program reads, and `0` when the model answers and is among those offered, or when the server lists none; `4` otherwise.
 */
export function modelReport(model: Model, check: ModelConnectionCheck): ModelReport {
  const offered = check.state === "connected" && check.models !== undefined ? check.models.some(({ id }) => id === model.model) : undefined;
  const lines = [`${reachOf(model)}, model ${model.model}.`, stateLine(check), ...modelsLines(model, check, offered)];
  const answers = check.state === "connected" && offered !== false;
  return {
    text: lines.join("\n"),
    value: { model, check, ...(offered === undefined ? {} : { offered }) },
    code: answers ? ExitCode.passed : ExitCode.prerequisite,
  };
}

/** How the model is reached, in a few words. */
function reachOf(model: Model): string {
  if (model.mode === "github") return "The GitHub account of this machine (GitHub Copilot)";
  const name = providerOf(model.baseUrl)?.name ?? model.baseUrl;
  return model.apiKeyEnv === undefined ? name : `${name}, its key in ${model.apiKeyEnv}`;
}

/** What the test found, and what to do when the model does not answer. */
function stateLine(check: ModelConnectionCheck): string {
  switch (check.state) {
    case "connected":
      return check.account === undefined ? "The model answers." : `The model answers, through the GitHub account ${check.account}.`;
    case "signed-out":
      return "No GitHub account is signed in on this machine: run gh auth login, then oqas model status.";
    case "no-models":
      return `The GitHub account ${check.account} is signed in, but GitHub Copilot offers it no model: the account needs a Copilot subscription, or its organisation must allow one.`;
    case "key-missing":
      return `${check.variable} holds no key: give it with oqas secrets set ${check.variable}, or set the variable, then run oqas model status again.`;
    case "key-refused":
      return `The server refused the key, with status ${check.status}: check the key the variable holds.`;
    case "unreachable":
      return `Nothing answers at ${check.url}: check the address, or that the server runs.`;
  }
}

/** The models the connection offers, and whether the one in force is among them. */
function modelsLines(model: Model, check: ModelConnectionCheck, offered: boolean | undefined): string[] {
  if (check.state !== "connected") return [];
  if (check.models === undefined) return ["The server does not list its models."];
  const listed = check.models.map(({ id, name }) => `  ${id}${name === id ? "" : ` — ${name}`}`);
  const verdict = offered === true ? `${model.model} is among them.` : `${model.model} is not among them: set one of them with oqas model set.`;
  return [`${check.models.length === 1 ? "1 model is" : `${check.models.length} models are`} offered:`, ...listed, verdict];
}
