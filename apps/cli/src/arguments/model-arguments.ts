import type { Command, ModelArguments } from "./command.ts";

/** The options of the connection to the model, as they were given. */
export interface ConnectionOptions {
  readonly github: boolean;
  readonly provider: string | undefined;
  readonly keyEnv: string | undefined;
  readonly model: string | undefined;
}

/** What `oqas model` asks for, or why it is refused: a test of the connection in force, or a connection to set, and nothing of a session. */
export function modelOf(
  words: readonly string[],
  ofASession: boolean,
  { github, provider, keyEnv, model }: ConnectionOptions,
  asks: boolean,
): Command | string {
  const [action, ...rest] = words;
  if (ofASession) return "oqas model acts on the connection to the model: it takes no --brief, --environment nor --follow.";
  if (action === undefined && asks) return { name: "model", action: "setup" };
  if (action === undefined)
    return "oqas model alone sets the connection step by step, in a terminal: with --no-input or --output, give status, or set with its options; see oqas --help.";
  if (rest.length > 0 || (action !== "status" && action !== "set")) return "oqas model takes status or set.";
  if (action === "status") return { name: "model", action };
  if (github === (provider !== undefined))
    return "oqas model set takes --github, for the GitHub account of this machine, or --provider with the name of a provider or the address of its server.";
  if (github && keyEnv !== undefined) return "--key-env names the variable of the key of a provider: the GitHub account takes none.";
  if (model === undefined) return "oqas model set needs --model, the model to use: oqas model status lists those the connection offers.";
  const connection: ModelArguments = github ? { github, model } : { github, provider: provider!, model, ...(keyEnv === undefined ? {} : { keyEnv }) };
  return { name: "model", action, connection };
}
