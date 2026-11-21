/** A model a connection offers: its identifier, the name to show, and what it can do. */
export interface ModelChoice {
  /** The identifier the configuration names. */
  readonly id: string;
  /** The name to show the person. */
  readonly name: string;
  /** Whether it reads images; `undefined` when the connection does not tell. */
  readonly vision?: boolean;
  /** The efforts of reasoning it accepts, in the words of its server; empty when the connection tells none. */
  readonly reasoningEfforts: readonly string[];
}

/**
 * What a test of the connection to the model found.
 *
 * - `connected`: the model answers. `account` is the GitHub account, for a connection through it. `models` is
 *   what the connection offers; `undefined` when the server gives no list, and the person names the model.
 * - `signed-out`: no GitHub account is signed in on the machine that runs the product.
 * - `no-models`: the GitHub account is signed in, and Copilot offers it no model: it has no Copilot subscription,
 *   or its organisation allows it none.
 * - `key-missing`: the variable that holds the key is not set where the product runs.
 * - `key-refused`: the server refused the key, with its HTTP status.
 * - `unreachable`: nothing answers at the address of the server.
 */
export type ModelConnectionCheck =
  | { readonly state: "connected"; readonly account?: string; readonly models?: readonly ModelChoice[] }
  | { readonly state: "signed-out" }
  | { readonly state: "no-models"; readonly account: string }
  | { readonly state: "key-missing"; readonly variable: string }
  | { readonly state: "key-refused"; readonly status: number }
  | { readonly state: "unreachable"; readonly url: string };
