/** Pattern every environment variable name must match. */
export const ENV_VAR_PATTERN = "^[A-Z_][A-Z0-9_]*$";
/** Pattern of identifiers: lower case letters and digits separated by hyphens. */
export const SLUG_PATTERN = "^[a-z0-9]+(-[a-z0-9]+)*$";

const envVar = {
  type: "string",
  pattern: ENV_VAR_PATTERN,
  description: "Name of an environment variable. The value itself is never written in the file.",
} as const;

const slug = { type: "string", pattern: SLUG_PATTERN } as const;
const label = { type: "string", minLength: 1 } as const;
const url = { type: "string", minLength: 1, description: "Absolute http or https URL, without credentials." } as const;
const relativePath = {
  type: "string",
  minLength: 1,
  description: "Path relative to the test repository root, which it may not leave.",
} as const;
const folderPath = {
  type: "string",
  minLength: 1,
  description: "Path relative to the test repository root; it may lead outside, to code kept in another repository.",
} as const;
const positiveInteger = { type: "integer", minimum: 1 } as const;

const attachment = {
  type: "object",
  additionalProperties: false,
  required: ["application"],
  properties: { application: slug, environment: label, api: label },
} as const;

const knowledgeCommon = {
  id: slug,
  attachments: { type: "array", minItems: 1, items: { $ref: "#/$defs/attachment" } },
} as const;

/**
 * JSON Schema (draft 2020-12) of the solo-mode configuration file.
 *
 * @remarks
 * Structural rules live here. Rules that need to look across the document (unique identifiers,
 * references between sections), at URLs and paths beyond their shape, or at the environment are
 * applied by `validateConfig`.
 */
export const configSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Open QA Stack solo-mode configuration",
  type: "object",
  additionalProperties: false,
  required: ["formatVersion", "applications", "knowledge", "model", "autonomy"],
  properties: {
    $schema: { type: "string" },
    formatVersion: { const: 1, description: "Version of the file format, independent of the product version." },
    applications: { type: "array", minItems: 1, items: { $ref: "#/$defs/application" } },
    knowledge: { type: "array", items: { $ref: "#/$defs/knowledge" } },
    repository: { $ref: "#/$defs/repository" },
    model: { $ref: "#/$defs/model" },
    autonomy: { $ref: "#/$defs/autonomy" },
  },
  $defs: {
    attachment,
    application: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name", "type", "authentication", "environments"],
      properties: {
        id: slug,
        name: label,
        type: { enum: ["web", "api", "web-and-api"] },
        authentication: {
          type: "object",
          additionalProperties: false,
          required: ["method"],
          properties: {
            method: { enum: ["none", "form"] },
            accounts: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "usernameEnv", "passwordEnv"],
                properties: { name: label, usernameEnv: envVar, passwordEnv: envVar },
              },
            },
          },
        },
        environments: { type: "array", minItems: 1, items: { $ref: "#/$defs/environment" } },
      },
    },
    environment: {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: {
        name: label,
        uiUrl: url,
        apis: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "baseUrl"],
            properties: { name: label, baseUrl: url },
          },
        },
      },
    },
    knowledge: {
      type: "object",
      discriminator: { propertyName: "type" },
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "type", "attachments"],
          properties: { ...knowledgeCommon, type: { const: "openapi" }, url, path: relativePath },
          oneOf: [{ required: ["url"] }, { required: ["path"] }],
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "type", "attachments", "connectionStringEnv"],
          properties: { ...knowledgeCommon, type: { const: "postgresql" }, connectionStringEnv: envVar },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "type", "attachments", "path"],
          properties: { ...knowledgeCommon, type: { const: "document" }, path: relativePath },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "type", "attachments", "path"],
          properties: {
            ...knowledgeCommon,
            type: { const: "source-code" },
            path: folderPath,
            commands: {
              enum: ["none", "git", "shell"],
              description: "Commands the agents may run in the folder: none, git history only (the default), or any shell command.",
            },
          },
        },
      ],
    },
    repository: {
      type: "object",
      additionalProperties: false,
      properties: {
        appsDir: relativePath,
        blocksDir: relativePath,
        journeysDir: relativePath,
        stateDir: relativePath,
        indexDir: relativePath,
      },
    },
    model: {
      type: "object",
      discriminator: { propertyName: "mode" },
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["mode", "provider", "baseUrl", "model"],
          properties: {
            mode: { const: "provider-key" },
            provider: { enum: ["openai"] },
            baseUrl: url,
            model: label,
            apiKeyEnv: envVar,
          },
        },
      ],
    },
    autonomy: {
      type: "object",
      discriminator: { propertyName: "level" },
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["level"],
          properties: { level: { const: "supervised" } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["level"],
          properties: { level: { const: "autonomous" } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["level", "task", "batch", "guardrailMinutes"],
          properties: {
            level: { const: "custom" },
            task: {
              type: "object",
              additionalProperties: false,
              required: ["maxIterations", "maxDurationMinutes", "maxActions"],
              properties: {
                maxIterations: positiveInteger,
                maxDurationMinutes: positiveInteger,
                maxActions: positiveInteger,
              },
            },
            batch: {
              type: "object",
              additionalProperties: false,
              required: ["maxTests", "maxIdleRounds"],
              properties: { maxTests: positiveInteger, maxIdleRounds: positiveInteger },
            },
            guardrailMinutes: positiveInteger,
          },
        },
      ],
    },
  },
} as const;
