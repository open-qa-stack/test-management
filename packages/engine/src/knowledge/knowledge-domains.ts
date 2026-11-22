import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_REPOSITORY, indexSourceApplications, validateDomainIndex, type ConfigurationQueries, type KnowledgeDomain } from "@open-qa-stack/domain";

/** The file of the domain index, in its folder. */
const INDEX_FILE = "domain-index.json";

/**
 * The domains of the knowledge of the project, as the last cartography wrote them in the test repository: what a session
 * may keep its work to.
 */
export class KnowledgeDomains {
  readonly #repository: string | undefined;
  readonly #configuration: ConfigurationQueries;

  /**
   * @param repository - Absolute path of the test repository; `undefined` for a host that has none.
   * @param configuration - The revision in force, which names the folder of the index.
   */
  constructor(repository: string | undefined, configuration: ConfigurationQueries) {
    this.#repository = repository;
    this.#configuration = configuration;
  }

  /**
   * @returns The domains of the index, in its order, each with its sources and the applications each describes, as the
   * configuration in force attaches them; none without a test repository, a configuration, or an index that can be read.
   */
  async list(): Promise<KnowledgeDomain[]> {
    const revision = await this.#configuration.inForce();
    if (this.#repository === undefined || revision === undefined) return [];
    const { indexDir } = { ...DEFAULT_REPOSITORY, ...revision.document.repository };
    const text = await readFile(join(this.#repository, indexDir, INDEX_FILE), "utf8").catch(() => "");
    let content: unknown;
    try {
      content = JSON.parse(text);
    } catch {
      return [];
    }
    const index = validateDomainIndex(content);
    if (!index.ok) return [];
    const { sources } = index.value;
    // A valid index lists every source it refers to.
    const applicationsOf = (source: string) =>
      indexSourceApplications(
        sources.find((candidate) => candidate.id === source)!,
        revision.document.knowledge,
      );
    return index.value.domains.map(({ id, label, description, references }) => ({
      id,
      label,
      description,
      sources: references.map(({ source, items }) => ({ id: source, applications: applicationsOf(source), items })),
    }));
  }
}
