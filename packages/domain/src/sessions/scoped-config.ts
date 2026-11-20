import type { ResolvedConfig } from "../config/types.ts";
import type { SessionScope } from "./session.ts";

/** A configuration kept to the scope of a session, or why it cannot be. */
export type ScopedConfig = { readonly ok: true; readonly config: ResolvedConfig } | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Keeps a configuration to the scope of a session: the applications it names, and the levels it names among those the
 * configuration asks for. A list the scope leaves out, or leaves empty, keeps every one.
 *
 * @remarks
 * Pure. The domains of the scope are not read here: they are those of the knowledge, which the design reads.
 *
 * @param config - The resolved configuration.
 * @param scope - What of the project the session keeps its work to; none for the whole project.
 * @returns The configuration kept to it; or, for each application it names that the configuration does not declare and
 * each level the configuration does not ask for, why, with what may be named instead.
 */
export function scopedConfig(config: ResolvedConfig, scope: SessionScope | undefined): ScopedConfig {
  const applications = scope?.applications ?? [];
  const levels = scope?.levels ?? [];
  const declared = config.applications.map(({ id }) => id);
  const errors = [
    ...applications
      .filter((id) => !declared.includes(id))
      .map((id) => `The application ${id} is not declared: the configuration declares ${declared.join(", ")}.`),
    ...levels
      .filter((level) => !config.design.levels.includes(level))
      .map((level) => `The level ${level} is not asked for: the configuration asks for ${config.design.levels.join(", ")}.`),
  ];
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    config: {
      ...config,
      applications: applications.length === 0 ? config.applications : config.applications.filter(({ id }) => applications.includes(id)),
      design: { ...config.design, levels: levels.length === 0 ? config.design.levels : config.design.levels.filter((level) => levels.includes(level)) },
    },
  };
}
