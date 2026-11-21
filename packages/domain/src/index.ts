export type { AgentEvent, TerminalEvent } from "./agent/agent-event.ts";
export type { AgentRuntime, SessionOptions } from "./agent/agent-runtime.ts";
export type { AgentSession } from "./agent/agent-session.ts";
export { AgentRuntimeError } from "./agent/errors/agent-runtime-error.ts";
export { ModelResponseError } from "./agent/errors/model-response-error.ts";
export { ModelKeyRefusedError } from "./agent/errors/model-key-refused-error.ts";
export { ModelUnreachableError } from "./agent/errors/model-unreachable-error.ts";
export { ReplayMissError } from "./agent/errors/replay-miss-error.ts";
export { SessionClosedError } from "./agent/errors/session-closed-error.ts";
export type { StopReason, TaskCounters, TaskLimits } from "./agent/task-limits.ts";
export type { JsonSchema, ToolDefinition } from "./agent/tool-definition.ts";
export { isRecord, parseJson, textOf } from "./json.ts";
export { byCodeUnits } from "./text-order.ts";
export { imageTokens, PIXELS_PER_TOKEN } from "./image/image-tokens.ts";
export { ImageToolResult } from "./image/image-tool-result.ts";
export { pngSize, type ImageSize } from "./image/png-size.ts";
export type { CharterFinding, CompilerFinding, FindingPosition, ProposedTest, TestCheck, TestFinding } from "./test/test-check.ts";
export type { Verdict } from "./test/verdict.ts";
export type { CommandOutcome, CommandRunner, StepCommand } from "./test/command-runner.ts";
export { lockedPlaywrightVersion } from "./test/playwright-version.ts";
export type { AttemptStatus, ListedTest, ReportedAttempt, ReportedStatus, ReportedTest } from "./test/reported-test.ts";
export {
  reportEntries,
  type JsonAttachment,
  type JsonError,
  type JsonResult,
  type JsonSpec,
  type JsonStep,
  type JsonSuite,
  type JsonTest,
  type ReportEntry,
} from "./report/json-report.ts";
export { qaViews, type QaCapture, type QaDetails, type QaStep, type QaView, type QaViews } from "./report/qa-view.ts";
export { networkFailureAddresses, testVerdicts, type RunFacts, type TestVerdict } from "./test/test-verdicts.ts";
export type { TestReference, TestRunner, TestTrial, TriedTest } from "./test/test-runner.ts";
export type {
  DuplicateOrigin,
  PlanDecision,
  PlanEnd,
  ExpectedElement,
  PlannedLine,
  PlannedExpect,
  PlannedScenario,
  PlannedScreenshot,
  PlannedStep,
  PlanReview,
  ScenarioCase,
  ScenarioEffect,
  ScenarioKind,
  ScenarioLevel,
  ScenarioSource,
  ScenarioValue,
  SetAsideScenario,
  TestPlan,
  UncoveredRequest,
} from "./test/test-plan.ts";
export { resolveLimits } from "./config/autonomy.ts";
export { baseUrlVariable } from "./config/base-url-variable.ts";
export { declaredValues, declaredVariables, secretVariables, type DeclaredVariable, type VariableSections } from "./config/declared-variables.ts";
export { CONFIG_FILE_NAME, DATABASE_FILE_NAME, STATE_DIR_NAME } from "./config/file-names.ts";
export { configurationText } from "./config/configuration-text.ts";
export { DEFAULT_LANGUAGE, LANGUAGES, languageOf } from "./config/language.ts";
export { readsImages } from "./config/model-capabilities.ts";
export type { ModelChoice, ModelConnectionCheck } from "./config/model-connection.ts";
export { GITHUB_COPILOT_URL, modelOrigin, type ModelOrigin } from "./config/model-origin.ts";
export { MODEL_PROVIDERS, providerOf, type ModelProvider } from "./config/model-providers.ts";
export { CHARTER_RULE_ID_PATTERN, configSchema, CONTAINER_NAME_PATTERN, ENV_VAR_PATTERN, SLUG_PATTERN } from "./config/schema.ts";
export type * from "./config/types.ts";
export {
  declaredStateDir,
  DEFAULT_REPOSITORY,
  isKnowledgeSource,
  isModel,
  resolvedConfig,
  validateConfig,
  type EnvironmentVariables,
} from "./config/validate.ts";
export { placementErrors, unplacedItems, type SourceInventory } from "./domain-index/placement.ts";
export { domainIndexSchema, domainSubmissionSchema } from "./domain-index/schema.ts";
export type * from "./domain-index/types.ts";
export { validateDomainIndex, validateDomainSubmission } from "./domain-index/validate.ts";
export { sourceCardSchema, sourceCardSubmissionSchema } from "./source-card/schema.ts";
export type * from "./source-card/types.ts";
export { validateSourceCard, validateSourceCardSubmission } from "./source-card/validate.ts";
export { placementSubmissionSchema, sourceManifestSchema } from "./source-manifest/schema.ts";
export type * from "./source-manifest/types.ts";
export { validatePlacementSubmission, validateSourceManifest } from "./source-manifest/validate.ts";
export {
  applicationClass,
  applicationPages,
  PAGES_FOLDER,
  PAGES_INDEX,
  screenMember,
  SHARED_FOLDER,
  TESTS_FOLDER,
  type ScreenClass,
} from "./test-repository/application-pages.ts";
export { applicationVariable, camelName, className } from "./test-repository/application-variable.ts";
export { appsFrom, sharedFixtures } from "./test-repository/shared-fixtures.ts";
export { tabVariable } from "./test-repository/tab-variable.ts";
export { ExitCode, type ExitCodeValue } from "./run/exit-code.ts";
export type { ModelUsage } from "./run/model-usage.ts";
export { PERSON_TAG, personTags, type PersonMessage } from "./run/person-message.ts";
export { entryLine, type RunEntry, type RunScope, type Step } from "./run/run-entry.ts";
export type { RunState } from "./run/run-state.ts";
export { runFolderDate, runIdAt, RUNS_FOLDER, traceFile, TRACES_FOLDER } from "./run/state-folder.ts";
export { withoutClosing } from "./run/tag-closing.ts";
export type { HarnessEvent, PhaseOutcome, TracedAgentEvent, TraceLine, TracePhase } from "./run/trace-line.ts";
export { journalLine, traceLine } from "./run-thread/run-lines.ts";
export { sessionResultOf } from "./run-thread/run-result.ts";
export { RunThread } from "./run-thread/run-thread.ts";
export type { CommandStep, RelayedPhase, RunLine, RunLineEvent } from "./run-thread/thread-line.ts";
export { MessageNotPendingError } from "./session-life/message-not-pending-error.ts";
export type { PendingMessage } from "./session-life/pending-message.ts";
export type { AddressedCommand, SessionCommand } from "./session-life/session-command.ts";
export type { SessionCommands } from "./session-life/session-commands.ts";
export { SessionEndedError } from "./session-life/session-ended-error.ts";
export { accepts, ASKED_STATE, isTerminal, nextState, refusalOf, SESSION_LIFE } from "./session-life/session-life.ts";
export type { SessionQueries } from "./session-life/session-queries.ts";
export type { SessionRefusal } from "./session-life/session-refusal.ts";
export { SessionStateError } from "./session-life/session-state-error.ts";
export type { SessionStorePort } from "./session-life/session-store-port.ts";
export { UnknownSessionError } from "./session-life/unknown-session-error.ts";
export type { ConfigurationCommands } from "./configuration-life/configuration-commands.ts";
export { ConfigurationConflictError } from "./configuration-life/configuration-conflict-error.ts";
export type { ConfigurationQueries } from "./configuration-life/configuration-queries.ts";
export type { ConfigurationRevision, RevisionEntry, RevisionOrigin, RevisionSummary } from "./configuration-life/configuration-revision.ts";
export type { ConfigurationStorePort } from "./configuration-life/configuration-store-port.ts";
export type { ConfigurationView } from "./configuration-life/configuration-view.ts";
export { fileStateOf, type FileState } from "./configuration-life/file-state.ts";
export { InvalidConfigurationError } from "./configuration-life/invalid-configuration-error.ts";
export { NoConfigurationError } from "./configuration-life/no-configuration-error.ts";
export { revisionDocument, type RevisionDocument } from "./configuration-life/revision-document.ts";
export { StaleRevisionError } from "./configuration-life/stale-revision-error.ts";
export type { DocumentStorePort } from "./knowledge-documents/document-store-port.ts";
export { InvalidDocumentsError } from "./knowledge-documents/invalid-documents-error.ts";
export type { DocumentEntry, DocumentList, StoredDocument, StoredDocumentSummary } from "./knowledge-documents/stored-document.ts";
export type { RepositoryTest, RepositoryTestAnomaly, RepositoryTestList } from "./repository-tests/repository-test.ts";
export type {
  Execution,
  ExecutionFailure,
  ExecutionList,
  ExecutionOrigin,
  ExecutionOutcome,
  ExecutionQuery,
  ExecutionResult,
  ExecutionVerdict,
  TestExecution,
  TestExecutionList,
} from "./executions/execution.ts";
export { versionStep, type TestVersion, type TestVersionList, type VersionStep } from "./executions/test-version.ts";
export { UnknownExecutionError } from "./executions/unknown-execution-error.ts";
export type { EndedLaunch, FinishedTest, LaunchProgress, LaunchRequest, LaunchState, TestLaunch } from "./executions/test-launch.ts";
export { LaunchRefusedError } from "./executions/launch-refused-error.ts";
export { launchProgress } from "./executions/launch-progress.ts";
export { scopedConfig, type ScopedConfig } from "./sessions/scoped-config.ts";
export type {
  Campaign,
  CampaignCounts,
  CampaignLaunchScope,
  CampaignList,
  CampaignOverview,
  CampaignPlan,
  CampaignProgress,
  CampaignResult,
  CampaignStatus,
  CampaignTest,
  CampaignVerdict,
} from "./campaigns/campaign.ts";
export { campaignCounts, campaignResults, campaignTransition, campaignVerdict, chosenTests } from "./campaigns/campaign-rules.ts";
export { CampaignRefusedError } from "./campaigns/campaign-refused-error.ts";
export { UnknownCampaignError } from "./campaigns/unknown-campaign-error.ts";
export { OPERATIONS, operationIds, type OperationId } from "./operations/operations.ts";
export { declaredSecrets } from "./secrets/declared-secrets.ts";
export type { SourceCheck } from "./knowledge-check/source-check.ts";
export { SecretRefusedError } from "./secrets/secret-refused-error.ts";
export type { SecretKind, SecretList, SecretSource, SecretState } from "./secrets/secret-state.ts";
export { UnknownSecretError } from "./secrets/unknown-secret-error.ts";
export type { CampaignStorePort } from "./campaigns/campaign-store-port.ts";
export { executionResults } from "./executions/execution-results.ts";
export type { ExecutionStorePort } from "./executions/execution-store-port.ts";
export { testFacets, type TestFacets } from "./repository-tests/test-facets.ts";
export type { TestReading } from "./repository-tests/test-reading.ts";
export { UnknownCaptureError } from "./repository-tests/unknown-capture-error.ts";
export { UnknownTraceError } from "./repository-tests/unknown-trace-error.ts";
export { isStoredDocuments, STORED_DOCUMENTS_FOLDER, storedDocumentSources, storedDocumentsPath } from "./knowledge-documents/stored-documents-path.ts";
export { UnknownDocumentError } from "./knowledge-documents/unknown-document-error.ts";
export { UnknownDocumentSourceError } from "./knowledge-documents/unknown-document-source-error.ts";
export {
  DOCUMENT_EXTENSIONS,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_NAME_LENGTH,
  MAX_DOCUMENTS_PER_UPLOAD,
  readUpload,
  uploadErrors,
  type ReceivedFile,
  type UploadedFile,
  type UploadReading,
} from "./knowledge-documents/uploaded-documents.ts";
export type { KnowledgeDomain, KnowledgeDomainList } from "./domain-index/knowledge-domain.ts";
export {
  GENERAL_DOMAIN,
  MEMORY_KINDS,
  type FoundMemory,
  type Memory,
  type MemoryContent,
  type MemoryFilter,
  type MemoryKind,
  type MemoryOrigin,
  type MemoryQuery,
} from "./memory/memory.ts";
export { closeMemories, MAX_CLOSE_MEMORIES, rankMemories } from "./memory/memory-ranking.ts";
export type { MemoryStorePort } from "./memory/memory-store-port.ts";
export type { RepositoryPreparation, RepositoryState } from "./test-repository/repository-setup-state.ts";
