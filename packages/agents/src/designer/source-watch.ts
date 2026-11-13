import type { ToolDefinition } from "@open-qa-stack/domain";
import type { Knowledge } from "@open-qa-stack/shared";
import { redactText, secretForms } from "@open-qa-stack/tools";
import { toolsBySource } from "./index-map.ts";
import { observed } from "./observed.ts";

/** Most characters kept of what the tools of one source returned; the oldest texts go first. */
const MAX_KEPT = 200_000;
/** The types of the sources whose reading is a look at what a failed run did. */
const INSPECTED = new Set<Knowledge["type"]>(["logs", "source-code"]);

/** What the designer read of one source. */
interface Read {
  /** The tools of the source, in their order. */
  readonly tools: readonly string[];
  /** The texts its tools returned, the oldest first. */
  readonly texts: string[];
  /** How many characters `texts` holds. */
  length: number;
  /** Whether a call of one of its tools succeeded. */
  read: boolean;
}

/**
 * Watches what the designer reads with the tools of the knowledge sources, so that a plan relies on what
 * they returned.
 *
 * @remarks
 * The tools it gives are those it was given, their results unchanged. It keeps, for each source, every text
 * of what its tools returned, each declared value masked first, up to `MAX_KEPT` characters, and counts the
 * calls of the tools of logs and of source code, which are a look at what a failed run did.
 */
export class SourceWatch {
  private readonly reads = new Map<string, Read>();
  private readonly watched: ToolDefinition[];
  private inspections = 0;

  /**
   * @param sources - The knowledge sources the tools are of.
   * @param tools - Their tools, named after their source.
   * @param secrets - The values no text kept may hold, as `declaredValues` gives them.
   */
  public constructor(sources: readonly Pick<Knowledge, "id" | "type">[], tools: readonly ToolDefinition[], secrets: readonly string[]) {
    const forms = secrets.flatMap(secretForms);
    const bySource = toolsBySource(
      tools.map((tool) => tool.name),
      sources.map((source) => source.id),
    );
    const owner = new Map<string, { readonly read: Read; readonly inspected: boolean }>();
    for (const source of sources) {
      const named = bySource.get(source.id) ?? [];
      const read: Read = { tools: named, texts: [], length: 0, read: false };
      this.reads.set(source.id, read);
      for (const tool of named) owner.set(tool, { read, inspected: INSPECTED.has(source.type) });
    }
    this.watched = tools.map((tool) => {
      const of = owner.get(tool.name);
      if (of === undefined) return tool;
      return {
        ...tool,
        execute: async (args) => {
          if (of.inspected) this.inspections += 1;
          const result = await tool.execute(args);
          if (!failed(result)) this.keep(of.read, texts(result).map((text) => redactText(text, forms)));
          return result;
        },
      };
    });
  }

  /**
   * The tools of the sources, watched.
   *
   * @returns The tools given, in their order.
   */
  public tools(): ToolDefinition[] {
    return [...this.watched];
  }

  /**
   * The first tool of a source, the one to read it with.
   *
   * @param source - Identifier of the source.
   * @returns Its name; `undefined` for a source without tools.
   */
  public firstTool(source: string): string | undefined {
    return this.reads.get(source)?.tools[0];
  }

  /**
   * Whether a call of a tool of a source succeeded.
   *
   * @param source - Identifier of the source.
   * @returns `true` once one did.
   */
  public read(source: string): boolean {
    return this.reads.get(source)?.read ?? false;
  }

  /**
   * Whether a tool of a source returned a text, spaces and case aside.
   *
   * @param source - Identifier of the source; every source when none is given.
   * @param text - The text.
   * @returns `true` when a text kept holds it.
   */
  public shows(source: string | undefined, text: string): boolean {
    const reads = source === undefined ? [...this.reads.values()] : [this.reads.get(source)];
    return reads.some((read) => read !== undefined && observed(text, read.texts));
  }

  /**
   * The last texts the tools of a source returned.
   *
   * @param source - Identifier of the source.
   * @param count - How many.
   * @returns They, the oldest first.
   */
  public last(source: string, count: number): string[] {
    return (this.reads.get(source)?.texts ?? []).slice(-count);
  }

  /**
   * How many times the agent called a tool of a source of logs or of source code.
   *
   * @returns The count.
   */
  public looks(): number {
    return this.inspections;
  }

  /** Keeps the texts of a result of a source, the oldest going once it holds too many characters. */
  private keep(read: Read, kept: readonly string[]): void {
    read.read = true;
    for (const text of kept) {
      read.texts.push(text);
      read.length += text.length;
    }
    while (read.length > MAX_KEPT) read.length -= read.texts.shift()!.length;
  }
}

/** Whether a result says the call failed. */
function failed(result: unknown): boolean {
  return typeof result === "object" && result !== null && "error" in result;
}

/** Every text and number a result holds, spaces collapsed, the empty ones aside. */
function texts(result: unknown): string[] {
  if (typeof result === "string" || typeof result === "number") {
    const text = String(result).replace(/\s+/g, " ").trim();
    return text === "" ? [] : [text];
  }
  if (typeof result !== "object" || result === null) return [];
  return Object.values(result).flatMap(texts);
}
