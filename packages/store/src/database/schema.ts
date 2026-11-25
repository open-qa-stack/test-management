import type { CampaignStatus, ExecutionOrigin, ExecutionVerdict, MemoryKind, OqasConfig, RevisionOrigin } from "@open-qa-stack/domain";
import type { AgentRole, Application, SessionEvent, SessionResult, SessionScope, SessionState } from "@open-qa-stack/domain/sessions";
import type { StoredBoolean, StoredInstant, StoredJson } from "./stored-values.ts";

/**
 * The project of the instance: one row at most, which the check on its key holds it to.
 *
 * @remarks
 * The applications are served whole and never filtered on: they are kept as JSON.
 */
export interface ProjectTable {
  only: StoredBoolean;
  name: string | null;
  applications: StoredJson<readonly Application[]>;
}

/**
 * The sessions of the instance.
 *
 * @remarks
 * The state is a text: states are added over time, and a client reads one it does not know. The result is
 * served whole and never filtered on: it is kept as JSON. The host is the process that asked for the session
 * or took it over, as that process names itself, with the date of its last beat: a host whose beat is empty
 * or old is silent, and its sessions are left to others. An interruption another process asked for waits
 * there, dated, for the host to read it.
 */
export interface SessionsTable {
  id: string;
  /** `map` for a session that maps the knowledge alone; `null` for one that tests. */
  purpose: "map" | null;
  request: string | null;
  environment: string | null;
  scope: StoredJson<SessionScope> | null;
  opened_at: StoredInstant;
  last_event_at: StoredInstant;
  state: SessionState;
  result: StoredJson<SessionResult> | null;
  host: string | null;
  host_seen_at: StoredInstant | null;
  interruption_requested_at: StoredInstant | null;
}

/**
 * The events of the sessions, each under its rank in its session: from 1, given once, never changed.
 *
 * @remarks
 * The payload is what the event carries besides its rank, its date and its type. It is served whole, in the
 * order its fields were written, and never filtered on.
 */
export interface SessionEventsTable {
  session_id: string;
  id: number;
  at: StoredInstant;
  type: SessionEvent["type"];
  payload: StoredJson<Readonly<Record<string, unknown>>>;
}

/**
 * The messages a person sent to a session that was going on, each under its number in its session: from 1,
 * given once, never changed.
 *
 * @remarks
 * A message waits until the work of its session hands it to an agent, which is then named with the date: a
 * message whose agent is empty is still to be delivered.
 */
export interface SessionMessagesTable {
  session_id: string;
  number: number;
  at: StoredInstant;
  text: string;
  delivered_to: AgentRole | null;
  delivered_at: StoredInstant | null;
}

/**
 * The revisions of the configuration of the instance, each under its number: from 1, given once, never changed.
 * The revision in force is the one with the highest.
 *
 * @remarks
 * The origin is a text, as the state of a session is. The document is served whole and never filtered on: it is
 * kept as JSON. The digest is that of the configuration file the revision was read from or wrote, which tells
 * whether the file changed since.
 */
export interface ConfigurationRevisionsTable {
  number: number;
  recorded_at: StoredInstant;
  origin: RevisionOrigin;
  file_digest: string;
  document: StoredJson<OqasConfig>;
}

/**
 * The documents uploaded to the knowledge sources of the instance, each under its source and its file name: an
 * upload of a name the source holds replaces it.
 *
 * @remarks
 * The source is the identifier a revision of the configuration declares it under: the documents stay with it,
 * whether a revision declares it or not. The size is that of the text in UTF-8, in bytes.
 */
export interface KnowledgeDocumentsTable {
  source: string;
  name: string;
  uploaded_at: StoredInstant;
  bytes: number;
  text: string;
}

/**
 * The campaigns, each under its identifier. The state is a text, as
 * that of a session is. When it became ready and when it was closed are empty until then.
 */
export interface CampaignsTable {
  id: string;
  name: string;
  environment: string;
  status: CampaignStatus;
  created_at: StoredInstant;
  ready_at: StoredInstant | null;
  closed_at: StoredInstant | null;
  objective: string | null;
  target_version: string | null;
  starts_on: string | null;
  ends_on: string | null;
  owner: string | null;
}

/** The tests chosen for a campaign, each named by the path of its file and its title: they may change while it is planned. */
export interface CampaignTestsTable {
  campaign_id: string;
  path: string;
  title: string;
}

/**
 * The executions of tests, each under its identifier. The origin is a text, as the state of a session is. The session
 * of an execution it ran is emptied when the session goes; the commit is empty for a test repository without one; the
 * campaign is empty for an execution launched for none, the environment for one kept before the instance kept it.
 */
export interface ExecutionsTable {
  id: string;
  origin: ExecutionOrigin;
  session_id: string | null;
  campaign_id: string | null;
  ran_at: StoredInstant;
  commit_sha: string | null;
  environment: string | null;
  report: string;
}

/**
 * What came of each test of an execution, under its rank in the report of the execution, from 0. The verdict is a
 * text; the digest of the file is empty when the file could not be read. Where a test failed and why are empty for
 * one that did not fail, kept before the instance kept them, or whose report does not say them. The digest of the test,
 * whether it was committed — 0 or 1 — and its version are empty for a result without a digest of its test.
 */
export interface ExecutionResultsTable {
  execution_id: string;
  position: number;
  path: string;
  title: string;
  project: string;
  verdict: ExecutionVerdict;
  duration_ms: number;
  file_digest: string | null;
  failed_step: number | null;
  failed_step_title: string | null;
  error_message: string | null;
  expected: string | null;
  received: string | null;
  test_digest: string | null;
  committed: number | null;
  version: number | null;
}

/**
 * The versions of the tests, each under the path of its file, its titles and its number from 1. The commit is empty
 * for a version never run committed.
 */
export interface TestVersionsTable {
  path: string;
  title: string;
  number: number;
  digest: string;
  commit_sha: string | null;
  since: StoredInstant;
}

/**
 * The tests the instance knows by their identifier, the UUID of their tag `@oqas-id-…`, each with the path of its file
 * and its titles as the repository last told them: its versions and its results are kept under that place.
 */
export interface TestsTable {
  id: string;
  path: string;
  title: string;
}

/**
 * The memories of the agents, each under its identifier, filed under a domain and a kind.
 *
 * @remarks
 * The kind is a text, as the state of a session is: kinds may be added without a migration. The tags are served
 * whole and never filtered on: they are kept as JSON. A memory never corrected has its three columns of the
 * correction empty.
 */
export interface MemoriesTable {
  id: string;
  domain: string;
  kind: MemoryKind;
  text: string;
  tags: StoredJson<readonly string[]>;
  source: string | null;
  written_role: string;
  written_task: string;
  written_at: StoredInstant;
  revised_role: string | null;
  revised_task: string | null;
  revised_at: StoredInstant | null;
}

/**
 * The schema of the database of an instance, on every database the store supports: the tables the migrations
 * create, and what the statements of the store are checked against.
 */
export interface StoreSchema {
  project: ProjectTable;
  sessions: SessionsTable;
  session_events: SessionEventsTable;
  session_messages: SessionMessagesTable;
  configuration_revisions: ConfigurationRevisionsTable;
  knowledge_documents: KnowledgeDocumentsTable;
  campaigns: CampaignsTable;
  campaign_tests: CampaignTestsTable;
  executions: ExecutionsTable;
  execution_results: ExecutionResultsTable;
  test_versions: TestVersionsTable;
  tests: TestsTable;
  memories: MemoriesTable;
}
