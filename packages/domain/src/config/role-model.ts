import type { ModelRole, Model, ResolvedConfig } from "./types.ts";

/** The roles of agents that may each use a model of their own, in the order they work. */
export const MODEL_ROLES: readonly ModelRole[] = ["cartographer", "designer", "reviewer"];

/**
 * The model a role uses, through the connection of the configuration.
 *
 * @param model - The connection, with the models of its roles.
 * @param role - The role.
 * @returns The connection to the model of the role, which takes over nothing of what is tuned on the model of every
 * one; the connection as it is, without the models of the roles, for a role that has none.
 */
export function roleModel(model: Model, role: ModelRole): Model {
  const { roles, ...shared } = model;
  const own = roles?.[role];
  if (own === undefined) return shared;
  const { capabilities: _capabilities, reasoningEffort: _reasoningEffort, ...reach } = shared;
  return { ...reach, ...own };
}

/**
 * The configuration as a role reads it: its model is that of the role.
 *
 * @param config - The resolved configuration.
 * @param role - The role.
 */
export function roleConfig(config: ResolvedConfig, role: ModelRole): ResolvedConfig {
  return { ...config, model: roleModel(config.model, role) };
}
