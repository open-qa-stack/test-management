/**
 * An agent that has a system prompt of its own, by what it does: the cartographer of a source without an export, the
 * grouping of the elements of a source, the writer of the file of a domain, the cartographer of documents, the explorer
 * of an application, the orchestrator of the cartography, the planner of the tests, the reviewer of a plan, the writer
 * of a test, the reviewer of its coherence with its plan, and the reviewer of its code.
 */
export type AgentKey =
  | "source-cartographer"
  | "source-grouping"
  | "domain-writer"
  | "document-cartographer"
  | "application-explorer"
  | "cartography-orchestrator"
  | "planner"
  | "plan-reviewer"
  | "writer"
  | "coherence-reviewer"
  | "code-reviewer";
