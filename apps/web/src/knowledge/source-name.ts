import { attachmentsOf, type ConfiguredApplication, type Knowledge } from "@open-qa-stack/domain/sessions";
import { kindOf } from "../configuration/knowledge-card.tsx";
import { t } from "../i18n/i18n.ts";
import { nameIn } from "../applications/application-names.ts";

/**
 * Names the kind of a source in plain words: a database, the documentation of an API, code.
 *
 * @param source - The source.
 * @returns The name of its kind.
 */
export function kindName(source: Knowledge): string {
  return t(`configuration.knowledge.kinds.${kindOf(source)}`);
}

/**
 * Names a source for a person, who reads its identifier only where they look for it.
 *
 * @param source - The source.
 * @param applications - The applications of the configuration, which name those the source serves.
 * @returns Its kind, then the names of the applications it serves; its kind alone for a source of the whole project.
 */
export function sourceName(source: Knowledge, applications: readonly ConfiguredApplication[]): string {
  const served = [...new Set(attachmentsOf(source).map(({ application }) => nameIn(applications, application)))];
  return served.length === 0 ? kindName(source) : `${kindName(source)} · ${served.join(", ")}`;
}
