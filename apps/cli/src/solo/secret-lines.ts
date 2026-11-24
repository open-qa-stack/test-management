import type { SecretState } from "@open-qa-stack/domain";

/** What each kind of variable holds, in the words of a line. */
const HELD = {
  model_key: "the key of the model",
  connection_string: "a connection string",
  account_username: "the name of a test account",
  account_password: "the password of a test account",
} as const;

/** Where the value of a variable comes from, in the words of a line. */
const FROM = { environment: "set in the environment", saved: "saved on this machine", missing: "missing" } as const;

/**
 * @param secret - A variable the configuration names.
 * @returns The line `oqas secrets` prints of it: its name, what it holds, and where its value comes from.
 */
export function secretLine({ name, kind, source }: SecretState): string {
  return `${name}  ${HELD[kind]}, ${FROM[source]}`;
}

/** What `oqas secrets` prints after the list when a value is missing: how to give it. */
export const MISSING_ADVICE = "Give a missing value with oqas secrets set <variable>, or in the console (oqas --ui), or set the variable in the environment.";
