import type { Environment, EnvironmentSource } from "../ports/environment-source.ts";

/**
 * @param env - An environment, or what reads it.
 * @returns The environment as it is now.
 */
export function environmentOf(env: Environment | EnvironmentSource): Promise<Environment> {
  // A variable named current holds a text: only a source has a function there.
  return typeof env["current"] === "function" ? (env as EnvironmentSource).current() : Promise.resolve(env as Environment);
}
