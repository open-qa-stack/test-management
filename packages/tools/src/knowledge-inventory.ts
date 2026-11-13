import type { Knowledge } from "@open-qa-stack/shared";
import type { SourceInventory } from "./common/source-inventory.ts";
import { defaultSqlClient, type KnowledgeAccess } from "./knowledge-tools.ts";
import { contractInventory } from "./openapi/contract-inventory.ts";
import { OpenApiContract } from "./openapi/openapi-contract.ts";
import { DatabaseCatalog } from "./postgresql/database-catalog.ts";
import { databaseInventory } from "./postgresql/database-inventory.ts";
import { lazySqlClient } from "./postgresql/lazy-sql-client.ts";

/**
 * Reads what a knowledge source holds, without the model: its elements, their facts and its fingerprint.
 *
 * @param source - The knowledge source.
 * @param access - How to reach it.
 * @returns The inventory of a contract or a base; `undefined` for a kind of source that has none yet.
 * @throws Error when the source cannot be reached.
 */
export async function knowledgeInventory(source: Knowledge, access: KnowledgeAccess): Promise<SourceInventory | undefined> {
  switch (source.type) {
    case "openapi":
      return contractInventory(new OpenApiContract(source, access.repositoryRoot));
    case "postgresql":
      return databaseInventory(new DatabaseCatalog(lazySqlClient(source.connectionStringEnv, access.env, access.sqlClient ?? defaultSqlClient)));
    default:
      return undefined;
  }
}
