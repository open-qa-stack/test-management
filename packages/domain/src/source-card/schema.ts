import { SLUG_PATTERN } from "../config/schema.ts";

const text = { type: "string", minLength: 1 } as const;
const count = { type: "integer", minimum: 0 } as const;

const itemProperties = { name: text, summary: text, keyFields: { type: "array", items: text } } as const;

const domainOf = (item: string) =>
  ({
    type: "object",
    additionalProperties: false,
    required: ["id", "label", "description", "items"],
    properties: {
      id: { type: "string", pattern: SLUG_PATTERN },
      label: text,
      description: text,
      items: { type: "array", minItems: 1, items: { $ref: `#/$defs/${item}` } },
    },
  }) as const;

/** JSON Schema (draft 2020-12) of what the cartographer of one source hands in. */
export const sourceCardSubmissionSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["domains", "unassigned"],
  properties: { domains: { type: "array", minItems: 1, items: { $ref: "#/$defs/domain" } }, unassigned: { type: "array", items: text } },
  $defs: { domain: domainOf("item"), item: { type: "object", additionalProperties: false, required: ["name", "summary"], properties: itemProperties } },
} as const;

/** JSON Schema (draft 2020-12) of a source card file. */
export const sourceCardSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Open QA Stack source card",
  type: "object",
  additionalProperties: false,
  required: ["formatVersion", "source", "fingerprint", "producedAt", "model", "run", "status", "domains", "unassigned"],
  properties: {
    $schema: { type: "string" },
    formatVersion: { const: 1, description: "Version of the card format, independent of the product version." },
    source: {
      type: "object",
      additionalProperties: false,
      required: ["id", "type"],
      properties: { id: text, type: { enum: ["openapi", "postgresql", "document", "source-code", "web"] } },
    },
    fingerprint: text,
    producedAt: {
      type: "string",
      pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$",
      description: "Date and time of production, ISO 8601 in UTC.",
    },
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
    domains: { type: "array", items: { $ref: "#/$defs/domain" } },
    unassigned: { type: "array", items: text },
  },
  $defs: {
    domain: domainOf("item"),
    item: { type: "object", additionalProperties: false, required: ["name", "summary"], properties: { ...itemProperties, facts: { type: "object" } } },
  },
} as const;
