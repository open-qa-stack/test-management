import { posix } from "node:path";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { resolveLimits } from "./autonomy.ts";
import { duplicateKeyPaths } from "./duplicate-keys.ts";
import { configError as error, pointer, structureError } from "./errors.ts";
import { STATE_DIR_NAME } from "./file-names.ts";
import { configSchema } from "./schema.ts";
import type { Attachment, ConfigError, OqasConfig, Repository, ValidationResult } from "./types.ts";

/** Environment the configuration is validated against, usually `process.env`. */
export type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

/** Repository layout used for every key the file leaves out. */
export const DEFAULT_REPOSITORY: Readonly<Required<Repository>> = Object.freeze({
  appsDir: "apps",
  blocksDir: "blocs",
  journeysDir: "parcours",
  stateDir: STATE_DIR_NAME,
  indexDir: `${STATE_DIR_NAME}/index`,
});

// `strictRequired` is relaxed because the OpenAPI source alternatives require keys that only their
// enclosing branch defines.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, discriminator: true });
const validateShape = ajv.compile<OqasConfig>(configSchema);

/** Errors raised inside the alternatives of the OpenAPI source are summarised by their parent `oneOf`. */
const NESTED_ALTERNATIVE = /\/oneOf\/\d+\/oneOf\/\d+\//;

/**
 * Validates the content of a configuration file against the schema, then against the rules that span
 * the document and the environment.
 *
 * @remarks
 * Pure: no file, network, database or model access. Messages never repeat the value of an environment
 * variable or a value read from the file; they may name a key the schema defines or an environment
 * variable the file references.
 *
 * @param content - The content of the configuration file.
 * @param env - The environment the referenced variables are read from.
 * @returns The resolved configuration, or every error found.
 */
export function validateConfig(content: string, env: EnvironmentVariables): ValidationResult {
  const text = content.startsWith("\uFEFF") ? content.slice(1) : content;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: [error("syntax", "", "json", "The file is not valid JSON.")] };
  }

  const duplicates = duplicateKeyPaths(text);
  if (duplicates.length > 0) {
    return { ok: false, errors: duplicates.map((path) => error("structure", path, "duplicate-key", "Duplicate key.")) };
  }

  if (!validateShape(data)) {
    // Ajv always sets `errors` when validation fails.
    const raw = validateShape.errors as ErrorObject[];
    return { ok: false, errors: raw.filter((e) => !NESTED_ALTERNATIVE.test(e.schemaPath)).map(structureError) };
  }

  const errors = [...documentErrors(data), ...environmentErrors(data, env)];
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    config: {
      formatVersion: data.formatVersion,
      applications: data.applications,
      knowledge: data.knowledge,
      repository: { ...DEFAULT_REPOSITORY, ...data.repository },
      model: data.model,
      autonomy: { level: data.autonomy.level, limits: resolveLimits(data.autonomy) },
    },
  };
}

function documentErrors(config: OqasConfig): ConfigError[] {
  const errors: ConfigError[] = [];
  const duplicate = (path: string, what: string) =>
    errors.push(error("structure", path, "duplicate", `Duplicate ${what}.`));

  const appIds = new Set<string>();
  config.applications.forEach((app, i) => {
    const appPath = pointer("/applications", i);
    if (appIds.has(app.id)) duplicate(pointer(appPath, "id"), "application id");
    appIds.add(app.id);

    const envNames = new Set<string>();
    app.environments.forEach((environment, j) => {
      const envPath = pointer(pointer(appPath, "environments"), j);
      if (envNames.has(environment.name)) duplicate(pointer(envPath, "name"), "environment name");
      envNames.add(environment.name);

      if (environment.uiUrl === undefined) {
        if (app.type !== "api") {
          errors.push(
            error("structure", pointer(envPath, "uiUrl"), "ui-url-required", "A web application needs a user interface URL."),
          );
        }
      } else {
        errors.push(...urlErrors(pointer(envPath, "uiUrl"), environment.uiUrl));
      }

      const apiNames = new Set<string>();
      (environment.apis ?? []).forEach((api, k) => {
        const apiPath = pointer(pointer(envPath, "apis"), k);
        if (apiNames.has(api.name)) duplicate(pointer(apiPath, "name"), "API name");
        apiNames.add(api.name);
        errors.push(...urlErrors(pointer(apiPath, "baseUrl"), api.baseUrl));
      });
    });
  });

  const knowledgeIds = new Set<string>();
  config.knowledge.forEach((item, i) => {
    const itemPath = pointer("/knowledge", i);
    if (knowledgeIds.has(item.id)) duplicate(pointer(itemPath, "id"), "knowledge id");
    knowledgeIds.add(item.id);

    item.attachments.forEach((attachment, j) => {
      errors.push(...referenceErrors(config, pointer(pointer(itemPath, "attachments"), j), attachment));
    });

    if (item.type === "openapi" && item.url !== undefined) errors.push(...urlErrors(pointer(itemPath, "url"), item.url));
    if (item.type !== "postgresql" && item.path !== undefined) {
      errors.push(...pathErrors(pointer(itemPath, "path"), item.path, item.type === "source-code"));
    }
  });

  for (const [key, value] of Object.entries(config.repository ?? {})) {
    errors.push(...pathErrors(pointer("/repository", key), value));
  }

  errors.push(...urlErrors("/model/baseUrl", config.model.baseUrl));
  if (config.$schema !== undefined && URL.canParse(config.$schema)) errors.push(...urlErrors("/$schema", config.$schema));
  return errors;
}

