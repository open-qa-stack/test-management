import { ConfigurationError } from "./config/configuration-error.ts";
import { processEnvironment } from "./config/process-environment.ts";
import { DatabaseUnavailableError } from "./database/database-unavailable-error.ts";
import { MIGRATIONS_FOLDER } from "./database/migrations-folder.ts";
import { runMigrations } from "./database/run-migrations.ts";

try {
  process.stdout.write(`${await runMigrations(processEnvironment(), MIGRATIONS_FOLDER)}\n`);
} catch (error) {
  if (!(error instanceof ConfigurationError || error instanceof DatabaseUnavailableError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
