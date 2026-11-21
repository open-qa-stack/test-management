import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { operationIds, type OperationId } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { ApiClient } from "../src/api/api-client.ts";

/** How the console offers an operation: a method of its client of the API, an address it builds, or why it offers none. */
type Offer = { readonly client: Exclude<keyof ApiClient, "constructor"> } | { readonly address: string; readonly in: string } | { readonly none: string };

/**
 * How the console offers each operation of the engine. Typed on the operations, it does not compile while an operation
 * of the engine is not said here.
 */
const CONSOLE: Readonly<Record<OperationId, Offer>> = {
  "Sessions.project": { client: "project" },
  "Sessions.sessions": { client: "sessions" },
  "Sessions.session": { client: "session" },
  "Sessions.open": { client: "open" },
  "Sessions.resume": { client: "resume" },
  "Sessions.say": { client: "say" },
  "Sessions.interrupt": { client: "interrupt" },
  "Sessions.events": { address: "/events", in: "src/api/event-stream.ts" },
  "Sessions.thread": { address: "/events", in: "src/api/event-stream.ts" },
  "Sessions.launch": { client: "launch" },
  "Sessions.launches": { client: "launches" },
  "Configuration.view": { client: "configuration" },
  "Configuration.revisions": { client: "revisions" },
  "Configuration.check": { client: "check" },
  "Configuration.synchronise": { client: "synchronise" },
  "Configuration.save": { client: "save" },
  "Configuration.restore": { none: "each change saved rewrites oqas.json, which is then in step with the revision in force" },
  "ModelConnection.check": { client: "testModel" },
  "Secrets.list": { client: "secrets" },
  "Secrets.save": { client: "saveSecret" },
  "RepositorySetup.state": { client: "repository" },
  "RepositorySetup.prepare": { client: "prepareRepository" },
  "KnowledgeDocuments.list": { client: "documents" },
  "KnowledgeDocuments.read": { client: "document" },
  "KnowledgeDocuments.upload": { client: "upload" },
  "KnowledgeDocuments.remove": { client: "removeDocument" },
  "KnowledgeDomains.list": { client: "domains" },
  "RepositoryTests.listed": { client: "tests" },
  "TestReadings.read": { client: "testReading" },
  "TestReadings.trace": { address: "/tests/trace", in: "src/executions/executions-paths.ts" },
  "TestReadings.capture": { address: "/tests/capture", in: "src/executions/result-screen.tsx" },
  "Executions.page": { client: "executionPage" },
  "Executions.get": { client: "execution" },
  "Executions.ofFile": { client: "testExecutions" },
  "Executions.versions": { client: "testVersions" },
  "Campaigns.plan": { client: "planCampaign" },
  "Campaigns.list": { client: "campaigns" },
  "Campaigns.progress": { client: "campaign" },
  "Campaigns.choose": { client: "chooseCampaignTests" },
  "Campaigns.ready": { client: "readyCampaign" },
  "Campaigns.launch": { client: "launchCampaign" },
  "Campaigns.close": { client: "closeCampaign" },
};

/** The sources of the console but its client of the API, which call it. */
const SCREENS = import.meta.glob(["../src/**/*.ts", "../src/**/*.tsx", "!../src/api/api-client.ts"], { query: "?raw", import: "default", eager: true });

describe("the operations of the engine, as the console offers them", () => {
  it("each are a method of its client of the API that a screen calls, an address a screen builds, or said none with why", () => {
    const sources = Object.values(SCREENS).join("\n");
    for (const id of operationIds()) {
      const offer = CONSOLE[id];
      if ("client" in offer) {
        assert.equal(typeof ApiClient.prototype[offer.client], "function", `${id}: the client has no ${offer.client}`);
        assert.ok(sources.includes(`.${offer.client}(`), `${id}: no screen calls ${offer.client}`);
      } else if ("address" in offer) assert.ok(readFileSync(new URL(`../${offer.in}`, import.meta.url), "utf8").includes(offer.address), id);
      else assert.ok(offer.none.length > 0, id);
    }
  });
});
