import { SLUG_PATTERN, type Knowledge, type Language, type Model, type OqasConfig, type SourceCheck } from "@open-qa-stack/domain";

/** What an application exposes: a user interface, an API, or both. */
export type Exposes = "web" | "api" | "web-and-api";

/** The kinds of knowledge the setting up offers: a contract of an API, the code, a database, documents. */
export const SOURCE_KINDS = ["openapi", "source-code", "postgresql", "documents"] as const;

/** A kind of knowledge the setting up offers. */
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** A knowledge source as the person declares it in the terminal, and what its test found. */
export interface DraftSource {
  readonly kind: SourceKind;
  /** Where it is read: the address or the path of a contract, the folder of the code; none for a database or documents. */
  readonly where?: string;
  /** For a database, the variable its connection string is kept under. */
  readonly variable?: string;
  /** For a database, the connection string typed, saved out of the test repository. */
  readonly value?: string;
  /** What its test found. */
  readonly check?: SourceCheck;
}

/** The project as the person sets it up in the terminal. */
export interface ProjectDraft {
  /** The name of the application to test. */
  readonly name: string;
  readonly exposes: Exposes;
  /** The address of its user interface, for one that has one. */
  readonly uiUrl?: string;
  /** The address of its API, for one that has one. */
  readonly apiUrl?: string;
  readonly sources: readonly DraftSource[];
  /** The connection to the model, once it is set. */
  readonly model?: Model;
  /** The key typed for the variable of the model, saved out of the test repository. */
  readonly key?: string;
}

/** The identifier of each kind of source, before a number tells apart two of the same kind. */
const SOURCE_IDS: Readonly<Record<SourceKind, string>> = { openapi: "api-contract", "source-code": "code", postgresql: "database", documents: "documents" };

/** The environment the setting up declares, which the person renames in the configuration when they wish. */
export const ENVIRONMENT = "local";

/**
 * The identifier of an application, made of its name: lower case letters and digits, separated by dashes.
 *
 * @param name - The name of the application.
 * @returns The identifier; `app` for a name that holds no letter nor digit.
 */
export function slugOf(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    // What is not a letter nor a digit is one dash already: at most one starts the slug, and one ends it.
    .replace(/^-/, "")
    .replace(/-$/, "");
  return new RegExp(SLUG_PATTERN).test(slug) ? slug : "app";
}

/** @returns Whether a text is an address the setting up takes: `http://` or `https://`. */
export function isAddress(text: string): boolean {
  return URL.canParse(text) && /^https?:$/.test(new URL(text).protocol);
}

/**
 * A knowledge source of the configuration, as a source of the draft declares it, attached to the application.
 *
 * @param source - The source of the draft.
 * @param id - Its identifier.
 * @param application - The identifier of the application.
 * @returns The source.
 */
export function knowledgeOf(source: DraftSource, id: string, application: string): Knowledge {
  const attachments = [{ application }];
  switch (source.kind) {
    case "openapi":
      return isAddress(source.where!) ? { id, type: "openapi", url: source.where!, attachments } : { id, type: "openapi", path: source.where!, attachments };
    case "source-code":
      return { id, type: "source-code", path: source.where!, attachments };
    case "postgresql":
      return { id, type: "postgresql", connectionStringEnv: source.variable!, attachments };
    case "documents":
      return { id, type: "document", stored: true, attachments };
  }
}

/** @returns The identifiers of the sources of the draft, each told apart from those of its kind before it by a number. */
export function sourceIds(sources: readonly DraftSource[]): string[] {
  return sources.map(({ kind }, index) => {
    const rank = sources.slice(0, index).filter((before) => before.kind === kind).length;
    return rank === 0 ? SOURCE_IDS[kind] : `${SOURCE_IDS[kind]}-${rank + 1}`;
  });
}

/**
 * The configuration the setting up writes: the application in one environment, the sources attached to it, the model.
 *
 * @param draft - The project as the person set it up, its model set.
 * @param language - The language the configuration speaks.
 * @returns The configuration.
 */
export function configOf(draft: ProjectDraft, language: Language): OqasConfig {
  const id = slugOf(draft.name);
  const environment = {
    name: ENVIRONMENT,
    ...(draft.uiUrl === undefined ? {} : { uiUrl: draft.uiUrl }),
    ...(draft.apiUrl === undefined ? {} : { apis: [{ name: "api", baseUrl: draft.apiUrl }] }),
  };
  const ids = sourceIds(draft.sources);
  return {
    formatVersion: 1,
    language,
    applications: [{ id, name: draft.name, type: draft.exposes, authentication: { method: "none" }, environments: [environment] }],
    knowledge: draft.sources.map((source, index) => knowledgeOf(source, ids[index]!, id)),
    model: draft.model!,
  } as OqasConfig;
}

/**
 * The values the setting up saves out of the test repository: the key of the model, the connection strings of the databases.
 *
 * @param draft - The project as the person set it up.
 * @returns Each value, by the name of its variable.
 */
export function valuesOf(draft: ProjectDraft): Record<string, string> {
  const values: Record<string, string> = {};
  for (const { variable, value } of draft.sources) if (variable !== undefined && value !== undefined) values[variable] = value;
  if (draft.key !== undefined && draft.model?.mode === "provider-key" && draft.model.apiKeyEnv !== undefined) values[draft.model.apiKeyEnv] = draft.key;
  return values;
}
