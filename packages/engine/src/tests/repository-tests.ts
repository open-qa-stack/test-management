import { existingTests } from "@open-qa-stack/agents";
import { DEFAULT_REPOSITORY, testFacets, type ConfigurationQueries, type RepositoryTest } from "@open-qa-stack/domain";

/**
 * The operation that lists the tests of the test repository, read from their files as they are now: whoever wrote
 * them, a design or a person. Whatever shows them — a REST API, a terminal — calls it and holds no rule of its own.
 *
 * @remarks
 * Nothing is kept: the files are read at each call, under the folder of the applications of the revision in force of
 * the configuration. What a test is, beyond its file, its title and its steps, is what its tags say of it.
 */
export class RepositoryTests {
  readonly #repository: string | undefined;
  readonly #configuration: ConfigurationQueries;

  /**
   * @param repository - Absolute path of the test repository; `undefined` for a host that has none, which lists none.
   * @param configuration - What tells the revision in force of the configuration, which names the folder of the applications.
   */
  constructor(repository: string | undefined, configuration: ConfigurationQueries) {
    this.#repository = repository;
    this.#configuration = configuration;
  }

  /** @returns The tests of the repository, in the order of their paths; none without a repository or a revision in force. */
  async list(): Promise<RepositoryTest[]> {
    const revision = await this.#configuration.inForce();
    if (this.#repository === undefined || revision === undefined) return [];
    const tests = await existingTests(this.#repository, revision.document.repository?.appsDir ?? DEFAULT_REPOSITORY.appsDir);
    return tests.map(({ path, title, steps, tags }) => ({ path, title, steps, tags, ...testFacets(tags) }));
  }
}
