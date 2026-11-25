import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { operationIds, type OperationId } from "@open-qa-stack/domain";
import { parseArguments } from "../src/arguments/parse-arguments.ts";
import { initialState } from "../src/conversation/state/conversation-state.ts";
import { requestOf } from "../src/conversation/state/request.ts";
import { SLASH_COMMANDS, type SlashCommand } from "../src/conversation/state/slash-commands.ts";

/** What a client does not offer yet, and why: each is a gap still to close. */
interface Missing {
  readonly missing: string;
}

/**
 * How the command offers each operation of the engine: the arguments that ask for it, or why it does not yet. Typed on
 * the operations, it does not compile while an operation of the engine is not said here.
 */
const COMMANDS: Readonly<Record<OperationId, readonly string[] | Missing>> = {
  "Sessions.project": ["project"],
  "Sessions.sessions": ["sessions"],
  "Sessions.session": ["show", "s"],
  "Sessions.open": ["--brief", "Orders."],
  "Sessions.resume": ["say", "s", "Go on."],
  "Sessions.say": ["say", "s", "Look at refunds."],
  "Sessions.interrupt": ["stop", "s"],
  "Sessions.events": ["attach", "s"],
  "Sessions.thread": ["show", "s"],
  "Sessions.launch": ["launch", "--environment", "local"],
  "Sessions.launches": ["launch", "--environment", "local"],
  "Sessions.remap": ["knowledge", "remap", "order-specs"],
  "Configuration.view": ["config", "show"],
  "Configuration.revisions": ["config", "history"],
  "Configuration.check": ["config", "check"],
  "Configuration.synchronise": ["config", "import"],
  "Configuration.save": ["model", "set", "--github", "--model", "gpt-5"],
  "Configuration.restore": ["config", "export"],
  "ModelConnection.check": ["model", "status"],
  "EnvironmentAddresses.check": ["applications", "check"],
  "Secrets.list": ["secrets"],
  "Secrets.save": ["secrets", "set", "MODEL_KEY"],
  "RepositorySetup.state": ["repository"],
  "RepositorySetup.prepare": ["--init"],
  "KnowledgeDocuments.list": ["knowledge", "list"],
  "KnowledgeDocuments.read": ["knowledge", "read", "manuals", "quotes.md"],
  "KnowledgeDocuments.upload": ["knowledge", "add-document", "manuals", "quotes.md"],
  "KnowledgeDocuments.remove": ["knowledge", "remove", "manuals", "quotes.md"],
  "KnowledgeDomains.list": ["knowledge", "domains"],
  "KnowledgeDomains.change": ["knowledge", "exclude", "orders"],
  "KnowledgeSources.check": ["knowledge", "check"],
  "KnowledgeMapping.state": ["knowledge", "mapping"],
  "RepositoryTests.listed": ["tests"],
  "TestReadings.read": ["tests", "read", "orders.spec.ts"],
  "TestReadings.trace": ["tests", "trace", "orders.spec.ts", "trace.zip"],
  "TestReadings.capture": ["tests", "capture", "orders.spec.ts", "2", "step-2.png"],
  "TestSources.read": ["tests", "source", "orders.spec.ts"],
  "TestSources.change": ["tests", "rename", "orders.spec.ts", "Search an order", "Find an order"],
  "Executions.page": ["executions", "--outcome", "failing"],
  "Executions.get": ["executions", "show", "e"],
  "Executions.ofFile": ["tests", "executions", "orders.spec.ts"],
  "Executions.verdicts": ["tests", "verdicts"],
  "Executions.versions": ["tests", "versions", "orders.spec.ts"],
  "Campaigns.plan": ["campaigns", "plan", "Release", "--environment", "local"],
  "Campaigns.list": ["campaigns"],
  "Campaigns.progress": ["campaigns", "show", "c"],
  "Campaigns.choose": ["campaigns", "choose", "c", "orders.spec.ts"],
  "Campaigns.ready": ["campaigns", "ready", "c"],
  "Campaigns.launch": ["campaigns", "launch", "c", "failed"],
  "Campaigns.close": ["campaigns", "close", "c"],
};

/**
 * How the conversation offers an operation: a command of its own typed after a slash, what is typed to run what `oqas`
 * runs, what the conversation does on its own, or nothing yet.
 */
type InConversation = { readonly slash: SlashCommand["name"] } | { readonly typed: string } | { readonly itself: string } | Missing;

/**
 * How the conversation offers each operation of the engine. Typed on the operations, it does not compile while an
 * operation of the engine is not said here.
 */
