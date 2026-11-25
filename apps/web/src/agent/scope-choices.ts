import type { ConfigurationView, KnowledgeDomain, SessionOpening, SessionScope, TestLevel } from "@open-qa-stack/domain/sessions";

/** The levels a design is asked for when the configuration names none. */
const DEFAULT_LEVELS: readonly TestLevel[] = ["smoke", "functional", "business"];

/** What a person may keep a session to: the environments, applications and levels the configuration declares, and the domains of the knowledge. */
export interface ScopeChoices {
  readonly environments: readonly string[];
  readonly applications: readonly { readonly id: string; readonly name: string }[];
  readonly domains: readonly KnowledgeDomain[];
  readonly levels: readonly TestLevel[];
}

/**
 * @param view - The configuration of the instance as it is now.
 * @param domains - The domains of the knowledge, those excluded left out of the choice.
 * @returns What a session may be kept to; nothing of the configuration without a revision in force.
 */
export function scopeChoicesOf({ revision }: Pick<ConfigurationView, "revision">, domains: readonly KnowledgeDomain[]): ScopeChoices {
  const applications = revision?.document.applications ?? [];
  return {
    environments: [...new Set(applications.flatMap(({ environments }) => environments.map(({ name }) => name)))],
    applications: applications.map(({ id, name }) => ({ id, name })),
    domains: domains.filter(({ excluded }) => excluded !== true),
    levels: revision === undefined ? [] : (revision.document.design?.levels ?? DEFAULT_LEVELS),
  };
}

/**
 * Reads the form of the entry of the agent: what to test, the environment, and what of the project to keep the work to.
 *
 * @param data - The fields of the form: `request`, `environment`, and each `application`, `domain` and `level` ticked.
 * @returns The opening of a session; `undefined` for a request that holds nothing but spaces.
 */
export function openingOf(data: FormData): SessionOpening | undefined {
  // A field the form holds is a text; a file, which none of these is, is read as nothing.
  const texts = (name: string): string[] => data.getAll(name).filter((value) => typeof value === "string");
  const request = (texts("request")[0] ?? "").trim();
  if (request === "") return undefined;
  const environment = texts("environment")[0] ?? "";
  const all = texts;
  const lists: [keyof SessionScope, string[]][] = [
    ["applications", all("application")],
    ["domains", all("domain")],
    ["levels", all("level")],
  ];
  const ticked = lists.filter(([, values]) => values.length > 0);
  return {
    request,
    ...(environment === "" ? {} : { environment }),
    ...(ticked.length === 0 ? {} : { scope: Object.fromEntries(ticked) as SessionScope }),
  };
}