function referenceErrors(config: OqasConfig, path: string, attachment: Attachment): ConfigError[] {
  const missing = (field: string, what: string) => [
    error("reference", pointer(path, field), "unknown-reference", `No ${what} with this name is declared.`),
  ];
  const app = config.applications.find((a) => a.id === attachment.application);
  if (app === undefined) return missing("application", "application");
  if (attachment.environment === undefined) {
    return attachment.api === undefined
      ? []
      : [error("reference", pointer(path, "api"), "api-without-environment", "An API is designated within an environment.")];
  }
  const environment = app.environments.find((e) => e.name === attachment.environment);
  if (environment === undefined) return missing("environment", "environment");
  if (attachment.api !== undefined && !(environment.apis ?? []).some((a) => a.name === attachment.api)) {
    return missing("api", "API");
  }
  return [];
}

function urlErrors(path: string, value: string): ConfigError[] {
  if (!URL.canParse(value)) {
    return [error("structure", path, "url-absolute", "Expected an absolute URL.")];
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return [error("structure", path, "url-scheme", "Expected an http or https URL.")];
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return [error("structure", path, "url-credentials", "A URL may not contain credentials.")];
  }
  return [];
}

function pathErrors(path: string, value: string, mayLeaveRoot = false): ConfigError[] {
  if (/[\u0000-\u001f]/.test(value)) {
    return [error("structure", path, "path-invalid", "A path may not contain control characters.")];
  }
  const slashed = value.replaceAll("\\", "/");
  if (posix.isAbsolute(slashed) || /^[A-Za-z]:/.test(slashed)) {
    return [error("structure", path, "path-absolute", "Expected a path relative to the test repository root.")];
  }
  const normalised = posix.normalize(slashed);
  if (!mayLeaveRoot && (normalised === ".." || normalised.startsWith("../"))) {
    return [error("structure", path, "path-outside-root", "The path leaves the test repository root.")];
  }
  return [];
}

function environmentErrors(config: OqasConfig, env: EnvironmentVariables): ConfigError[] {
  const references: Array<[string, string]> = [];
  config.applications.forEach((app, i) => {
    (app.authentication.accounts ?? []).forEach((account, j) => {
      const base = pointer(pointer(pointer(pointer("/applications", i), "authentication"), "accounts"), j);
      references.push([pointer(base, "usernameEnv"), account.usernameEnv], [pointer(base, "passwordEnv"), account.passwordEnv]);
    });
  });
  config.knowledge.forEach((item, i) => {
    if (item.type === "postgresql") references.push([pointer(pointer("/knowledge", i), "connectionStringEnv"), item.connectionStringEnv]);
  });
  if (config.model.apiKeyEnv !== undefined) references.push(["/model/apiKeyEnv", config.model.apiKeyEnv]);

  return references
    .filter(([, name]) => env[name] === undefined || env[name] === "")
    .map(([path, name]) => error("environment", path, "env-var-missing", `Environment variable ${name} is not set.`));
}
