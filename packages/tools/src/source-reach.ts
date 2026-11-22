import { sourceApplications, type Knowledge, type ToolDefinition } from "@open-qa-stack/domain";

/** What a session is told of a source attached to applications it does not test, with each answer of its tools. */
export interface ReachWarning {
  /** Why what the source tells may not hold for the applications the session tests. */
  readonly warning: string;
  /** What the tool answered. */
  readonly result: unknown;
}

/** What a session is told of the applications a source describes. */
export interface SourceReach {
  /** The sentence that names them. */
  readonly named: string;
  /** Why what the source tells may not hold for the applications the session tests, when it tests none of them. */
  readonly warning?: string;
}

/**
 * Says to a session which applications a source describes, and warns it when it tests none of them.
 *
 * @param source - The identifier of the source.
 * @param own - The applications the source describes.
 * @param applications - The applications the session tests; none for a session that is not kept to some.
 * @returns What to tell; nothing for a source of the whole project.
 */
export function sourceReach(source: string, own: readonly string[], applications?: readonly string[]): SourceReach | undefined {
  if (own.length === 0) return undefined;
  const named = `The source ${source} describes the application${own.length === 1 ? "" : "s"} ${own.join(", ")}.`;
  if (applications === undefined || own.some((application) => applications.includes(application))) return { named };
  const warning = `Warning: ${named} The session tests ${applications.join(", ")}: what it tells may not hold there. Check that what you look for is the same before you rely on it.`;
  return { named, warning };
}

/**
 * Says what a source describes to the session that reads it, through its tools: a source of the whole project says
 * nothing; one attached to applications names them in the description of each tool; one attached only to applications
 * the session does not test gives each answer with a warning, which names them and those the session tests.
 *
 * @remarks
 * The source stays readable: what it tells of another application may hold for this one, which the agent checks.
 *
 * @param tools - The tools of the source.
 * @param source - The source.
 * @param applications - The applications the session tests; none for a session that is not kept to some.
 * @returns The tools, saying what the source describes.
 */
export function withReach(tools: readonly ToolDefinition[], source: Pick<Knowledge, "id" | "attachments">, applications?: readonly string[]): ToolDefinition[] {
  const reach = sourceReach(source.id, sourceApplications(source), applications);
  if (reach === undefined) return [...tools];
  const { named, warning } = reach;
  if (warning === undefined) return tools.map((tool) => ({ ...tool, description: `${tool.description} ${named}` }));
  return tools.map((tool) => ({
    ...tool,
    description: `${tool.description} ${warning}`,
    execute: async (args: unknown): Promise<ReachWarning> => ({ warning, result: await tool.execute(args) }),
  }));
}
