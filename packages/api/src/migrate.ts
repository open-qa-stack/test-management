import { Logger } from "@nestjs/common";
import { DatabaseUnavailableError, runMigrations } from "@open-qa-stack/store";
import { DATABASE_VARIABLES } from "./config/api-variables.ts";
import { ConfigurationError } from "./config/configuration-error.ts";
import { instanceDatabase } from "./config/instance-database.ts";
import { processEnvironment } from "./config/process-environment.ts";
import { readVariables } from "./config/read-variables.ts";

try {
  const { database, repository } = readVariables(DATABASE_VARIABLES, processEnvironment());
  process.stdout.write(`${await runMigrations(instanceDatabase(database, repository), new Logger("Database"))}\n`);
} catch (error) {
  if (!(error instanceof ConfigurationError || error instanceof DatabaseUnavailableError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
