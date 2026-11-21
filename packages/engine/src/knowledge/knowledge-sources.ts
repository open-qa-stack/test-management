import { isStoredDocuments, type DocumentStorePort, type Knowledge, type SourceCheck } from "@open-qa-stack/domain";
import { knowledgeInventory, type KnowledgeAccess } from "@open-qa-stack/tools";
import { environmentOf } from "../secrets/environment-of.ts";
import { NoRepositoryError } from "../sessions/no-repository-error.ts";
import type { Environment, EnvironmentSource } from "../ports/environment-source.ts";

/**
 * The operations on the knowledge sources themselves: test that one answers, as the person drafts it, before anything
 * is saved or indexed. Whatever asks for it — the console, a command — calls this and holds no rule of its own.
 *
 * @remarks
 * A source answers when its inventory can be read, as the cartography reads it first: the contract is read as OpenAPI,
 * the database answers a query on its catalogue and no row of its data is read, the folder of the documents or of the
 * code is listed, the documents the instance keeps are counted. Logs are read while a session runs: they are not
 * tested. Nothing calls the model, and nothing is written.
 */
export class KnowledgeSources {
  readonly #repository: string | undefined;
  readonly #env: Environment | EnvironmentSource;
  readonly #documents: DocumentStorePort;
  readonly #sqlClient: KnowledgeAccess["sqlClient"];

  /**
   * @param repository - Absolute path of the test repository, against which the paths of the sources resolve; `undefined` for a host that has none.
   * @param env - The environment that holds the connection strings the sources name, or what reads it as it is at each test.
   * @param documents - The store of the documents the instance keeps.
   * @param sqlClient - Makes the SQL client of a database; PostgreSQL by default.
   */
  constructor(repository: string | undefined, env: Environment | EnvironmentSource, documents: DocumentStorePort, sqlClient?: KnowledgeAccess["sqlClient"]) {
    this.#repository = repository;
    this.#env = env;
    this.#documents = documents;
    this.#sqlClient = sqlClient;
  }

  /**
   * Tests that a knowledge source answers.
   *
   * @param source - The source, as the person drafts it.
   * @param typed - The connection string the person typed for a database, and did not save yet; that of its variable otherwise.
   * @returns What the test found: the source answers, with the number of items it holds, or why it does not; logs are not tested.
   * @throws {@link NoRepositoryError} when the host has no test repository to resolve the source in.
   */
  async check(source: Knowledge, typed?: string): Promise<SourceCheck> {
    if (source.type === "logs") return { state: "unchecked" };
    if (isStoredDocuments(source)) return { state: "ok", items: (await this.#documents.list(source.id)).length };
    if (this.#repository === undefined) throw new NoRepositoryError("No source can be tested");
    const env = await environmentOf(this.#env);
    const read = source.type === "postgresql" && typed ? { ...env, [source.connectionStringEnv]: typed } : env;
    try {
      const inventory = await knowledgeInventory(source, {
        repositoryRoot: this.#repository,
        env: read,
        ...(this.#sqlClient === undefined ? {} : { sqlClient: this.#sqlClient }),
      });
      return { state: "ok", items: inventory.items.length };
    } catch (failure) {
      return { state: "failed", reason: reasonOf(failure as Error) };
    }
  }
}

/** The message of a failure of the inventory, with its cause when the message does not tell it, as `fetch failed` does not. */
function reasonOf(failure: Error): string {
  const cause = failure.cause instanceof Error ? failure.cause.message : "";
  return cause === "" || failure.message.includes(cause) ? failure.message : `${failure.message}: ${cause}`;
}
