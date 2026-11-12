const text = { type: "string" } as const;

/** JSON Schema of a recording file, format version 1. */
export const recordingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["formatVersion", "origin", "exchanges"],
  properties: {
    formatVersion: { const: 1 },
    origin: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "model", "server", "recordedOn"],
          properties: { kind: { const: "recorded" }, model: text, server: text, recordedOn: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "purpose"],
          properties: { kind: { const: "handwritten" }, purpose: text },
        },
      ],
    },
    exchanges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["request", "response"],
        properties: {
          request: {
            type: "object",
            additionalProperties: false,
            required: ["model", "messages", "tools"],
            properties: {
              model: text,
              tools: { type: "array", items: text },
              messages: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["role", "content"],
                  properties: {
                    role: text,
                    content: { type: ["string", "null"] },
                    toolCallId: text,
                    toolCalls: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["id", "name", "arguments"],
                        properties: { id: text, name: text, arguments: text },
                      },
                    },
                  },
                },
              },
            },
          },
          response: { type: "object" },
        },
      },
    },
  },
} as const;

