/** Version of the configuration file format, independent of the product version. */
export type FormatVersion = 1;

/** What an application exposes: a user interface, an API, or both. */
export type ApplicationType = "web" | "api" | "web-and-api";

/** How a user signs in to an application. */
export type AuthenticationMethod = "none" | "form";

/** A test account, given by the environment variables that hold its credentials. */
export interface Account {
  name: string;
  usernameEnv: string;
  passwordEnv: string;
}

/** How users sign in to an application, and the test accounts to use. */
export interface Authentication {
  method: AuthenticationMethod;
  accounts?: Account[];
}

/** An API of an environment, named so that knowledge sources can refer to it. */
export interface NamedApi {
  name: string;
  baseUrl: string;
}

/** Where an application runs: its user interface and its APIs. */
export interface Environment {
  name: string;
  uiUrl?: string;
  apis?: NamedApi[];
}

/** An application under test. */
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

/** A PostgreSQL database, given by the variable that holds its connection string. */
export interface PostgresqlKnowledge extends KnowledgeBase {
  type: "postgresql";
  connectionStringEnv: string;
}

/** A document stored in the repository, such as a specification. */
export interface DocumentKnowledge extends KnowledgeBase {
  type: "document";
  path: string;
}

/**
 * Commands the agents may run in a source code folder, from the safest to the riskiest: none, the git
 * history only, or any shell command.
 */
export type SourceCodeCommands = "none" | "git" | "shell";

/** The source code of an application, in a folder of the workstation, possibly outside the test repository. */
export interface SourceCodeKnowledge extends KnowledgeBase {
  type: "source-code";
  path: string;
  commands?: SourceCodeCommands;
}

/** A container engine whose command line reads the logs of a container. */
export type ContainerEngine = "podman" | "docker";

/**
 * The logs of a service: a file of the workstation, or a container read by the command of its engine;
 * exactly one of the two.
 */
export type LogsKnowledge = KnowledgeBase & { type: "logs" } & (
    | { path: string; container?: never; engine?: never }
    | { container: string; engine: ContainerEngine; path?: never }
  );

/** Something the agents may read about the applications. */
export type Knowledge = OpenApiKnowledge | PostgresqlKnowledge | DocumentKnowledge | SourceCodeKnowledge | LogsKnowledge;

/**
 * The knowledge sources a cartography maps into domains: all but logs, which tell what a service did, not
 * what an application holds.
 */
export type MappedKnowledge = Exclude<Knowledge, LogsKnowledge>;

/** Layout of the test repository; every folder is relative to its root. */
export interface Repository {
  appsDir?: string;
  blocksDir?: string;
  journeysDir?: string;
  stateDir?: string;
  indexDir?: string;
}

/** A model served by an OpenAI-compatible server, reached with a provider key. */
export interface ProviderKeyModel {
  mode: "provider-key";
  provider: "openai";
  baseUrl: string;
  model: string;
  apiKeyEnv?: string;
}

/** Connection to the model. */
export type Model = ProviderKeyModel;

/** Limits of a custom autonomy level, each a positive integer. */
export interface CustomLimits {
  task: { maxIterations: number; maxDurationMinutes: number; maxActions: number };
  batch: { maxTests: number; maxIdleRounds: number };
  guardrailMinutes: number;
}

/** How far the agents may go on their own. */
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

/** The configuration once validated, with every default applied. */
export interface ResolvedConfig {
  formatVersion: FormatVersion;
  applications: Application[];
  knowledge: Knowledge[];
  repository: Required<Repository>;
  model: Model;
  autonomy: { level: Autonomy["level"]; limits: ResolvedLimits };
}

/** Family of a configuration error. */
export type ConfigErrorKind = "syntax" | "structure" | "reference" | "environment";

/** Why a configuration file is refused. */
export interface ConfigError {
  kind: ConfigErrorKind;
  /** JSON Pointer (RFC 6901) to the offending location; the empty string designates the whole document. */
  path: string;
  /** Short identifier of the rule that was violated, stable across releases. */
  rule: string;
  message: string;
}

/** The outcome of `validateConfig`: the configuration, or every error found. */
export type ValidationResult = { ok: true; config: ResolvedConfig } | { ok: false; errors: ConfigError[] };
