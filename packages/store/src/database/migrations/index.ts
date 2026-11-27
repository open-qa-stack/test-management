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
import { memories } from "./0011-memories.ts";
import { sessionPurposes } from "./0012-session-purposes.ts";
import { tests } from "./0013-tests.ts";
import { executionEnvironments } from "./0014-execution-environments.ts";
import { campaignDetails } from "./0015-campaign-details.ts";
import { domainSettings } from "./0016-domain-settings.ts";
import { testDecisions } from "./0017-test-decisions.ts";
import { defects } from "./0018-defects.ts";
import { testCorrections } from "./0019-test-corrections.ts";
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
  "0011_memories": memories,
  "0012_session_purposes": sessionPurposes,
  "0013_tests": tests,
  "0014_execution_environments": executionEnvironments,
  "0015_campaign_details": campaignDetails,
  "0016_domain_settings": domainSettings,
  "0017_test_decisions": testDecisions,
  "0018_defects": defects,
  "0019_test_corrections": testCorrections,
};
