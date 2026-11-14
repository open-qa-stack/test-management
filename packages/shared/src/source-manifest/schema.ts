const text = { type: "string", minLength: 1 } as const;

/** JSON Schema (draft 2020-12) of a source manifest file. */
export const sourceManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Open QA Stack source manifest",
  type: "object",
  additionalProperties: false,
  required: ["formatVersion", "source", "fingerprint", "producedAt", "status", "elements"],
  properties: {
    $schema: { type: "string" },
    formatVersion: { const: 1, description: "Version of the manifest format, independent of the product version." },
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
    status: { enum: ["complete", "truncated"] },
    elements: { type: "array", items: { $ref: "#/$defs/element" } },
  },
  $defs: {
    element: {
      type: "object",
      additionalProperties: false,
      required: ["name", "kind", "fingerprint", "file"],
      properties: { name: text, kind: text, fingerprint: text, file: text },
    },
  },
} as const;