const CONVERSATION: Readonly<Record<OperationId, InConversation>> = {
  "Sessions.project": { itself: "its banner names the project" },
  "Sessions.sessions": { slash: "sessions" },
  "Sessions.session": { slash: "sessions" },
  "Sessions.open": { itself: "what is typed with no session followed opens one" },
  "Sessions.resume": { itself: "what is typed to a session that ended goes on with it" },
  "Sessions.say": { itself: "what is typed to a session that goes on is said to its agents" },
  "Sessions.interrupt": { slash: "stop" },
  "Sessions.events": { itself: "the session followed is shown live" },
  "Sessions.thread": { itself: "a session reopened shows its thread so far" },
  "Sessions.launch": { typed: "/launch --environment local" },
  "Sessions.launches": { typed: "/launch --environment local" },
  "Sessions.remap": { typed: "/knowledge remap" },
  "Configuration.view": { typed: "/config show" },
  "Configuration.revisions": { typed: "/config history" },
  "Configuration.check": { typed: "/config check" },
  "Configuration.synchronise": { typed: "/config import" },
  "Configuration.save": { typed: "/model set --github --model gpt-5" },
  "Configuration.restore": { typed: "/config export" },
  "ModelConnection.check": { slash: "model" },
  "EnvironmentAddresses.check": { typed: "/applications check" },
  "Secrets.list": { typed: "/secrets" },
  "Secrets.save": { typed: "/secrets set MODEL_KEY" },
  "RepositorySetup.state": { typed: "/repository" },
  "RepositorySetup.prepare": { typed: "/init" },
  "KnowledgeDocuments.list": { typed: "/knowledge list" },
  "KnowledgeDocuments.read": { typed: "/knowledge read manuals quotes.md" },
  "KnowledgeDocuments.upload": { typed: "/knowledge add-document manuals quotes.md" },
  "KnowledgeDocuments.remove": { typed: "/knowledge remove manuals quotes.md" },
  "KnowledgeDomains.list": { typed: "/knowledge domains" },
  "KnowledgeDomains.change": { typed: "/knowledge rename orders Sales" },
  "KnowledgeSources.check": { typed: "/knowledge check" },
  "KnowledgeMapping.state": { typed: "/knowledge mapping" },
  "RepositoryTests.listed": { typed: "/tests" },
  "TestReadings.read": { typed: "/tests read orders.spec.ts" },
  "TestReadings.trace": { typed: "/tests trace orders.spec.ts trace.zip" },
  "TestReadings.capture": { typed: "/tests capture orders.spec.ts 2 step-2.png" },
  "TestSources.read": { typed: "/tests source orders.spec.ts" },
  "TestSources.change": { typed: "/tests rename orders.spec.ts Orders Listing" },
  "Executions.page": { typed: "/executions --outcome failing" },
  "Executions.get": { typed: "/executions show e" },
  "Executions.ofFile": { typed: "/tests executions orders.spec.ts" },
  "Executions.verdicts": { typed: "/tests verdicts" },
  "Executions.versions": { typed: "/tests versions orders.spec.ts" },
  "Campaigns.plan": { typed: "/campaigns plan Release --environment local" },
  "Campaigns.list": { typed: "/campaigns" },
  "Campaigns.progress": { typed: "/campaigns show c" },
  "Campaigns.choose": { typed: "/campaigns choose c orders.spec.ts" },
  "Campaigns.ready": { typed: "/campaigns ready c" },
  "Campaigns.launch": { typed: "/campaigns launch c failed" },
  "Campaigns.close": { typed: "/campaigns close c" },
};

/** The operations a client does not offer yet. */
const missingIn = (offers: Readonly<Record<OperationId, unknown>>): OperationId[] =>
  operationIds().filter((id) => typeof offers[id] === "object" && offers[id] !== null && "missing" in (offers[id] as object));

describe("the operations of the engine, as the command offers them", () => {
  it("each are asked for by arguments the command takes, or said missing with why", () => {
    for (const id of operationIds()) {
      const offer = COMMANDS[id];
      if ("missing" in offer) assert.ok(offer.missing.length > 0, id);
      else assert.ok(parseArguments(offer).ok, `${id}: oqas ${offer.join(" ")} is refused`);
    }
  });

  // A gap closed lowers this count, and a gap opened is refused: it only goes down.
  it("are missing no more than they were", () => {
    assert.equal(missingIn(COMMANDS).length, 0);
  });
});

describe("the operations of the engine, as the conversation offers them", () => {
  it("each are a command of the conversation, what runs the command, something it does on its own, or said missing with why", () => {
    const names = new Set(SLASH_COMMANDS.map(({ name }) => name));
    for (const id of operationIds()) {
      const offer = CONVERSATION[id];
      if ("slash" in offer) assert.ok(names.has(offer.slash), `${id}: /${offer.slash} is no command of the conversation`);
      else if ("typed" in offer)
        assert.ok(
          ["command", "secret", "remap"].includes(requestOf({ ...initialState([], 0), input: offer.typed }).kind),
          `${id}: ${offer.typed} runs nothing`,
        );
      else assert.ok(("itself" in offer ? offer.itself : offer.missing).length > 0, id);
    }
  });

  // A gap closed lowers this count, and a gap opened is refused: it only goes down.
  it("are missing no more than they were", () => {
    assert.equal(missingIn(CONVERSATION).length, 0);
  });
});
