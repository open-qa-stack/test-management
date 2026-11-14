const text = { type: "string" } as const;
const size = { type: "integer", minimum: 1 } as const;

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
                    content: {
                      anyOf: [
                        { type: ["string", "null"] },
                        {
                          type: "array",
                          items: {
                            oneOf: [
                              { type: "object", additionalProperties: false, required: ["type", "text"], properties: { type: { const: "text" }, text } },
                              {
                                type: "object",
                                additionalProperties: false,
                                required: ["type", "mimeType", "sha256", "width", "height"],
                                properties: {
                                  type: { const: "image" },
                                  mimeType: { const: "image/png" },
                                  sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
                                  width: size,
                                  height: size,
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
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
