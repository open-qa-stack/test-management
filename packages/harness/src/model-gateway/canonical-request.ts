import { createHash } from "node:crypto";
import { imageTokens, pngSize } from "@open-qa-stack/domain";

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
  /** The text of the message, its parts when it has several, or `null` when it has none. */
  readonly content: string | readonly CanonicalPart[] | null;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly { readonly id: string; readonly name: string; readonly arguments: string }[];
}

/** A part of a message: a text, or an image kept by its fingerprint and its size, never by its content. */
export type CanonicalPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly mimeType: "image/png"; readonly sha256: string; readonly width: number; readonly height: number };

/** The date and time the model runtime adds to user messages; left out because it changes on every run. */
const DATETIME = /<current_datetime>[^<]*<\/current_datetime>\s*/g;
/** The address of an image the model runtime sends: the PNG image itself, in base64. */
const PNG_DATA_URL = /^data:image\/png;base64,(.*)$/s;

type WirePart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } } | { type: string };

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
 * @returns The request without its volatile parts, and its images reduced to their fingerprint and size.
 * @throws Error when a message has a part that is neither a text nor a PNG image given in base64.
 */
export function canonicalRequest(body: unknown): CanonicalRequest {
  const request = body as { model: string; messages: WireMessage[]; tools?: { function: { name: string } }[] };
  return {
    model: request.model,
    messages: request.messages.map(canonicalMessage),
    tools: (request.tools ?? []).map((t) => t.function.name),
  };
}

/**
 * What the images of a request cost, as the harness counts them.
 *
 * @param request - The request.
 * @returns The tokens of every image it carries.
 */
export function imageTokensOf(request: CanonicalRequest): number {
  const parts = request.messages.flatMap((m) => (Array.isArray(m.content) ? (m.content as readonly CanonicalPart[]) : []));
  return parts.reduce((total, part) => total + (part.type === "image" ? imageTokens(part) : 0), 0);
}

function canonicalMessage(m: WireMessage): CanonicalMessage {
  return {
    role: m.role,
    content: canonicalContent(m.content),
    ...(m.tool_call_id === undefined ? {} : { toolCallId: m.tool_call_id }),
    ...(m.tool_calls === undefined ? {} : { toolCalls: m.tool_calls.map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })) }),
  };
}

function canonicalContent(content: unknown): CanonicalMessage["content"] {
  if (typeof content === "string") return content.replace(DATETIME, "");
  return Array.isArray(content) ? (content as WirePart[]).map(canonicalPart) : null;
}

function canonicalPart(part: WirePart): CanonicalPart {
  if (part.type === "text") return { type: "text", text: (part as { text: string }).text };
  const png = part.type === "image_url" ? PNG_DATA_URL.exec((part as { image_url: { url: string } }).image_url.url) : null;
  if (png === null) throw new Error(`The gateway reads texts and PNG images only, not a part of type ${part.type}.`);
  const bytes = Buffer.from(png[1]!, "base64");
  return { type: "image", mimeType: "image/png", sha256: createHash("sha256").update(bytes).digest("hex"), ...pngSize(bytes) };
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
  const said = last === undefined ? "no message" : `last message from ${last.role}: ${JSON.stringify(textOf(last.content).slice(0, 160))}`;
  return `request ${position} of the session (${request.messages.length} messages, ${said})`;
}

/** The text of a message: its texts, an image standing as its size. */
function textOf(content: CanonicalMessage["content"]): string {
  if (content === null || typeof content === "string") return content ?? "";
  return content.map((part) => (part.type === "text" ? part.text : `[image ${part.width}×${part.height}]`)).join(" ");
}
