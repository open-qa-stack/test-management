import { join } from "node:path";
import type { ToolDefinition } from "@open-qa-stack/domain";
import type { ResolvedConfig } from "@open-qa-stack/shared";
import { Notebook, notesTools } from "@open-qa-stack/tools";
import { configSecrets } from "./config-secrets.ts";

/** File of the notes of the agents, in the state folder of the test repository. */
export const NOTES_FILE = join("memory", "notes.jsonl");

/** Who takes notes in a task. */
export interface NoteTaker {
  /** Role of the agent. */
  readonly role: string;
  /** Identifier of the task. */
  readonly task: string;
  /** The clock of the notes. */
  readonly now?: () => Date;
}

/**
 * The notes tools of a task, over the notebook of the test repository.
 *
 * @remarks
 * Every secret of the configuration (`configSecrets`) is one no note may hold, in its text, its tags or
 * its source.
 *
 * @param config - The resolved configuration.
 * @param repositoryRoot - Absolute path of the test repository.
 * @param env - The environment the configuration reads.
 * @param taker - Who takes the notes.
 * @returns The tools `remember` and `recall`.
 */
export function agentNotes(config: ResolvedConfig, repositoryRoot: string, env: Readonly<Record<string, string | undefined>>, taker: NoteTaker): ToolDefinition[] {
  return notesTools(new Notebook(join(repositoryRoot, config.repository.stateDir, NOTES_FILE)), { ...taker, secrets: configSecrets(config, env) });
}
