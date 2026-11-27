/**
 * The operations of the engine a person asks for, by the class of the engine that holds them: the contract every
 * client fulfils. The console — through the API —, the command and the conversation each say, operation by operation,
 * how a person asks for it there, or why they cannot yet; their tests of parity are typed on this list, so that an
 * operation added here is refused by each of them until it says so. The engine checks that the list names every
 * method of its classes but those a host calls.
 */
export const OPERATIONS = {
  Sessions: ["project", "sessions", "session", "open", "resume", "say", "interrupt", "events", "thread", "launch", "launches", "remap"],
  Configuration: ["view", "revisions", "check", "synchronise", "save", "restore"],
  ModelConnection: ["check"],
  EnvironmentAddresses: ["check"],
  Secrets: ["list", "save"],
  RepositorySetup: ["state", "prepare"],
  KnowledgeDocuments: ["list", "read", "upload", "remove"],
  KnowledgeDomains: ["list", "change"],
  KnowledgeSources: ["check"],
  KnowledgeMapping: ["state"],
  RepositoryTests: ["listed"],
  TestReviews: ["queue", "proposal", "decide", "restore", "correct"],
  Defects: ["list", "report", "change"],
  AgentMemory: ["list", "add", "change"],
  TestReadings: ["read", "trace", "capture"],
  TestSources: ["read", "change"],
  Executions: ["page", "get", "ofFile", "verdicts", "versions"],
  Campaigns: ["plan", "list", "progress", "choose", "ready", "launch", "close"],
  AgentPrompts: ["list"],
} as const;

/** An operation of the engine, named `Class.method`. */
export type OperationId = { [C in keyof typeof OPERATIONS]: `${C}.${(typeof OPERATIONS)[C][number]}` }[keyof typeof OPERATIONS];

/** @returns Every operation of the engine, named `Class.method`, in the order of {@link OPERATIONS}. */
export function operationIds(): OperationId[] {
  return Object.entries(OPERATIONS).flatMap(([name, methods]) => methods.map((method) => `${name}.${method}` as OperationId));
}
