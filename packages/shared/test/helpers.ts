import { readFileSync } from "node:fs";
import { CONFIG_FILE_NAME, validateConfig, type ConfigError, type EnvironmentVariables, type ValidationResult } from "../src/index.ts";

export const EXAMPLE_FILE = new URL(`../examples/lakeside-mutual/${CONFIG_FILE_NAME}`, import.meta.url);

/** Values for every variable the example references; they are test values, never real secrets. */
export const EXAMPLE_ENV: EnvironmentVariables = {
  CSS_DEMO_USERNAME: "demo-user",
  CSS_DEMO_PASSWORD: "demo-password-value",
  CUSTOMER_CORE_DB_URL: "postgresql://user:secret@localhost:5433/customercore",
  CUSTOMER_SELF_SERVICE_DB_URL: "postgresql://user:secret@localhost:5433/customerselfservice",
  CUSTOMER_MANAGEMENT_DB_URL: "postgresql://user:secret@localhost:5433/customermanagement",
  POLICY_MANAGEMENT_DB_URL: "postgresql://user:secret@localhost:5433/policymanagement",
  OQAS_MODEL_API_KEY: "test-model-key-value",
};

export type JsonObject = Record<string, unknown>;

export function exampleText(): string {
  return readFileSync(EXAMPLE_FILE, "utf8");
}

export function example(): JsonObject {
  return JSON.parse(exampleText()) as JsonObject;
}

/** The object found by following `path` (keys and array indexes separated by slashes) from `root`. */
export function at(root: JsonObject, path: string): JsonObject {
  let current: unknown = root;
  for (const segment of path.split("/")) {
    current = (current as JsonObject)[segment];
  }
  return current as JsonObject;
}

/** The array found by following `path` from `root`. */
export function listAt(root: JsonObject, path: string): unknown[] {
  return at(root, path) as unknown as unknown[];
}

/** Validates a variant of the example produced by `change`, with the example environment unless another is given. */
export function validateVariant(change: (config: JsonObject) => void, env: EnvironmentVariables = EXAMPLE_ENV): ValidationResult {
  const config = example();
  change(config);
  return validateConfig(JSON.stringify(config), env);
}

export function errorsOf(result: ValidationResult): ConfigError[] {
  if (result.ok) throw new Error("expected the configuration to be refused");
  return result.errors;
}
