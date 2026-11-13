import { resolve } from "node:path";
import type { MappedKnowledge } from "@open-qa-stack/shared";
import { readRepositoryFile } from "./common/repository-file.ts";
import type { SourceInventory } from "./common/source-inventory.ts";
import { documentInventory } from "./document/document-inventory.ts";
import { defaultSqlClient, type KnowledgeAccess } from "./knowledge-tools.ts";
import { contractInventory } from "./openapi/contract-inventory.ts";
import { OpenApiContract } from "./openapi/openapi-contract.ts";
import { DatabaseCatalog } from "./postgresql/database-catalog.ts";
import { databaseInventory } from "./postgresql/database-inventory.ts";
import { lazySqlClient } from "./postgresql/lazy-sql-client.ts";
import { CodeFolder } from "./source-code/code-folder.ts";
import { codeInventory } from "./source-code/code-inventory.ts";

/**
 * Reads what a knowledge source holds, without the model: its elements, their facts and its fingerprint.
 *
 * @param source - The knowledge source; logs have no inventory.
 * @param access - How to reach it.
 * @returns The inventory of the source.
 * @throws Error when the source cannot be reached.
 */
export async function knowledgeInventory(source: MappedKnowledge, access: KnowledgeAccess): Promise<SourceInventory> {
  switch (source.type) {
    case "openapi":
      return contractInventory(new OpenApiContract(source, access.repositoryRoot));
    case "postgresql":
      return databaseInventory(new DatabaseCatalog(lazySqlClient(source.connectionStringEnv, access.env, access.sqlClient ?? defaultSqlClient)));
    case "document":
      return documentInventory(await readRepositoryFile(access.repositoryRoot, source.path));
    case "source-code":
      return codeInventory(new CodeFolder(resolve(access.repositoryRoot, source.path)));
  }
}
