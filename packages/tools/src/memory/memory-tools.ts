import { randomUUID } from "node:crypto";
import {
  closeMemories,
  GENERAL_DOMAIN,
  MEMORY_KINDS,
  rankMemories,
  SLUG_PATTERN,
  type FoundMemory,
  type MemoryKind,
  type MemoryStorePort,
  type ToolDefinition,
} from "@open-qa-stack/domain";
import { secretForms } from "../browser/redact.ts";
import { secretPaths } from "../common/secret-paths.ts";

/** Longest memory an agent may write. */
export const MAX_MEMORY_LENGTH = 600;
/** Most memories a search returns. */
export const MAX_FOUND_MEMORIES = 30;

/** Who writes memories, and what they must never contain. */
export interface MemoryWriter {
  /** Role of the agent. */
  readonly role: string;
  /** Identifier of its task. */
  readonly task: string;
  /** Values that must never be kept: the secrets of the configuration. */
  readonly secrets: readonly string[];
  /** The clock of the memories; the system clock by default. */
  readonly now?: () => Date;
  /** Gives the identifier of a new memory; a random UUID by default. */
  readonly newId?: () => string;
}

/** What `remember` is given. */
interface Remembered {
  readonly domain: string;
  readonly kind: MemoryKind;
  readonly text: string;
  readonly tags?: readonly string[];
  readonly source?: string;
  readonly revises?: string;
  readonly distinct?: boolean;
}

/** What `recall` is given. */
interface Recalled {
  readonly domain?: string;
  readonly kind?: MemoryKind;
  readonly tags?: readonly string[];
  readonly text?: string;
  readonly source?: string;
  readonly limit?: number;
}

const domain = {
  type: "string",
  pattern: SLUG_PATTERN,
  maxLength: 60,
  description: `The id of the domain of the knowledge it is about, or "${GENERAL_DOMAIN}" for what holds across the domains.`,
} as const;

const kind = {
  enum: MEMORY_KINDS,
  description:
    "business_rule: a rule the application applies. pitfall: what misleads an agent or breaks a test. test_data: a record, an account or a value a test can rely on, never a password. locator: how to target an element reliably. navigation: how to reach a screen or a state. vocabulary: two sources or screens that name the same thing differently.",
} as const;

const tags = {
  type: "array",
  maxItems: 8,
  items: { type: "string", minLength: 1, maxLength: 40 },
  description: "Words that file it: an entity, a screen, a field…",
} as const;

/** A memory as the tools give it to an agent. */
function shown({ id, domain: about, kind: of, text, tags: filed, source, written, revised, score }: FoundMemory) {
  return {
    id,
    domain: about,
    kind: of,
    text,
    tags: filed,
    ...(source === undefined ? {} : { source }),
    role: written.role,
    writtenAt: written.at,
    ...(revised === undefined ? {} : { revisedAt: revised.at }),
    score,
  };
}

/**
 * The two tools of the memory: keep a fact for the agents that come after, filed under a domain and a kind, and find
 * the facts kept so far.
 *
 * @remarks
 * A memory holds no secret: one with a value of the secrets of the configuration, in any of the forms a page or a
 * tool may show it, is refused. Tags are kept in lower case.
 *
 * `remember` keeps no duplicate unasked: before it keeps a memory, it looks for the close ones, of the same domain
 * and the same kind. When there are, it keeps nothing and gives them back, so that the agent corrects one of them
 * (`revises`) or says its own is new (`distinct`). No model is asked: the agent decides.
 *
 * @param memory - Where the memories are kept.
 * @param writer - Who writes them.
 * @returns The tools `remember` and `recall`.
 */
export function memoryTools(memory: MemoryStorePort, writer: MemoryWriter): ToolDefinition[] {
  const forms = writer.secrets.filter((secret) => secret !== "").flatMap(secretForms);
  const origin = () => ({ role: writer.role, task: writer.task, at: (writer.now ?? (() => new Date()))().toISOString() });
  return [
    {
      name: "remember",
      description: `Keeps a fact worth knowing for the agents that come after you, filed under the domain it is about and its kind. ${MAX_MEMORY_LENGTH} characters at most; never a secret. When memories of the same domain and kind are close to it, nothing is kept and they are given back: correct the one that says the same with \`revises\`, or call again with \`distinct\` when yours is new.`,
      parameters: {
        type: "object",
        properties: {
          domain,
          kind,
          text: { type: "string", minLength: 1, maxLength: MAX_MEMORY_LENGTH },
          tags,
          source: { type: "string", minLength: 1, description: "The source or application it is about." },
          revises: { type: "string", minLength: 1, description: "The id of a memory of the same domain and kind, to replace what it says with this." },
          distinct: { type: "boolean", description: "Keeps it although close memories exist: it says something they do not." },
        },
        required: ["domain", "kind", "text"],
        additionalProperties: false,
      },
      execute: async (args) => {
        const { domain: about, kind: of, text, tags: given = [], source, revises, distinct = false } = args as Remembered;
        if (revises !== undefined && distinct) return { error: "Give revises or distinct, not both: a memory is either corrected or added." };
        if (secretPaths({ domain: about, text, tags: given, source }, forms).length > 0)
          return { error: "The memory holds a secret of the configuration; it was not kept. Write it without the secret." };
        const content = { text, tags: given.map((tag) => tag.toLowerCase()), ...(source === undefined ? {} : { source }) };
        const kept = await memory.list({ domain: about, kind: of });
        if (revises !== undefined) {
          if (!kept.some(({ id }) => id === revises))
            return { error: `No memory ${revises} is of the domain ${about} and the kind ${of}: nothing was changed. Recall them to find its id.` };
          await memory.revise(revises, content, origin());
          return `Corrected ${revises}.`;
        }
        const close = distinct ? [] : closeMemories(kept, content);
        if (close.length > 0)
          return {
            kept: false,
            message: `Nothing was kept: these memories of the domain ${about} and the kind ${of} are close to it. If one of them says the same, correct it: call remember again with revises set to its id and the text it should say. If yours says something none of them does, call remember again with distinct set to true.`,
            close: close.map(shown),
          };
        const id = (writer.newId ?? randomUUID)();
        await memory.add({ id, domain: about, kind: of, ...content, written: origin() });
        return `Kept as ${id}.`;
      },
    },
    {
      name: "recall",
      description:
        "Finds the facts the agents kept so far: those of a domain, of a kind and of a source when you name them, then by tags and by words of their text, the best first; without tags nor words, the latest.",
      parameters: {
        type: "object",
        properties: {
          domain,
          kind,
          tags,
          text: { type: "string", description: "Words to find in the memories." },
          source: { type: "string", description: "Only the memories about this source or application." },
          limit: { type: "integer", minimum: 1, maximum: MAX_FOUND_MEMORIES, description: "Defaults to 10." },
        },
        additionalProperties: false,
      },
      execute: async (args) => {
        const { domain: about, kind: of, tags: wanted, text, source, limit = 10 } = args as Recalled;
        const kept = await memory.list({
          ...(about === undefined ? {} : { domain: about }),
          ...(of === undefined ? {} : { kind: of }),
          ...(source === undefined ? {} : { source }),
        });
        return rankMemories(kept, { ...(wanted === undefined ? {} : { tags: wanted }), ...(text === undefined ? {} : { text }), limit }).map(shown);
      },
    },
  ];
}
