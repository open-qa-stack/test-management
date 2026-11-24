import { LANGUAGES } from "./language.ts";

/** Pattern every environment variable name must match. */
export const ENV_VAR_PATTERN = "^[A-Z_][A-Z0-9_]*$";
/** Pattern of identifiers: lower case letters and digits separated by hyphens. */
export const SLUG_PATTERN = "^[a-z0-9]+(-[a-z0-9]+)*$";

/** Pattern of test charter rule identifiers: upper case words and digits separated by hyphens, such as `PW-WAIT-01`. */
export const CHARTER_RULE_ID_PATTERN = "^[A-Z]+(-[A-Z0-9]+)+$";

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
const charterRuleId = { type: "string", pattern: CHARTER_RULE_ID_PATTERN } as const;
/** Pattern of container names, as Podman and Docker accept them. */
export const CONTAINER_NAME_PATTERN = "^[A-Za-z0-9][A-Za-z0-9_.-]*$";

const positiveInteger = { type: "integer", minimum: 1 } as const;
const language = { enum: LANGUAGES } as const;

const attachment = {
  type: "object",
  additionalProperties: false,
  required: ["application"],
  properties: { application: slug, environment: label, api: label },
} as const;

const knowledgeCommon = {
  id: slug,
  attachments: { type: "array", items: { $ref: "#/$defs/attachment" } },
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
  required: ["formatVersion", "applications", "knowledge", "model"],
  properties: {
    $schema: { type: "string" },
    formatVersion: { const: 1, description: "Version of the file format, independent of the product version." },
    language: {
      ...language,
      description:
        "The language the console, the conversation of the command line and the agents speak to the person in, as a BCP 47 tag; en by default. The instructions the agents are given stay in English.",
    },
    applications: { type: "array", minItems: 1, items: { $ref: "#/$defs/application" } },
    knowledge: { type: "array", items: { $ref: "#/$defs/knowledge" } },
    repository: { $ref: "#/$defs/repository" },
    charter: { $ref: "#/$defs/charter" },
    cartography: { $ref: "#/$defs/cartography" },
    design: { $ref: "#/$defs/design" },
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
        exploration: {
          enum: ["read-only", "read-write"],
          description:
            "What the agent that explores the user interface may do in this environment: `read-only`, the default, it changes no data; `read-write`, it may submit the forms that create or change data, never those that remove any.",
        },
        allow: {
          type: "object",
          additionalProperties: false,
          description:
            "What the agents may do in this environment, each allowed when left out: `design`, write tests there; `run`, run tests there. A session or a launch an environment does not allow is refused before it starts.",
          properties: { design: { type: "boolean" }, run: { type: "boolean" } },
        },
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
          required: ["id", "type"],
          properties: { ...knowledgeCommon, type: { const: "openapi" }, url, path: relativePath },
          oneOf: [{ required: ["url"] }, { required: ["path"] }],
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "type", "connectionStringEnv"],
          properties: { ...knowledgeCommon, type: { const: "postgresql" }, connectionStringEnv: envVar },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "type"],
          properties: {
            ...knowledgeCommon,
            type: { const: "document" },
            path: { ...relativePath, description: "A document of the test repository, or a folder of them, relative to its root, which it may not leave." },
            stored: { enum: [true], description: "The documents are uploaded to the instance, which keeps them in its database." },
          },
          oneOf: [{ required: ["path"] }, { required: ["stored"] }],
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "type", "path"],
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
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "type"],
          properties: {
            ...knowledgeCommon,
            type: { const: "logs" },
            path: { ...folderPath, description: "Log file, relative to the test repository root; it may lead outside." },
            container: { type: "string", pattern: CONTAINER_NAME_PATTERN, description: "Name of the container whose logs are read." },
            engine: { enum: ["podman", "docker"], description: "Container engine whose command reads the logs of the container." },
          },
          oneOf: [
            { required: ["path"], not: { anyOf: [{ required: ["container"] }, { required: ["engine"] }] } },
            { required: ["container", "engine"], not: { required: ["path"] } },
          ],
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
    cartography: {
      type: "object",
      additionalProperties: false,
      description: "How the sources are mapped.",
      properties: {
        concurrency: { ...positiveInteger, description: "Most sources mapped at once, each in its own task; one by default." },
      },
    },
    design: {
      type: "object",
      additionalProperties: false,
      description: "How the tests are designed.",
      properties: {
        reviewPlan: {
          type: "boolean",
          description:
            "Whether an agent of its own reviews the scenarios of a plan for duplicates, in sessions of the model of their own; true by default. The harness compares the scenarios by their code either way.",
        },
        passes: {
          type: "string",
          enum: ["by-level", "single"],
          description:
            "How the levels asked are designed; by-level by default. by-level: one level after the other, from the base of the pyramid of tests to its top, each with an agent that plans that level alone, then the agent that writes its tests; a level starts once the one below is over, and is told the tests it gave, so that it builds on them. single: every level in one plan.",
        },
        visualTests: {
          type: "boolean",
          description:
            "Whether visual tests are designed, in a pass of their own after the other tests; true by default. An agent plans the states of the screens worth comparing, and each test compares the whole page with a reference made at its first run and committed with it, the zones whose content changes masked. A reference is that of one browser on one machine: run the tests where their references were made.",
        },
        visualTolerance: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "The share of the pixels of a screen that may differ from its reference, from 0 to 1; 0.01 by default.",
        },
        architecture: {
          type: "string",
          enum: ["page-objects", "fixtures", "standalone"],
          description:
            "How the tests are built; page-objects by default. page-objects: the tests act on the page objects of the screens, written from the plans, and are given each application by the fixtures they share. fixtures: each line of a test acts on the page, and the tests import the fixtures they share. standalone: each test imports Playwright itself, and nothing is written beside it, for a repository with an architecture of its own.",
        },
        fixturesFile: {
          ...relativePath,
          description:
            "Path of the file of the fixtures the tests share, relative to the root of the test repository; shared/fixtures.ts in the folder of the applications by default. A file already there is kept as it is, and written when the repository has none.",
        },
        reviewTests: {
          type: "boolean",
          description:
            "Whether an agent of its own reads each test that passed against the scenario of its plan, in a session of the model of its own; true by default. Its findings are told once to the agent that wrote the test and kept with the test: it refuses none.",
        },
        reviewCode: {
          type: "boolean",
          description:
            "Whether an agent of its own reads the code of each test that passed for its quality, against the test charter, in a session of the model of its own; true by default. Its findings are told once to the agent that wrote the test and kept with the test: it refuses none.",
        },
        levels: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: { type: "string", enum: ["smoke", "functional", "business", "cross-application", "end-to-end"] },
          description:
            "The levels of the pyramid of tests a plan is asked for, from its base to its top: smoke, the application answers; functional, one behaviour of one screen; business, a journey through several screens; cross-application, an action in an application and its effect in another; end-to-end, a journey through three applications or more. smoke, functional and business by default.",
        },
        testLanguage: {
          ...language,
          description:
            "The language of what the tests say, as a BCP 47 tag: their titles, their steps and the intents written in their code; en by default. The code itself, its names included, stays in English.",
        },
      },
    },
    charter: {
      type: "object",
      additionalProperties: false,
      description: "Changes to the default test charter the designer and the reviewer apply.",
      properties: {
        disable: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["rule", "reason"],
            properties: { rule: charterRuleId, reason: label },
          },
        },
        add: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "statement", "reason"],
            properties: { id: charterRuleId, statement: label, reason: label },
          },
        },
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
            capabilities: {
              type: "array",
              items: { enum: ["vision"] },
              description: "What the model can do besides reading and writing text: `vision`, it reads images.",
            },
            requestTimeoutSeconds: {
              type: "integer",
              minimum: 1,
              description:
                "Longest wait for the answer of the model to one request, in seconds; 120 by default. A request left without answer is sent once more.",
            },
            reasoningEffort: {
              ...label,
              description:
                "How much the model reasons before it answers, in a word of its server, such as `none`, `low` or `high`; sent with every request when set.",
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["mode", "model"],
          description: "A model of GitHub Copilot, reached with the GitHub account the machine signed in with, through the GitHub CLI or the Copilot CLI.",
          properties: {
            mode: { const: "github" },
            model: label,
            capabilities: {
              type: "array",
              items: { enum: ["vision"] },
              description: "What the model can do besides reading and writing text: `vision`, it reads images.",
            },
            reasoningEffort: {
              ...label,
              description: "How much the model reasons before it answers, in a word Copilot offers for the model, such as `low` or `high`.",
            },
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
          properties: { level: { const: "autonomous" }, guardrailMinutes: positiveInteger },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["level", "task"],
          properties: {
            level: { const: "bounded" },
            task: {
              type: "object",
              additionalProperties: false,
              minProperties: 1,
              properties: { maxMinutes: positiveInteger, maxIterations: positiveInteger, maxActions: positiveInteger },
            },
            batch: {
              type: "object",
              additionalProperties: false,
              properties: {
                maxTests: { ...positiveInteger, description: "Tests a batch may write; 40 by default." },
                maxIdleRounds: { ...positiveInteger, description: "Rounds in a row that may bring no new test before a batch ends; 3 by default." },
              },
            },
            guardrailMinutes: positiveInteger,
          },
        },
      ],
    },
  },
} as const;
