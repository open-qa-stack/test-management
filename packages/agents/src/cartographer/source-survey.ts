import { knowledgeInventory, type KnowledgeAccess, type SourceInventory } from "@open-qa-stack/tools";
import type { RunSource } from "./run-sources.ts";

/** Longest wait for a user interface to answer, in milliseconds. */
export const INTERFACE_TIMEOUT_MS = 10_000;

/** Whether a source answers, with the inventory read for a knowledge source, or why it does not. */
export type SurveyResult = { readonly ok: true; readonly inventory?: SourceInventory } | { readonly ok: false; readonly error: string };

/**
 * Checks that a source answers.
 *
 * @remarks
 * A knowledge source answers when its inventory can be read, and the inventory is returned so that it is not read again. A user interface answers when its address returns anything
 * but a server error, its redirects left unfollowed. Nothing here calls the model.
 *
 * @param source - The source.
 * @param access - How to reach the knowledge sources.
 * @returns Whether it answers, with its inventory, or why it does not.
 */
export async function surveySource(source: RunSource, access: KnowledgeAccess): Promise<SurveyResult> {
  try {
    if (source.type === "web") {
      const response = await fetch(source.uiUrl, { redirect: "manual", signal: AbortSignal.timeout(INTERFACE_TIMEOUT_MS) });
      return response.status < 500 ? { ok: true } : { ok: false, error: `${source.uiUrl} answered with status ${response.status}.` };
    }
    return { ok: true, inventory: await knowledgeInventory(source.knowledge, access) };
  } catch (failure) {
    return { ok: false, error: reasonOf(failure) };
  }
}

/** The message of a failure, with its cause when a network call hides it behind `fetch failed`. */
function reasonOf(failure: unknown): string {
  if (!(failure instanceof Error)) return String(failure);
  return failure.cause instanceof Error ? `${failure.message}: ${failure.cause.message}` : failure.message;
}
