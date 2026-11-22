import { existingTests, type ExistingTest } from "@open-qa-stack/agents";
import {
  DEFAULT_REPOSITORY,
  testFacets,
  testIdOf,
  type ConfigurationQueries,
  type RepositoryTest,
  type RepositoryTestAnomaly,
  type RepositoryTestList,
  type TestStorePort,
} from "@open-qa-stack/domain";
import { declaredTests } from "@open-qa-stack/tools";

/**
 * The operation that lists the tests of the test repository, read from their files as they are now: whoever wrote
 * them, a design or a person. Whatever shows them — a REST API, a terminal — calls it and holds no rule of its own.
 *
 * @remarks
 * Nothing is kept: the files are read at each call, under the folder of the applications of the revision in force of
 * the configuration. Each test of a file is listed by its titles, as the runner reports it: a file of several tests gives
 * several. What a test is, beyond its file, its title and its steps, is what its tags say of it.
 *
 * A test that bears an identifier, its tag `@oqas-id-…`, is kept under it where the repository tells it is: one renamed
 * or moved since, by a person or by the console, keeps its history. An identifier two tests bear, such as that of a
 * test copied whole, names neither: each keeps the history of its place, and nothing follows either.
 */
export class RepositoryTests {
  readonly #repository: string | undefined;
  readonly #configuration: ConfigurationQueries;
  readonly #identities: TestStorePort;

  /**
   * @param repository - Absolute path of the test repository; `undefined` for a host that has none, which lists none.
   * @param configuration - What tells the revision in force of the configuration, which names the folder of the applications.
   * @param identities - What keeps the tests under their identifiers, with their history.
   */
  constructor(repository: string | undefined, configuration: ConfigurationQueries, identities: TestStorePort) {
    this.#repository = repository;
    this.#configuration = configuration;
    this.#identities = identities;
  }

  /** @returns The tests of the repository, in the order of their paths, then of their files; none without a repository or a revision in force. */
  async list(): Promise<RepositoryTest[]> {
    return [...(await this.listed()).items];
  }

  /**
   * @returns The tests of the repository, in the order of their paths, then of their files, with what keeps some files
   * from being listed as they are: a title two of their tests share, or a syntax error. A file whose tests cannot be
   * read, or which names none by a plain title, is listed whole, under its path, as before it was read test by test.
   */
  async listed(): Promise<RepositoryTestList> {
    const revision = await this.#configuration.inForce();
    if (this.#repository === undefined || revision === undefined) return { items: [], anomalies: [] };
    const files = await existingTests(this.#repository, revision.document.repository?.appsDir ?? DEFAULT_REPOSITORY.appsDir);
    const items: RepositoryTest[] = [];
    const anomalies: RepositoryTestAnomaly[] = [];
    for (const file of files) {
      const { tests, duplicates, unreadable } = await declaredTests(file.content);
      if (unreadable) anomalies.push({ kind: "unreadable", path: file.path });
      anomalies.push(...duplicates.map((title) => ({ kind: "duplicate" as const, path: file.path, title })));
      if (tests.length === 0) items.push(listed(file, file.title, file.steps, file.tags));
      else items.push(...tests.map((test) => listed(file, test.title, test.steps, test.tags)));
    }
    const borne = items.flatMap(({ id }) => (id === undefined ? [] : [id]));
    const unique = items.filter(({ id }) => id !== undefined && borne.indexOf(id) === borne.lastIndexOf(id));
    await this.#identities.identify(unique.map(({ id, path, title }) => ({ id: id!, path, title })));
    return { items, anomalies };
  }
}

/** A test of a file, as the list gives it. */
function listed({ path }: ExistingTest, title: string, steps: readonly string[], tags: readonly string[]): RepositoryTest {
  const id = testIdOf(tags);
  return { path, title, ...(id === undefined ? {} : { id }), steps, tags, ...testFacets(tags) };
}
