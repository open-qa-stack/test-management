import { DatabaseUnavailableError } from "@open-qa-stack/store";
import { ConfigurationError } from "./config/configuration-error.ts";
import { processEnvironment } from "./config/process-environment.ts";
import { PendingMigrationsError } from "./database/pending-migrations-error.ts";
import { startApi } from "./start-api.ts";

try {
  await startApi(processEnvironment());
} catch (error) {
  if (!(error instanceof ConfigurationError || error instanceof PendingMigrationsError || error instanceof DatabaseUnavailableError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
