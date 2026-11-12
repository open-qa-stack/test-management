import type { ToolDefinition } from "@open-qa-stack/domain";
import type { Knowledge } from "@open-qa-stack/shared";
import { DatabaseCatalog } from "./database-catalog.ts";
import { DatabaseData } from "./database-data.ts";
import { databaseTools } from "./database-tools.ts";
import { documentTools } from "./document-tools.ts";
import { OpenApiContract } from "./openapi-contract.ts";
import { openApiTools } from "./openapi-tools.ts";
import { PgSqlClient } from "./pg-sql-client.ts";
import type { SqlClient } from "./sql-client.ts";

/** What the tools of knowledge sources need to reach them. */
export interface KnowledgeAccess {
  /** Absolute path of the test repository, against which contract and document paths resolve. */
  readonly repositoryRoot: string;
  /** Environment holding the connection strings that database sources name. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Makes the SQL client of a database; PostgreSQL by default. */
  readonly sqlClient?: (connectionString: string) => SqlClient;
}

/**
 * Gives each declared knowledge source its tools, and only its tools.
 *
 * @remarks
 * Every tool is bound to its source. A source that cannot be reached does not fail the session: the
 * call fails, and the model is told. A database whose connection string is not set fails the same way,
 * when called. Which sources a session gets, given their attachments, is for the caller to choose.
 *
 * @param knowledge - The knowledge sources of the configuration.
 * @param access - How to reach them.
 * @returns The tools, source after source.
 */
export function knowledgeTools(knowledge: readonly Knowledge[], access: KnowledgeAccess): ToolDefinition[] {
  const sqlClient = access.sqlClient ?? ((connectionString: string) => new PgSqlClient(connectionString));
  return knowledge.flatMap((source) => {
    switch (source.type) {
      case "openapi":
        return openApiTools(source.id, new OpenApiContract(source, access.repositoryRoot));
      case "postgresql": {
        const client = lazySqlClient(source.connectionStringEnv, access.env, sqlClient);
        const catalog = new DatabaseCatalog(client);
        return databaseTools(source.id, catalog, new DatabaseData(source.id, client, catalog));
      }
      case "document":
        return documentTools(source.id, access.repositoryRoot, source.path);
    }
  });
}

/** A client that reads its connection string only when a query runs, so that a missing one fails the call. */
function lazySqlClient(variable: string, env: KnowledgeAccess["env"], make: (connectionString: string) => SqlClient): SqlClient {
  return {
    query: (text, values) => {
      const connectionString = env[variable];
      if (connectionString === undefined || connectionString === "") {
        return Promise.reject(new Error(`Environment variable ${variable} is not set.`));
      }
      return make(connectionString).query(text, values);
    },
  };
}
