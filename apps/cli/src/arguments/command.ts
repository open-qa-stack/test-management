import type { AgentKey, DomainChange, CampaignDetails, CampaignLaunchScope, ExecutionOrigin, ExecutionOutcome, TestEdit } from "@open-qa-stack/domain";

/** What the command is asked to do, with what that takes. */
export type Command =
  /** Print the usage. */
  | { readonly name: "help" }
  /** Initialise the test repository as a Playwright project. */
  | { readonly name: "init" }
  /** Open the conversation, where the sessions are opened and followed. */
  | { readonly name: "converse"; readonly environment?: string }
  /** Open a session, and follow it to its end. */
  | { readonly name: "run"; readonly brief: string; readonly environment?: string }
  /** List the sessions. */
  | { readonly name: "sessions" }
  /** Print a session and its thread so far. */
  | { readonly name: "show"; readonly session: string }
  /** Follow a session to its end. */
  | { readonly name: "attach"; readonly session: string }
  /** Say something to a session that goes on. */
  | { readonly name: "say"; readonly session: string; readonly text: string }
  /** Interrupt a session that goes on. */
  | { readonly name: "stop"; readonly session: string }
  /** Print the configuration in force, take the configuration file as it, or write it to the file. */
  | { readonly name: "config"; readonly action: ConfigAction }
  /** List the knowledge sources of the configuration in force, with the documents the instance keeps of each. */
  | { readonly name: "knowledge"; readonly action: "list" }
  /** Set the connection to the model step by step, in the terminal. */
  | { readonly name: "model"; readonly action: "setup" }
  /** Test the connection to the model in force, and list the models it offers. */
  | { readonly name: "model"; readonly action: "status" }
  /** Set the connection to the model, then test it. */
  | { readonly name: "model"; readonly action: "set"; readonly connection: ModelArguments }
  /** List what the team asks of each agent. */
  | { readonly name: "agents"; readonly action: "list" }
  /** Give an agent the instructions of the team, or take them back. */
  | { readonly name: "agents"; readonly action: "instruct"; readonly agent: AgentKey; readonly instructions?: string }
  /** Print the prompt of an agent in force, or as the code writes it. */
  | { readonly name: "agents"; readonly action: "prompt" | "default"; readonly agent: AgentKey }
  /** Put the prompt a file holds in place of that of an agent, or give the agent its own back. */
  | { readonly name: "agents"; readonly action: "replace"; readonly agent: AgentKey; readonly file?: string }
  /** Upload files as documents of a source the instance keeps. */
  | { readonly name: "knowledge"; readonly action: "add-document"; readonly source: string; readonly files: readonly string[] }
  /** Tell where the cartography of the knowledge stands, source by source. */
  | { readonly name: "knowledge"; readonly action: "mapping" }
  /** List the domains the cartography found in the knowledge. */
  | { readonly name: "knowledge"; readonly action: "domains" }
  /** Exclude a domain from the sessions and the agents, take it back, or rename it. */
  | { readonly name: "knowledge"; readonly action: "domain"; readonly domain: string; readonly change: DomainChange }
  /** Print a document a source of the instance keeps. */
  | { readonly name: "knowledge"; readonly action: "read"; readonly source: string; readonly document: string }
  /** Remove a document from a source of the instance. */
  | { readonly name: "knowledge"; readonly action: "remove"; readonly source: string; readonly document: string }
  /** Tell where the test repository stands: its folder, whether it is a git repository, and a Playwright project. */
  | { readonly name: "repository" }
  /** Name the project of the instance, and its applications. */
  | { readonly name: "project" }
  /** Map the knowledge again, one source or every source, and follow the session that maps it. */
  | { readonly name: "remap"; readonly source?: string }
  /** Test that the knowledge sources of the configuration in force answer, or one of them. */
  | { readonly name: "knowledge"; readonly action: "check"; readonly source?: string }
  /** Test that each address of the environments of the applications answers, or of one application. */
  | { readonly name: "applications"; readonly action: "check"; readonly application?: string }
  /** List the variables the configuration in force names, and where the value of each comes from. */
  | { readonly name: "secrets"; readonly action: "list" }
  /** Save the value of one of them, read from the input of the command, out of the test repository. */
  | { readonly name: "secrets"; readonly action: "set"; readonly variable: string }
  /** List the tests of the test repository, with what keeps some of its files from being listed as they are. */
  | { readonly name: "tests"; readonly action: "list" }
  /** List what came of each test the last time it ran. */
  | { readonly name: "tests"; readonly action: "verdicts" }
  /** Read a test in steps, as the latest run that ran it reported it; list what came of its file in the latest executions; or the versions of its tests. */
  | { readonly name: "tests"; readonly action: "read" | "executions" | "versions" | "source"; readonly path: string }
  /** Change a test of the test repository: its own title, or the text of one of its steps. */
  | { readonly name: "tests"; readonly action: "change"; readonly path: string; readonly title: string; readonly change: TestEdit }
  /** Write the trace the latest run kept of a test to a file. */
  | { readonly name: "tests"; readonly action: "trace"; readonly path: string; readonly file: string }
  /** Write the capture the latest run attached for a step of a test to a file. */
  | { readonly name: "tests"; readonly action: "capture"; readonly path: string; readonly step: number; readonly file: string }
  /** Launch tests of the test repository as they are, with no agent, in this process, and follow them to their end. */
  | { readonly name: "launch"; readonly paths: readonly string[]; readonly environment?: string }
  /** List the campaigns, the latest planned first, with how many of their tests came to each verdict. */
  | { readonly name: "campaigns"; readonly action: "list" }
  /** Plan a campaign against an environment, with no test yet. */
  | { readonly name: "campaigns"; readonly action: "plan"; readonly campaign: string; readonly environment: string; readonly details?: CampaignDetails }
  /** Print a campaign with what came of each of its tests, make it ready, or close it. */
  | { readonly name: "campaigns"; readonly action: "show" | "ready" | "close"; readonly campaign: string }
  /** Choose the tests of a campaign that is planned: every test of the files named. */
  | { readonly name: "campaigns"; readonly action: "choose"; readonly campaign: string; readonly paths: readonly string[] }
  /** Launch the tests of a campaign, every one or some, in this process, and follow them to their end. */
  | { readonly name: "campaigns"; readonly action: "launch"; readonly campaign: string; readonly only?: CampaignLaunchScope }
  /** List the executions of tests, the latest first, a page at a time. */
  | { readonly name: "executions"; readonly action: "list"; readonly outcome?: ExecutionOutcome; readonly origin?: ExecutionOrigin; readonly before?: string }
  /** Print an execution, with what came of each of its tests. */
  | { readonly name: "executions"; readonly action: "show"; readonly execution: string }
  /** Serve the console of the test repository, and the sessions opened in it. */
  | { readonly name: "ui"; readonly host: string; readonly port: number };

/**
 * The connection `oqas model set` is given: the GitHub account of the machine, or a provider named or reached by the
 * address of its server, with the variable of its key; and the model.
 */
export type ModelArguments =
  { readonly github: true; readonly model: string } | { readonly github: false; readonly provider: string; readonly keyEnv?: string; readonly model: string };

/**
 * What `oqas config` does: print the configuration in force, take the configuration file as it, write it over the
 * file, list its revisions, or check the file without taking it.
 */
export type ConfigAction = "show" | "import" | "export" | "history" | "check";
