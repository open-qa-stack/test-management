import { SLUG_PATTERN } from "../config/schema.ts";

const text = { type: "string", minLength: 1 } as const;
const count = { type: "integer", minimum: 0 } as const;

const references = {
  type: "object",
  additionalProperties: false,
  required: ["source", "items"],
  properties: { source: text, items: { type: "array", minItems: 1, items: text } },
} as const;

const domain = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "description", "references"],
  properties: {
    id: { type: "string", pattern: SLUG_PATTERN },
    label: text,
    description: text,
    references: { type: "array", minItems: 1, items: { $ref: "#/$defs/references" } },
  },
} as const;

const defs = { references, domain } as const;

const submissionProperties = {
  domains: { type: "array", minItems: 1, items: { $ref: "#/$defs/domain" } },
  unassigned: { type: "array", items: { $ref: "#/$defs/references" } },
} as const;

/** JSON Schema (draft 2020-12) of what the cartographer hands in: the domains, and what it put in none. */
export const domainSubmissionSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["domains", "unassigned"],
  properties: submissionProperties,
  $defs: defs,
} as const;

/**
 * JSON Schema (draft 2020-12) of the knowledge base file.
 *
 * @remarks
 * Structural rules live here. Rules that look across the document — unique domain identifiers, references
 * to listed sources — are applied by `validateKnowledgeBase`.
 */
export const knowledgeBaseSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Open QA Stack knowledge base",
  type: "object",
  additionalProperties: false,
  required: ["formatVersion", "producedAt", "environment", "model", "run", "status", "sources", "domains", "unassigned"],
  properties: {
    $schema: { type: "string" },
    formatVersion: { const: 1, description: "Version of the knowledge base format, independent of the product version." },
    producedAt: {
      type: "string",
      pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$",
      description: "Date and time of production, ISO 8601 in UTC.",
    },
    environment: text,
    model: {
      type: "object",
      additionalProperties: false,
      required: ["provider", "baseUrl", "model"],
      properties: { provider: text, baseUrl: text, model: text },
    },
    run: {
      type: "object",
      additionalProperties: false,
      required: ["iterations", "actions", "durationMs"],
      properties: { iterations: count, actions: count, durationMs: count },
    },
    status: { enum: ["complete", "truncated"] },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "state"],
        properties: {
          id: text,
          type: { enum: ["openapi", "postgresql", "document", "source-code", "web"] },
          state: { enum: ["read", "not_read"] },
          cardFingerprint: { type: "string", pattern: "^sha256:[0-9a-f]{64}$", description: "Fingerprint of the card the source was read from." },
        },
      },
    },
    ...submissionProperties,
  },
  $defs: defs,
} as const;
