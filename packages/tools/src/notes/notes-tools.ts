import type { ToolDefinition } from "@open-qa-stack/domain";
import { secretForms } from "../browser/redact.ts";
import { secretPaths } from "../common/secret-paths.ts";
import type { Notebook } from "./notebook.ts";

/** Longest note an agent may write. */
export const MAX_NOTE_LENGTH = 600;
/** Most notes a search returns. */
export const MAX_FOUND_NOTES = 30;

/** Who writes notes, and what they must never contain. */
export interface NoteWriter {
  /** Role of the agent. */
  readonly role: string;
  /** Identifier of its task. */
  readonly task: string;
  /** Values that must never be kept: the secrets of the configuration. */
  readonly secrets: readonly string[];
  /** The clock of the notes; the system clock by default. */
  readonly now?: () => Date;
}

const tags = {
  type: "array",
  minItems: 1,
  maxItems: 8,
  items: { type: "string", minLength: 1, maxLength: 40 },
  description: "Words that file the note: a domain, an entity, a screen…",
} as const;

/**
 * The two tools of the notes: keep a fact for the agents that come after, and find the facts kept so far.
 *
 * @remarks
 * A note holds no secret: a text with a value of the secrets of the configuration, in any of the forms a
 * page or a tool may show it, is refused. Tags are kept in lower case.
 *
 * @param notebook - Where the notes are kept.
 * @param writer - Who writes them.
 * @returns The tools `remember` and `recall`.
 */
export function notesTools(notebook: Notebook, writer: NoteWriter): ToolDefinition[] {
  const forms = writer.secrets.filter((secret) => secret !== "").flatMap(secretForms);
  return [
    {
      name: "remember",
      description: `Keeps a fact worth knowing for the agents that come after you — a rule of the application, a test account, a pitfall — with tags to find it again. ${MAX_NOTE_LENGTH} characters at most; never a secret.`,
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", minLength: 1, maxLength: MAX_NOTE_LENGTH },
          tags,
          source: { type: "string", minLength: 1, description: "The source or application it is about." },
        },
        required: ["text", "tags"],
        additionalProperties: false,
      },
      execute: async (args) => {
        const { text, tags: given, source } = args as { text: string; tags: string[]; source?: string };
        if (secretPaths({ text, tags: given, source }, forms).length > 0)
          return { error: "The note holds a secret of the configuration; it was not kept. Write it without the secret." };
        const now = (writer.now ?? (() => new Date()))().toISOString();
        await notebook.add({
          text,
          tags: given.map((tag) => tag.toLowerCase()),
          ...(source === undefined ? {} : { source }),
          role: writer.role,
          task: writer.task,
          writtenAt: now,
        });
        return "Kept.";
      },
    },
    {
      name: "recall",
      description: "Finds the facts the agents kept so far, by tags and by words of their text, the best first; without either, the latest.",
      parameters: {
        type: "object",
        properties: {
          tags: { ...tags, minItems: 0 },
          text: { type: "string", description: "Words to find in the notes." },
          source: { type: "string", description: "Only the notes about this source or application." },
          limit: { type: "integer", minimum: 1, maximum: MAX_FOUND_NOTES, description: "Defaults to 10." },
        },
        additionalProperties: false,
      },
      execute: async (args) => {
        const { tags: wanted, text, source, limit = 10 } = args as { tags?: string[]; text?: string; source?: string; limit?: number };
        const found = await notebook.find({
          ...(wanted === undefined ? {} : { tags: wanted }),
          ...(text === undefined ? {} : { text }),
          ...(source === undefined ? {} : { source }),
          limit,
        });
        return found.map(({ text: note, tags: filed, source: about, role, writtenAt, score }) => ({
          text: note,
          tags: filed,
          ...(about === undefined ? {} : { source: about }),
          role,
          writtenAt,
          score,
        }));
      },
    },
  ];
}
