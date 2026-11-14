import type { ToolDefinition } from "@open-qa-stack/domain";

/** How far an agent went into a document: it saw its title in a listing, the titles of its sections, or its text. */
export type Seen = "titled" | "outlined" | "read";

const DEPTH: Readonly<Record<Seen, number>> = { titled: 1, outlined: 2, read: 3 };
/** What a call of a tool of the documents shows of the document it names, by the end of its name. */
const SHOWS: Readonly<Record<string, Seen>> = { list_sections: "outlined", read_section: "read", read_file: "read" };

/**
 * What an agent saw of the documents of a source, as its calls of their tools tell.
 *
 * @remarks
 * The harness holds a placement to what the agent looked at, not to what it says: a listing shows the title
 * of each document it returns, the sections of a document show its outline, and a read shows its text. A
 * call that fails shows nothing. A call that names no document is about the one document of the source.
 */
export class DocumentWatch {
  private readonly only: string | undefined;
  private readonly seen = new Map<string, Seen>();

  /** @param files - The paths of the documents of the source. */
  public constructor(files: readonly string[]) {
    this.only = files.length === 1 ? files[0] : undefined;
  }

  /**
   * The tools of the documents, watched.
   *
   * @param tools - The tools of the documents of the source.
   * @returns The same tools, each call that succeeds recorded.
   */
  public watched(tools: readonly ToolDefinition[]): ToolDefinition[] {
    return tools.map((tool) => ({
      ...tool,
      execute: async (args) => {
        const result = await tool.execute(args);
        if (typeof result === "object" && result !== null && "error" in result) return result;
        const listed = (result as { documents?: readonly { path: string }[] } | null)?.documents;
        if (tool.name.endsWith("list_files") && Array.isArray(listed)) for (const { path } of listed) this.record(path, "titled");
        const shown = Object.entries(SHOWS).find(([action]) => tool.name.endsWith(action))?.[1];
        const file = (args as { file?: string } | null)?.file ?? this.only;
        if (shown !== undefined && file !== undefined) this.record(file, shown);
        return result;
      },
    }));
  }

  /**
   * Whether the agent went that far into a document.
   *
   * @param file - Path of the document.
   * @param depth - How far.
   * @returns `true` when a call showed it that much, or more.
   */
  public saw(file: string, depth: Seen): boolean {
    const reached = this.seen.get(file);
    return reached !== undefined && DEPTH[reached] >= DEPTH[depth];
  }

  private record(file: string, depth: Seen): void {
    if (!this.saw(file, depth)) this.seen.set(file, depth);
  }
}
