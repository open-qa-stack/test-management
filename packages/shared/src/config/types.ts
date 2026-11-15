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
  /** What the agent that explores the user interface may do: change no data, `read-only` when absent, or submit the forms that create or change some. */
  exploration?: "read-only" | "read-write";
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
    { path: string; container?: never; engine?: never } | { container: string; engine: ContainerEngine; path?: never }
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

/** A rule of the default test charter the designer and the reviewer should not apply, with the reason. */
export interface DisabledCharterRule {
  rule: string;
  reason: string;
}

/** A rule the designer and the reviewer apply after the default ones. */
export interface AddedCharterRule {
  id: string;
  statement: string;
  reason: string;
}

/** Changes to the default test charter. */
export interface CharterSettings {
  disable?: DisabledCharterRule[];
  add?: AddedCharterRule[];
}

/** What a model can do besides reading and writing text: `vision`, it reads images. */
export type ModelCapability = "vision";

/** A model served by an OpenAI-compatible server, reached with a provider key. */
export interface ProviderKeyModel {
  mode: "provider-key";
  provider: "openai";
  baseUrl: string;
  model: string;
  apiKeyEnv?: string;
  capabilities?: ModelCapability[];
  reasoningEffort?: string;
  requestTimeoutSeconds?: number;
}

/** Connection to the model. */
export type Model = ProviderKeyModel;

/** The criteria that bound each task of a bounded level, each a positive integer; one at least is given. */
export interface TaskCriteria {
  /** Minutes a task may run. */
  maxMinutes?: number;
  /** Model calls a task may make. */
  maxIterations?: number;
  /** Browser actions a task may take. */
  maxActions?: number;
}

/**
 * How far the agents may go on their own: `autonomous`, with no limit per task, or `bounded` by the
 * criteria of `task`. `guardrailMinutes` is how long, from the start of a run, the tasks of its agents may
 * go on.
 */
export type Autonomy = { level: "autonomous"; guardrailMinutes?: number } | { level: "bounded"; task: TaskCriteria; guardrailMinutes?: number };

/** The configuration file as written by the user, once it matches the schema. */
export interface OqasConfig {
  $schema?: string;
  formatVersion: FormatVersion;
  applications: Application[];
  knowledge: Knowledge[];
  repository?: Repository;
  charter?: CharterSettings;
  cartography?: CartographySettings;
  design?: DesignSettings;
  model: Model;
  /** `autonomous` when absent. */
  autonomy?: Autonomy;
}

/** How the sources are mapped. */
export interface CartographySettings {
  /** Most sources mapped at once, each in its own task; one by default. */
  concurrency?: number;
}

/**
 * How the tests of a repository are built: `page-objects`, against the page objects of the screens, given by
 * the fixtures the tests share; `fixtures`, each line on the page, the applications given by those fixtures;
 * `standalone`, each test on its own, importing Playwright itself, nothing written beside it.
 */
export type TestArchitecture = "page-objects" | "fixtures" | "standalone";

/** How the tests are designed. */
export interface DesignSettings {
  /** How the tests are built; `page-objects` by default. */
  architecture?: TestArchitecture;
  /** Path of the file of the fixtures the tests share, relative to the root of the test repository; `shared/fixtures.ts` in the folder of the applications by default. */
  fixturesFile?: string;
  /** Whether an agent of its own reviews the scenarios of a plan for duplicates; `true` by default. */
  reviewPlan?: boolean;
  /** Whether an agent of its own reviews each test that passed against the scenario of its plan; `true` by default. */
  reviewTests?: boolean;
  /** Whether an agent of its own reviews the quality of the code of each test that passed; `true` by default. */
  reviewCode?: boolean;
  /** The levels of the pyramid of tests a plan is asked for; `smoke`, `functional` and `business` by default. */
  levels?: TestLevel[];
}

/** A level of the pyramid of tests, from its base to its top. */
export type TestLevel = "smoke" | "functional" | "business" | "cross-application" | "end-to-end";

/** A limit set to `null` is not bounded by the level. */
export interface ResolvedLimits {
  task: { maxIterations: number | null; maxMinutes: number | null; maxActions: number | null };
  /** How long, in minutes from the start of a run, the tasks of its agents may go on. */
  guardrailMinutes: number | null;
}

/** The configuration once validated, with every default applied. */
export interface ResolvedConfig {
  formatVersion: FormatVersion;
  applications: Application[];
  knowledge: Knowledge[];
  repository: Required<Repository>;
  charter: Required<CharterSettings>;
  cartography: Required<CartographySettings>;
  design: Required<DesignSettings>;
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
