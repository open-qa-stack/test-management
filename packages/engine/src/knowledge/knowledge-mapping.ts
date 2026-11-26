import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CARDS_FOLDER, KNOWLEDGE_BASE_FILE_NAME, runSources } from "@open-qa-stack/agents";
import {
  parseJson,
  resolvedConfig,
  validateKnowledgeBase,
  validateSourceCard,
  type CartographyState,
  type MappedSource,
  type SessionStorePort,
} from "@open-qa-stack/domain";
import type { Configuration } from "../configuration/configuration.ts";

/** @returns What a file holds, read as JSON; `undefined` when it is not there or is no JSON. */
async function jsonAt(path: string): Promise<unknown> {
  return parseJson(await readFile(path, "utf8").catch(() => ""));
}

/**
 * Where the cartography of the knowledge stands, source by source, as the console shows it while it maps: each source
 * the cartography reads in the first environment, with its card or none yet, and the knowledge base that puts the cards
 * together. Whatever shows it — the console, a command — calls this and holds no rule of its own.
 *
 * @remarks
 * A source with a card is mapped, or truncated when a limit stopped its card; one without is mapping while a session
 * maps the knowledge, and waiting otherwise. A card or a knowledge base that cannot be read is none.
 */
export class KnowledgeMapping {
  readonly #repository: string | undefined;
  readonly #configuration: Configuration;
  readonly #sessions: Pick<SessionStorePort, "sessions">;

  /**
   * @param repository - Absolute path of the test repository, which holds the cards and the knowledge base; `undefined` for a host that has none.
   * @param configuration - The operations on the configuration, whose revision in force names the sources.
   * @param sessions - The store of the sessions, which tells whether a session maps the knowledge now.
   */
  constructor(repository: string | undefined, configuration: Configuration, sessions: Pick<SessionStorePort, "sessions">) {
    this.#repository = repository;
    this.#configuration = configuration;
    this.#sessions = sessions;
  }

  /**
   * @returns Where the cartography stands, by the configuration in force once it is in step with its file; no source for a host
   * without a test repository, or without a configuration.
   */
  async state(): Promise<CartographyState> {
    const revision = await this.#configuration.inForce();
    if (this.#repository === undefined || revision === undefined) return { sources: [] };
    const config = resolvedConfig(revision.document);
    // The schema asks each application for an environment, and the configuration for an application.
    const environment = config.applications[0]!.environments[0]!.name;
    const folder = join(this.#repository, config.repository.knowledgeDir);
    const mapping = (await this.#sessions.sessions()).some((session) => session.purpose === "map" && session.state === "running");
    const sources = await Promise.all(
      runSources(config, environment).map(async ({ id, type }): Promise<MappedSource> => {
        const card = validateSourceCard(await jsonAt(join(folder, CARDS_FOLDER, `${id}.json`)));
        if (!card.ok) return { id, type, state: mapping ? "mapping" : "waiting" };
        return { id, type, state: card.value.status === "complete" ? "mapped" : "truncated", mappedAt: card.value.producedAt };
      }),
    );
    const knowledgeBase = validateKnowledgeBase(await jsonAt(join(folder, KNOWLEDGE_BASE_FILE_NAME)));
    return {
      environment,
      sources,
      ...(knowledgeBase.ok ? { knowledgeBase: { producedAt: knowledgeBase.value.producedAt, status: knowledgeBase.value.status } } : {}),
    };
  }
}
