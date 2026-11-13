import type { ToolDefinition } from "@open-qa-stack/domain";
import { scopedToolName } from "@open-qa-stack/tools";
import type { RunSource } from "./run-sources.ts";

/** Longest wait for a user interface to answer, in milliseconds. */
export const INTERFACE_TIMEOUT_MS = 10_000;

/** What the harness learned of a source before any exploration. */
export type SurveyResult = { readonly ok: true; readonly items?: readonly string[] } | { readonly ok: false; readonly error: string };

/** The tool, and its arguments, that tells whether a knowledge source answers. */
const PROBES: Readonly<Record<string, readonly [action: string, args: object]>> = {
  openapi: ["list_operations", {}],
  postgresql: ["list_tables", {}],
  document: ["list_sections", {}],
  "source-code": ["list_files", { limit: 1 }],
};

/**
 * Checks that a source answers and, for a contract or a base, reads what each domain must place.
 *
 * @remarks
 * A knowledge source answers when its first tool does: the list of operations, of tables, of sections or
 * of files. A user interface answers when its address returns anything but a server error, its redirects
 * left unfollowed. The items of a contract are its tags, and the first path segment of each operation
 * without tag; those of a base, its tables as `schema.table`. Nothing here calls the model.
 *
 * @param source - The source.
 * @param tools - The tools of the run, by name.
 * @returns Whether it answers, with its items when it has some, or why it does not.
 */
export async function surveySource(source: RunSource, tools: ReadonlyMap<string, ToolDefinition>): Promise<SurveyResult> {
  try {
    if (source.type === "web") {
      const response = await fetch(source.uiUrl, { redirect: "manual", signal: AbortSignal.timeout(INTERFACE_TIMEOUT_MS) });
      return response.status < 500 ? { ok: true } : { ok: false, error: `${source.uiUrl} answered with status ${response.status}.` };
    }
    const [action, args] = PROBES[source.type]!;
    const result = await tools.get(scopedToolName(source.id, action))!.execute(args);
    return { ok: true, ...itemsOf(source.type, result) };
  } catch (failure) {
    return { ok: false, error: reasonOf(failure) };
  }
}

/** The message of a failure, with its cause when a network call hides it behind `fetch failed`. */
function reasonOf(failure: unknown): string {
  if (!(failure instanceof Error)) return String(failure);
  return failure.cause instanceof Error ? `${failure.message}: ${failure.cause.message}` : failure.message;
}

function itemsOf(type: string, result: unknown): { items?: readonly string[] } {
  if (type === "openapi") {
    const operations = result as { path: string; tags?: string[] }[];
    return { items: [...new Set(operations.flatMap((operation) => operation.tags ?? [`/${operation.path.split("/")[1]}`]))] };
  }
  if (type === "postgresql") return { items: (result as { schema: string; table: string }[]).map((t) => `${t.schema}.${t.table}`) };
  return {};
}
