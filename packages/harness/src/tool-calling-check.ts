import type { AgentEvent, SessionOptions, ToolDefinition } from "@open-qa-stack/domain";

/** The four points a model must meet to handle tool calls. */
export interface ToolCallingVerdict {
  /** Both tools of the check were called. */
  readonly calledBothTools: boolean;
  /** No call was refused for arguments that do not match the tool's schema. */
  readonly argumentsMatchSchemas: boolean;
  /** No tool other than the two of the check was called. */
  readonly noOtherTool: boolean;
  /** The answer quotes both results. */
  readonly quotedResults: boolean;
}

const INVENTORY = { name: "get_inventory", result: { items: 7 }, quoted: /\b7\b/ } as const;
const CONVERSION = { name: "convert_price", result: { converted: "130.80 EUR" }, quoted: /\b130\.80\b/ } as const;

/**
 * Tool-calling check for a model.
 *
 * @remarks
 * Two tools, one without arguments and one with structured arguments, and a message asking for both and
 * for their results in the answer. A model handles tool calls for this check when `evaluate` finds all
 * four points of the verdict true.
 */
export const TOOL_CALLING_CHECK = {
  /** System instructions of the check session. */
  instructions: "You are a test assistant. Use the provided tools when asked.",
  /** The message sent to the model. */
  message:
    "First call get_inventory. Then call convert_price with amount 120 and currency EUR. Finally answer in one sentence that quotes both tool results.",

  /** @returns The two tools of the check; their results are fixed and cannot be mistaken for each other. */
  tools(): ToolDefinition[] {
    return [
      {
        name: INVENTORY.name,
        description: "Returns the number of items in stock. Takes no argument.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => INVENTORY.result,
      },
      {
        name: CONVERSION.name,
        description: "Converts an amount into another currency.",
        parameters: {
          type: "object",
          properties: { amount: { type: "number" }, currency: { type: "string", enum: ["CHF", "EUR", "USD"] } },
          required: ["amount", "currency"],
          additionalProperties: false,
        },
        execute: async () => CONVERSION.result,
      },
    ];
  },

  /** @returns The options of a session running the check. */
  session(): SessionOptions {
    return { instructions: TOOL_CALLING_CHECK.instructions, tools: TOOL_CALLING_CHECK.tools() };
  },

  /**
   * Judges a check session.
   *
   * @param events - Every event of the session's turn.
   * @returns The four points of the verdict.
   */
  evaluate(events: readonly AgentEvent[]): ToolCallingVerdict {
    const names: readonly string[] = [INVENTORY.name, CONVERSION.name];
    const called = events.flatMap((e) => (e.type === "tool-call" ? [e.tool] : []));
    const answer = events.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("\n");
    return {
      calledBothTools: names.every((name) => called.includes(name)),
      argumentsMatchSchemas: !events.some((e) => e.type === "tool-error" && e.reason === "invalid-arguments"),
      noOtherTool: called.every((name) => names.includes(name)),
      quotedResults: INVENTORY.quoted.test(answer) && CONVERSION.quoted.test(answer),
    };
  },
} as const;
