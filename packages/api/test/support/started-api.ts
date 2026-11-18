import { environmentSettings } from "../../src/config/environment-settings.ts";
import { startApi } from "../../src/start-api.ts";
import type { ApiLogger, StartedApi } from "../../src/api-entry.ts";
import type { Environment } from "../../src/config/environment-variable.ts";

/**
 * Starts the API as its program does, from the variables of an environment, but for where it logs and for the
 * signals, which stay those of the tests.
 *
 * @param env - The variables the API is configured with.
 * @param logger - Where the API logs; nowhere by default.
 * @returns The API, listening.
 */
export function apiFrom(env: Environment, logger: ApiLogger | false = false): Promise<StartedApi> {
  return startApi({ ...environmentSettings(env), logger });
}
