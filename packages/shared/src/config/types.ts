/** Version of the configuration file format, independent of the product version. */
export type FormatVersion = 1;

export type ApplicationType = "web" | "api" | "web-and-api";

export type AuthenticationMethod = "none" | "form";

export interface Account {
  name: string;
  usernameEnv: string;
  passwordEnv: string;
}

export interface Authentication {
  method: AuthenticationMethod;
  accounts?: Account[];
}

export interface NamedApi {
  name: string;
  baseUrl: string;
}

export interface Environment {
  name: string;
  uiUrl?: string;
  apis?: NamedApi[];
}

export interface Application {
  id: string;
  name: string;
  type: ApplicationType;
  authentication: Authentication;
  environments: Environment[];
}

/** Where a knowledge source belongs: an application, optionally narrowed to one of its environments and APIs. */
export interface Attachment {
  application: string;
  environment?: string;
  api?: string;
}

interface KnowledgeBase {
  id: string;
  attachments: Attachment[];
}

/** An OpenAPI contract, served at a URL or stored in the repository: exactly one of the two. */
export type OpenApiKnowledge = KnowledgeBase & { type: "openapi" } & ({ url: string; path?: never } | { path: string; url?: never });

export interface PostgresqlKnowledge extends KnowledgeBase {
  type: "postgresql";
  connectionStringEnv: string;
}

export interface DocumentKnowledge extends KnowledgeBase {
  type: "document";
  path: string;
}

export type Knowledge = OpenApiKnowledge | PostgresqlKnowledge | DocumentKnowledge;

export interface Repository {
  appsDir?: string;
  blocksDir?: string;
  journeysDir?: string;
  stateDir?: string;
  indexDir?: string;
}

export interface ProviderKeyModel {
  mode: "provider-key";
  provider: "openai";
  baseUrl: string;
  model: string;
  apiKeyEnv?: string;
}

export type Model = ProviderKeyModel;

export interface CustomLimits {
  task: { maxIterations: number; maxDurationMinutes: number; maxActions: number };
  batch: { maxTests: number; maxIdleRounds: number };
  guardrailMinutes: number;
}

export type Autonomy =
  | { level: "supervised" }
  | { level: "autonomous" }
  | ({ level: "custom" } & CustomLimits);

/** The configuration file as written by the user, once it matches the schema. */
export interface OqasConfig {
  $schema?: string;
  formatVersion: FormatVersion;
  applications: Application[];
  knowledge: Knowledge[];
  repository?: Repository;
  model: Model;
  autonomy: Autonomy;
}

/** A limit set to `null` is not bounded by the level. */
export interface ResolvedLimits {
  task: { maxIterations: number | null; maxDurationMinutes: number | null; maxActions: number | null };
  /** `stopOnPlateau` asks to stop once new tests stop coming; how that is detected is not defined yet. */
  batch: { maxTests: number | null; maxIdleRounds: number | null; stopOnPlateau: boolean };
  guardrailMinutes: number | null;
}

export interface ResolvedConfig {
  formatVersion: FormatVersion;
  applications: Application[];
  knowledge: Knowledge[];
  repository: Required<Repository>;
  model: Model;
  autonomy: { level: Autonomy["level"]; limits: ResolvedLimits };
}

export type ConfigErrorKind = "syntax" | "structure" | "reference" | "environment";

export interface ConfigError {
  kind: ConfigErrorKind;
  /** JSON Pointer (RFC 6901) to the offending location; the empty string designates the whole document. */
  path: string;
  /** Short identifier of the rule that was violated, stable across releases. */
  rule: string;
  message: string;
}

export type ValidationResult = { ok: true; config: ResolvedConfig } | { ok: false; errors: ConfigError[] };
