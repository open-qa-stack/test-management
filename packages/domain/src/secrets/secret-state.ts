/** What a variable named by the configuration holds: the key of the model, the connection string of a database, the name or the password of a test account. */
export type SecretKind = "model_key" | "connection_string" | "account_username" | "account_password";

/**
 * Where the value of a variable comes from: the environment of the process, which wins, as in a CI; the value
 * saved on this machine, out of the test repository; or nowhere yet.
 */
export type SecretSource = "environment" | "saved" | "missing";

/** A variable the configuration in force names, and where its value comes from. Its value is never given. */
export interface SecretState {
  /** The name of the variable. */
  readonly name: string;
  /** What it holds; the first of the keys that name it decides. */
  readonly kind: SecretKind;
  /** JSON Pointers to the keys of the configuration that name it, in the order of the file. */
  readonly paths: readonly string[];
  /** Where its value comes from. */
  readonly source: SecretSource;
}

/** The variables the configuration in force names, as `GET /secrets` answers them. */
export interface SecretList {
  /** Each variable once, in the order of the file; none without a configuration. */
  readonly secrets: readonly SecretState[];
}
