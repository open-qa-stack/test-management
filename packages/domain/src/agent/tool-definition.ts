/** JSON Schema describing the arguments of a tool. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/** A capability the agent may call during a session. */
export interface ToolDefinition {
  /** Unique within a session; the name the model uses to call the tool. */
  readonly name: string;
  /** What the tool does, written for the model. */
  readonly description: string;
  /** Schema the arguments must match before `execute` runs. */
  readonly parameters: JsonSchema;
  /** Whether each call counts as a browser action against the task's limit. */
  readonly browserAction?: boolean;
  /**
   * Runs the tool.
   *
   * @param args - Arguments that match `parameters`.
   * @returns What is sent back to the model; an `ImageToolResult` gives it an image besides.
   */
  execute(args: unknown): Promise<unknown>;
}
