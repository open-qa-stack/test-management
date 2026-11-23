import type { ConfigError, OqasConfig, RevisionOrigin } from "@open-qa-stack/domain/sessions";
import { t, type Words } from "../i18n/i18n.ts";
import { valueAt } from "./json-pointer.ts";

/**
 * Words an error of the configuration for the person.
 *
 * @param error - The error, as the instance found it.
 * @param draft - The configuration it was found in: a field left empty is said to be one to fill, whatever rule it breaks.
 * @returns The wording of the console for a rule it knows; the message of the instance otherwise.
 */
export function errorText(error: ConfigError, draft?: OqasConfig): string {
  if (draft !== undefined && valueAt(draft, error.path) === "") return t("configuration.rules.required");
  return t(`configuration.rules.${error.rule as keyof Words["configuration"]["rules"]}`, { defaultValue: error.message });
}

/**
 * Says where a revision comes from.
 *
 * @param origin - Its origin.
 * @returns It in the words of the console.
 */
export function originText(origin: RevisionOrigin): string {
  return t(`configuration.origins.${origin}`);
}
