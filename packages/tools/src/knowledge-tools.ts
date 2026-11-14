import { resolve } from "node:path";
import type { ToolDefinition } from "@open-qa-stack/domain";
import type { Knowledge } from "@open-qa-stack/shared";
import { DatabaseCatalog } from "./postgresql/database-catalog.ts";
import { DatabaseData } from "./postgresql/database-data.ts";
import { databaseTools } from "./postgresql/database-tools.ts";
import { DocumentSet } from "./document/document-set.ts";
import { documentTools } from "./document/document-tools.ts";
import { OpenApiContract } from "./openapi/openapi-contract.ts";
import { openApiTools } from "./openapi/openapi-tools.ts";
import { PgSqlClient } from "./postgresql/pg-sql-client.ts";
import type { SqlClient } from "./postgresql/sql-client.ts";
import { lazySqlClient } from "./postgresql/lazy-sql-client.ts";
import { CodeFolder } from "./source-code/code-folder.ts";
import { sourceCodeTools } from "./source-code/source-code-tools.ts";
import { ContainerLogs } from "./logs/container-logs.ts";
import { LogFile } from "./logs/log-file.ts";
import { logsTools } from "./logs/logs-tools.ts";

/** What the tools of knowledge sources need to reach them. */
export interface KnowledgeAccess {
  /** Absolute path of the test repository, against which contract, document and source code paths resolve. */
  readonly repositoryRoot: string;
  /** Environment holding the connection strings that database sources name. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Makes the SQL client of a database; PostgreSQL by default. */
  readonly sqlClient?: (connectionString: string) => SqlClient;
  /**
   * Values no log line may show: those of every environment variable the configuration names, as
   * `declaredValues` of `@open-qa-stack/shared` gives them. None by default.
   */
  readonly secrets?: readonly string[];
  /** The start of the task, from which the log tools read when the agent gives no instant; when the tools are made by default. */
  readonly taskStart?: Date;
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
  const taskStart = access.taskStart ?? new Date();
  return knowledge.flatMap((source) => {
    switch (source.type) {
      case "openapi":
        return openApiTools(source.id, new OpenApiContract(source, access.repositoryRoot));
      case "postgresql": {
        const client = lazySqlClient(source.connectionStringEnv, access.env, access.sqlClient ?? defaultSqlClient);
        const catalog = new DatabaseCatalog(client);
        return databaseTools(source.id, catalog, new DatabaseData(source.id, client, catalog));
      }
      case "document":
        return documentTools(source.id, new DocumentSet(access.repositoryRoot, source.path));
      case "source-code":
        return sourceCodeTools(source.id, new CodeFolder(resolve(access.repositoryRoot, source.path)), source.commands ?? "git");
      case "logs": {
        const log =
          source.path === undefined
            ? new ContainerLogs(source.engine, source.container)
            : new LogFile(resolve(access.repositoryRoot, source.path), source.path);
        return logsTools(source.id, log, taskStart, access.secrets ?? []);
      }
    }
  });
}

/** Reaches a database with PostgreSQL itself. */
export function defaultSqlClient(connectionString: string): SqlClient {
  return new PgSqlClient(connectionString);
}
