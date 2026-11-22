import { OPERATIONS } from "@open-qa-stack/domain";
import type { Campaigns } from "../campaigns/campaigns.ts";
import type { Configuration } from "../configuration/configuration.ts";
import type { ModelConnection } from "../configuration/model-connection.ts";
import type { KnowledgeDocuments } from "../documents/knowledge-documents.ts";
import type { Executions } from "../executions/executions.ts";
import type { PastRuns } from "../executions/past-runs.ts";
import type { KnowledgeDomains } from "../knowledge/knowledge-domains.ts";
import type { KnowledgeMapping } from "../knowledge/knowledge-mapping.ts";
import type { KnowledgeSources } from "../knowledge/knowledge-sources.ts";
import type { RepositorySetup } from "../repository/repository-setup.ts";
import type { Secrets } from "../secrets/secrets.ts";
import type { Sessions } from "../sessions/sessions.ts";
import type { RepositoryTests } from "../tests/repository-tests.ts";
import type { TestReadings } from "../tests/test-readings.ts";

/** The classes of the engine whose methods a client or a host calls, by name. */
export interface EngineClasses {
  readonly Sessions: Sessions;
  readonly Configuration: Configuration;
  readonly ModelConnection: ModelConnection;
  readonly Secrets: Secrets;
  readonly RepositorySetup: RepositorySetup;
  readonly KnowledgeDocuments: KnowledgeDocuments;
  readonly KnowledgeDomains: KnowledgeDomains;
  readonly KnowledgeSources: KnowledgeSources;
  readonly KnowledgeMapping: KnowledgeMapping;
  readonly RepositoryTests: RepositoryTests;
  readonly TestReadings: TestReadings;
  readonly Executions: Executions;
  readonly PastRuns: PastRuns;
  readonly Campaigns: Campaigns;
}

/** The methods of each class of the engine, by the name of the class. */
type MethodsOf = { readonly [C in keyof EngineClasses]?: readonly (keyof EngineClasses[C] & string)[] };

/** The operations of the domain name methods of the classes of the engine: the compiler refuses one that is none. */
export const ENGINE_OPERATIONS: MethodsOf = OPERATIONS;

/**
 * The methods of the engine that a host calls, not a person: they are no operation, and no client offers them.
 *
 * - `Sessions.start` and `Sessions.stop`: a host starts the sessions and stops them as it starts and stops.
 * - `Configuration.inStep`: a host brings the configuration in step with its file as it starts.
 * - `Configuration.whenRecorded`: the operations on sessions map the knowledge of a source added once its revision is recorded.
 * - `Secrets.current`: the operations on sessions read the environment of the runs through it.
 * - `PastRuns.take`: a host keeps the runs of the repository as executions as it starts.
 * - `RepositoryTests.list`: the campaigns check the tests they choose against it.
 */
export const HOST_METHODS = {
  Sessions: ["start", "stop"],
  Configuration: ["inStep", "whenRecorded"],
  Secrets: ["current"],
  PastRuns: ["take"],
  RepositoryTests: ["list"],
} as const satisfies MethodsOf;
