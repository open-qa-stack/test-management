import type { CharterSettings, ConfigError } from "@open-qa-stack/domain";
import type { ActiveRule, CharterRule } from "./charter-rule.ts";
import { DEFAULT_CHARTER } from "./default-charter.ts";

/** The rules to apply, or why the changes of the configuration are refused. */
export type CharterResolution = { ok: true; rules: ActiveRule[] } | { ok: false; errors: ConfigError[] };

/**
 * Applies the changes of the configuration to a charter.
 *
 * @remarks
 * Pure. The configuration has already been validated, so its identifiers are well formed and unique.
 *
 * @param settings - The `charter` section of the resolved configuration.
 * @param charter - The charter to change.
 * @returns The rules of the charter that stay enabled, then the added rules, each in its order; or an
 * error for each disabled identifier the charter lacks and each added identifier it already has.
 */
export function resolveCharter(settings: Required<CharterSettings>, charter: readonly CharterRule[] = DEFAULT_CHARTER): CharterResolution {
  const known = new Set(charter.map((rule) => rule.id));
  const errors: ConfigError[] = [];
  settings.disable.forEach((item, i) => {
    if (!known.has(item.rule)) {
      errors.push({
        kind: "reference",
        path: `/charter/disable/${i}/rule`,
        rule: "unknown-charter-rule",
        message: "No rule of the charter has this identifier.",
      });
    }
  });
  settings.add.forEach((item, i) => {
    if (known.has(item.id)) {
      errors.push({ kind: "structure", path: `/charter/add/${i}/id`, rule: "duplicate", message: "The identifier is already given to a rule of the charter." });
    }
  });
  if (errors.length > 0) return { ok: false, errors };

  const disabled = new Set(settings.disable.map((item) => item.rule));
  const kept = charter
    .filter((rule) => !disabled.has(rule.id))
    .map(({ id, statement, rationale, example }): ActiveRule => ({ id, statement, rationale, example }));
  const added = settings.add.map(({ id, statement, reason }): ActiveRule => ({ id, statement, rationale: reason }));
  return { ok: true, rules: [...kept, ...added] };
}
