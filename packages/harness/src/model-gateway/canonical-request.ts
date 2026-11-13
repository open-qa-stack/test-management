/** The part of a chat completion request that identifies it in a recording. */
export interface CanonicalRequest {
  readonly model: string;
  readonly messages: readonly CanonicalMessage[];
  /** Names of the tools offered to the model, in order. */
  readonly tools: readonly string[];
}

/** A message of a chat completion request, without the fields that do not identify it. */
export interface CanonicalMessage {
  readonly role: string;
  readonly content: string | null;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly { readonly id: string; readonly name: string; readonly arguments: string }[];
}

/** The date and time the model runtime adds to user messages; left out because it changes on every run. */
const DATETIME = /<current_datetime>[^<]*<\/current_datetime>\s*/g;

interface WireMessage {
  role: string;
  content?: unknown;
  tool_call_id?: string;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
}

/**
 * Reduces a chat completion request to what identifies it.
 *
 * @param body - The parsed request body, as the model runtime sent it.
 * @returns The request without its volatile parts.
 */
export function canonicalRequest(body: unknown): CanonicalRequest {
  const request = body as { model: string; messages: WireMessage[]; tools?: { function: { name: string } }[] };
  return {
    model: request.model,
    messages: request.messages.map(canonicalMessage),
    tools: (request.tools ?? []).map((t) => t.function.name),
  };
}

function canonicalMessage(m: WireMessage): CanonicalMessage {
  return {
    role: m.role,
    content: typeof m.content === "string" ? m.content.replace(DATETIME, "") : null,
    ...(m.tool_call_id === undefined ? {} : { toolCallId: m.tool_call_id }),
    ...(m.tool_calls === undefined ? {} : { toolCalls: m.tool_calls.map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })) }),
  };
}

/**
 * Describes a request in one line, for a replay error.
 *
 * @param request - The request the recording lacks.
 * @param position - Its rank among the requests of the session, from 1.
 * @returns A description that names the last message.
 */
export function describeRequest(request: CanonicalRequest, position: number): string {
  const last = request.messages.at(-1);
  const said = last === undefined ? "no message" : `last message from ${last.role}: ${JSON.stringify((last.content ?? "").slice(0, 160))}`;
  return `request ${position} of the session (${request.messages.length} messages, ${said})`;
}
