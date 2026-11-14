import type { AgentEvent, AgentRuntime, TaskLimits } from "@open-qa-stack/domain";
import type { IndexSourceType, ManifestDomain } from "@open-qa-stack/shared";
import { redactText, secretForms, type ExportedElement } from "@open-qa-stack/tools";
import { runAgentTask } from "../common/agent-task.ts";
import type { Journal } from "../common/journal.ts";
import { citedNameProblems, type ExportVocabulary } from "./cited-names.ts";
import { minimalBody, unfenced } from "./domain-file.ts";
import { domainFileErrors } from "./domain-file-control.ts";
import { sessionUse, type SessionsUse } from "./group-elements.ts";
import { domainRequest, writingInstructions } from "./writing-prompt.ts";

/** What the writing of the file of a domain needs. */
export interface WriteDomainOptions {
  /** Identifier of the source. */
  readonly sourceId: string;
  /** What the source is, which the instructions name its elements by. */
  readonly sourceType: IndexSourceType;
  /** The domain. */
  readonly domain: ManifestDomain;
  /** Its elements, each with its role. */
  readonly members: readonly { readonly element: ExportedElement; readonly role: string }[];
  /** The other domains of the source. */
  readonly others: readonly ManifestDomain[];
  /** What the export of the source names, against which the names the file cites are checked. */
  readonly vocabulary: ExportVocabulary;
  /** The runtime that opens the session. */
  readonly runtime: AgentRuntime;
  /** The limits of the session. */
  readonly limits: TaskLimits;
  /** The secrets of the configuration, masked in the request and which no file may hold. */
  readonly secrets: readonly string[];
  /** Where what the harness refused and wrote itself is written. */
  readonly journal: Journal;
  /** Receives each message sent to the model, before it is sent. */
  readonly sent: (message: string) => void;
  /** Receives each event of the session, as it comes. */
  readonly received: (event: AgentEvent) => void;
}

/** The body of the file of a domain, and who wrote it. */
export interface WrittenDomain extends SessionsUse {
  /** The body to write. */
  readonly body: string;
  /** `model` when the body is the model's and passed the control, `harness` when the harness wrote a minimal one. */
  readonly writtenBy: "model" | "harness";
  /** Why the harness wrote the body itself: what the control last refused, or how the session ended. */
  readonly refused?: string;
  /** The last body of the model the control refused, when it gave one. */
  readonly refusedBody?: string;
}

/**
 * Asks the model for the body of the file of one domain, in a session without tools, and checks it.
 *
 * @remarks
 * A code fence around the whole answer is taken away. A body the control refuses, or one that cites a name
 * the export does not have, is answered with what is wrong, up to the reminders of a task; the model
 * answers again with the whole body. What is only doubtful is told once: the same body again is then kept. When no body passed,
 * the harness writes a minimal one itself — the elements, their kind and their role — and says why.
 *
 * @param options - What the writing needs.
 * @returns The body, who wrote it, and what the session used.
 * @throws Error when the session cannot be opened.
 */
export async function writeDomain(options: WriteDomainOptions): Promise<WrittenDomain> {
  const { sourceId, domain, journal } = options;
  const members = options.members.map(({ element, role }) => ({ name: element.name, kind: element.kind, role }));
  const events: AgentEvent[] = [];
  let read = 0;
  let accepted: string | undefined;
  let refusedBody: string | undefined;
  let refused = "The model gave no answer.";
  let warned = false;
  const check = (): string | undefined => {
    const body = unfenced(
      events
        .slice(read)
        .flatMap((event) => (event.type === "text" ? [event.text] : []))
        .join(""),
    );
    read = events.length;
    const cited = citedNameProblems(body, options.vocabulary);
    const errors = [...domainFileErrors(body, members, options.secrets), ...cited.errors];
    const doubts = warned ? [] : cited.warnings;
    if (errors.length === 0 && doubts.length === 0) {
      accepted = body;
      return undefined;
    }
    warned ||= doubts.length > 0;
    refusedBody = body === "" ? refusedBody : body;
    refused = [...errors, ...doubts].join(" ");
    journal.record("error", `The file of the domain ${domain.id} was not kept: ${refused}`, sourceId);
    const header =
      errors.length === 0
        ? "The file is not kept yet. Check what follows, then answer again with the whole body."
        : "The file was not kept. Fix what follows and answer again with the whole body.";
    return [header, ...[...errors, ...doubts].map((problem) => `- ${problem}`)].join("\n");
  };
  const task = {
    instructions: writingInstructions(options.sourceType),
    tools: [],
    request: redactText(domainRequest(sourceId, domain, options.members, options.others), options.secrets.flatMap(secretForms)),
    events,
    reminder: check,
    sent: options.sent,
    received: options.received,
  };
  await runAgentTask(options.runtime, task, options.limits);
  const last = events.at(-1)!;
  if (last.type === "end" && accepted === undefined) check();
  if (last.type === "stopped") refused = `The session reached its ${last.reason.limit} limit.`;
  if (last.type === "error") refused = `The session failed: ${last.error.message}`;
  const use = sessionUse(events);
  if (accepted !== undefined) return { ...use, body: accepted, writtenBy: "model" };
  journal.record("error", `The harness wrote the file of the domain ${domain.id} itself: ${refused}`, sourceId);
  return { ...use, body: minimalBody(members), writtenBy: "harness", refused, ...(refusedBody === undefined ? {} : { refusedBody }) };
}
