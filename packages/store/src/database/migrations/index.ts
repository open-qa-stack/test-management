import { sessions } from "./0001-sessions.ts";
import { sessionHosts } from "./0002-session-hosts.ts";
import { configurationRevisions } from "./0003-configuration-revisions.ts";
import { knowledgeDocuments } from "./0004-knowledge-documents.ts";
import { executions } from "./0005-executions.ts";
import { executionFailures } from "./0006-execution-failures.ts";
import { testVersions } from "./0007-test-versions.ts";
import { campaigns } from "./0008-campaigns.ts";
import { sessionScopes } from "./0009-session-scopes.ts";
import { campaignSelections } from "./0010-campaign-selections.ts";
import type { Migration } from "kysely/migration";

/**
 * The versioned migrations of the schema, each under its name: they are applied in the order of their names,
 * each one once, and run unchanged on every database the store supports.
 */
export const MIGRATIONS: Readonly<Record<string, Migration>> = {
  "0001_sessions": sessions,
  "0002_session_hosts": sessionHosts,
  "0003_configuration_revisions": configurationRevisions,
  "0004_knowledge_documents": knowledgeDocuments,
  "0005_executions": executions,
  "0006_execution_failures": executionFailures,
  "0007_test_versions": testVersions,
  "0008_campaigns": campaigns,
  "0009_session_scopes": sessionScopes,
  "0010_campaign_selections": campaignSelections,
};
