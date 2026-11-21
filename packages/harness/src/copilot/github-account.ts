import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CopilotClient, type GetAuthStatusResponse, type ModelInfo } from "@github/copilot-sdk";
import type { ModelChoice, ModelConnectionCheck } from "@open-qa-stack/domain";
import { runtimeEnvironment } from "./runtime-environment.ts";

/** What the check of a GitHub account needs of the SDK: who is signed in, and the models Copilot offers them. */
export interface CopilotAccountClient {
  start(): Promise<void>;
  getAuthStatus(): Promise<GetAuthStatusResponse>;
  listModels(): Promise<ModelInfo[]>;
  stop(): Promise<unknown>;
}

/**
 * The client of the SDK that checks the GitHub account of the machine: it signs in as the GitHub CLI or the Copilot
 * CLI did, keeps its state in a folder of its own, and gets the few variables of the environment it needs.
 *
 * @param env - The environment of the process.
 * @returns A function that makes the client in a folder; nothing starts until the client is started.
 */
export function copilotAccountClient(env: Readonly<Record<string, string | undefined>>): (home: string) => CopilotAccountClient {
  return (home) => new CopilotClient({ useLoggedInUser: true, baseDirectory: home, logLevel: "error", env: runtimeEnvironment(env) });
}

/**
 * Checks the connection to GitHub Copilot through the account the machine signed in with, through the GitHub CLI
 * or the Copilot CLI: who is signed in, and the models Copilot offers that account. No token is read here: the SDK
 * finds the account itself.
 *
 * @param env - The environment of the process, of which the SDK gets the few variables it needs.
 * @param client - Makes the client of the SDK, in a folder of its own; the client of the SDK by default.
 * @returns `connected` with the account and its models, `no-models` for an account Copilot offers none, or
 * `signed-out` when no account is signed in.
 */
export async function checkGitHubAccount(
  env: Readonly<Record<string, string | undefined>>,
  client: (home: string) => CopilotAccountClient = copilotAccountClient(env),
): Promise<ModelConnectionCheck> {
  const home = await mkdtemp(join(tmpdir(), "oqas-github-"));
  const sdk = client(home);
  try {
    await sdk.start();
    const auth = await sdk.getAuthStatus();
    if (!auth.isAuthenticated || auth.login === undefined) return { state: "signed-out" };
    const models = (await sdk.listModels()).filter((model) => model.policy?.state !== "disabled").map(choiceOf);
    return models.length === 0 ? { state: "no-models", account: auth.login } : { state: "connected", account: auth.login, models };
  } finally {
    await sdk.stop();
    await rm(home, { recursive: true, force: true });
  }
}

/** A model of Copilot as the person chooses it. */
function choiceOf(model: ModelInfo): ModelChoice {
  return { id: model.id, name: model.name, vision: model.capabilities.supports.vision, reasoningEfforts: model.supportedReasoningEfforts ?? [] };
}
