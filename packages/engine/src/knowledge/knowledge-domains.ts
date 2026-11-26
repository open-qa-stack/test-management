import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_REPOSITORY,
  DomainRefusedError,
  knowledgeBaseSourceApplications,
  UnknownDomainError,
  validateKnowledgeBase,
  type ConfigurationQueries,
  type DomainChange,
  type KnowledgeBase,
  type DomainSettingStorePort,
  type KnowledgeDomain,
  type OqasConfig,
} from "@open-qa-stack/domain";

/** The file of the knowledge base, in its folder. */
const INDEX_FILE = "knowledge-base.json";

/** Longest name of a domain, in characters. */
export const MAX_DOMAIN_LABEL = 100;

/**
 * The domains of the knowledge of the project, as the last cartography wrote them in the test repository: what a session
 * may keep its work to.
 */
export class KnowledgeDomains {
  readonly #repository: string | undefined;
  readonly #configuration: ConfigurationQueries;
  readonly #settings: DomainSettingStorePort;

  /**
   * @param repository - Absolute path of the test repository; `undefined` for a host that has none.
   * @param configuration - The revision in force, which names the folder of the knowledge base.
   * @param settings - What a person set of the domains.
   */
  constructor(repository: string | undefined, configuration: ConfigurationQueries, settings: DomainSettingStorePort) {
    this.#repository = repository;
    this.#configuration = configuration;
    this.#settings = settings;
  }

  /**
   * @returns The domains of the knowledge base, in its order, each with its sources and the applications each describes, as the
   * configuration in force attaches them, the name a person gave it and whether they excluded it; none without a test
   * repository, a configuration, or a knowledge base that can be read.
   */
  async list(): Promise<KnowledgeDomain[]> {
    const read = await this.#read();
    if (read === undefined) return [];
    const { knowledgeBase, knowledge } = read;
    const set = new Map((await this.#settings.list()).map((setting) => [setting.id, setting]));
    // A valid knowledge base lists every source it refers to.
    const applicationsOf = (source: string) =>
      knowledgeBaseSourceApplications(
        knowledgeBase.sources.find((candidate) => candidate.id === source)!,
        knowledge,
      );
    return knowledgeBase.domains.map(({ id, label, description, references }) => {
      const setting = set.get(id);
      return {
        id,
        label: setting?.label ?? label,
        ...(setting?.label === undefined ? {} : { foundLabel: label }),
        ...(setting?.excluded === true ? { excluded: true as const } : {}),
        description,
        sources: references.map(({ source, items }) => ({ id: source, applications: applicationsOf(source), items })),
      };
    });
  }

  /**
   * Changes what a person set of a domain: its name — the one the cartography gave it takes it back —, whether it is
   * excluded, or both. The sessions that open or run afterwards follow it.
   *
   * @param id - The identifier of the domain.
   * @param change - What changes; what it leaves out stays.
   * @returns The domain, changed.
   * @throws `UnknownDomainError` when the knowledge holds no such domain.
   * @throws `DomainRefusedError` when the name is empty or too long.
   */
  async change(id: string, change: DomainChange): Promise<KnowledgeDomain> {
    const found = (await this.list()).find((domain) => domain.id === id);
    if (found === undefined) throw new UnknownDomainError(id);
    const named = (change.label ?? found.label).trim();
    if (named === "" || named.length > MAX_DOMAIN_LABEL) throw new DomainRefusedError(`The name of a domain is a text of 1 to ${MAX_DOMAIN_LABEL} characters.`);
    const excluded = change.excluded ?? found.excluded === true;
    const own = named === (found.foundLabel ?? found.label);
    await (own && !excluded ? this.#settings.remove([id]) : this.#settings.set({ id, ...(own ? {} : { label: named }), excluded }));
    return (await this.list()).find((domain) => domain.id === id)!;
  }

  /** Forgets what was set of the domains the knowledge base no longer holds; nothing while the knowledge base cannot be read. */
  async forget(): Promise<void> {
    const read = await this.#read();
    if (read === undefined) return;
    const held = new Set(read.knowledgeBase.domains.map(({ id }) => id));
    await this.#settings.remove((await this.#settings.list()).map(({ id }) => id).filter((id) => !held.has(id)));
  }

  /** The knowledge base and the sources of the configuration in force; `undefined` without a test repository, a configuration, or a knowledge base that can be read. */
  async #read(): Promise<{ readonly knowledgeBase: KnowledgeBase; readonly knowledge: OqasConfig["knowledge"] } | undefined> {
    const revision = await this.#configuration.inForce();
    if (this.#repository === undefined || revision === undefined) return undefined;
    const { knowledgeDir } = { ...DEFAULT_REPOSITORY, ...revision.document.repository };
    const text = await readFile(join(this.#repository, knowledgeDir, INDEX_FILE), "utf8").catch(() => "");
    let content: unknown;
    try {
      content = JSON.parse(text);
    } catch {
      return undefined;
    }
    const knowledgeBase = validateKnowledgeBase(content);
    return knowledgeBase.ok ? { knowledgeBase: knowledgeBase.value, knowledge: revision.document.knowledge } : undefined;
  }
}
