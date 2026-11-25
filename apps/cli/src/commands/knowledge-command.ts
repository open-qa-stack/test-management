import { ExitCode, isStoredDocuments, type CartographyState, type ExitCodeValue } from "@open-qa-stack/domain";
import type { Configuration, KnowledgeDocuments, KnowledgeSources } from "@open-qa-stack/engine";
import type { Arguments } from "../arguments/arguments.ts";
import type { Command } from "../arguments/command.ts";
import { UsageError } from "../errors/usage-error.ts";
import { checkLine, documentLine, domainLine, documentsRefusal, mappingLines, receivedFiles, sourceLine } from "../output/knowledge-lines.ts";
import type { Asked } from "./asked.ts";
import type { CommandIo } from "./command-io.ts";
import type { Operations } from "./operations.ts";
import { linesOr, print } from "./print.ts";

/** `oqas knowledge domains`: lists the domains the cartography found in the knowledge. */
export async function domained({ domains }: Pick<Operations, "domains">, printing: Pick<Asked<"knowledge">, "options" | "io">): Promise<ExitCodeValue> {
  const items = await domains.list();
  const none = "The cartography found no domain yet: oqas knowledge mapping tells where it stands.";
  print(printing, linesOr(items.map(domainLine), none), { items });
  return ExitCode.passed;
}

/** `oqas knowledge exclude`, `restore` and `rename`: changes what is set of a domain, and prints it. */
export async function domainChanged(
  { domains }: Pick<Operations, "domains">,
  { domain, change }: Extract<Command, { action: "domain" }>,
  printing: Pick<Asked<"knowledge">, "options" | "io">,
): Promise<ExitCodeValue> {
  const changed = await domains.change(domain, change);
  print(printing, domainLine(changed), changed);
  return ExitCode.passed;
}

/** `oqas knowledge read` and `remove`: prints a document a source of the instance keeps, or removes it. */
export async function documented(
  documents: KnowledgeDocuments,
  command: Extract<Command, { name: "knowledge"; action: "read" | "remove" }>,
  printing: Pick<Asked<"knowledge">, "options" | "io">,
): Promise<ExitCodeValue> {
  const { source, document } = command;
  if (command.action === "read") {
    const read = await documents.read(source, document);
    print(printing, read.text.trimEnd(), read);
    return ExitCode.passed;
  }
  await documents.remove(source, document);
  print(printing, `The document ${document} is removed from ${source}.`, { source, document });
  return ExitCode.passed;
}

/**
 * `oqas knowledge`: lists the knowledge sources of the configuration in force, each with the documents the instance
 * keeps of it when it is declared stored; with `add-document`, uploads files to such a source first, then lists it.
 */
export async function known({
  configuration,
  documents,
  command,
  options,
  io,
}: Omit<Asked<"knowledge">, "sessions" | "command"> & {
  configuration: Configuration;
  documents: KnowledgeDocuments;
  command: Extract<Command, { name: "knowledge"; action: "list" | "add-document" }>;
}): Promise<ExitCodeValue> {
  if (command.action === "add-document") {
    const files = await receivedFiles(io.cwd, command.files);
    try {
      await documents.upload(command.source, files);
    } catch (error) {
      const refusal = documentsRefusal(error, command.files);
      throw refusal === undefined ? error : new UsageError(refusal);
    }
    const kept = await documents.list(command.source);
    const lines = [`${files.length === 1 ? "1 document was" : `${files.length} documents were`} uploaded to ${command.source}.`, ...kept.map(documentLine)];
    print({ options, io }, lines.join("\n"), { source: command.source, documents: kept });
    return ExitCode.passed;
  }
  const sources = (await configuration.view()).revision?.document.knowledge ?? [];
  if (sources.length === 0) {
    print({ options, io }, "The configuration in force declares no knowledge source.", { sources: [] });
    return ExitCode.passed;
  }
  const listed = await Promise.all(sources.map(async (source) => ({ source, kept: isStoredDocuments(source) ? await documents.list(source.id) : undefined })));
  const lines = listed.flatMap(({ source, kept }) => [
    sourceLine(source),
    ...(kept === undefined ? [] : kept.length === 0 ? ["  no document yet"] : kept.map(documentLine)),
  ]);
  print({ options, io }, lines.join("\n"), { sources: listed.map(({ source, kept }) => (kept === undefined ? source : { ...source, documents: kept })) });
  return ExitCode.passed;
}

/**
 * `oqas knowledge check`: tests that the knowledge sources of the configuration in force answer, or the one named,
 * without the model and indexing nothing. Exits with `0` when each answers, with `4` otherwise.
 */
export async function checked({
  configuration,
  sources,
  command,
  options,
  io,
}: Omit<Asked<"knowledge">, "sessions" | "command"> & {
  configuration: Configuration;
  sources: KnowledgeSources;
  command: Extract<Command, { name: "knowledge"; action: "check" }>;
}): Promise<ExitCodeValue> {
  const declared = (await configuration.current()).document.knowledge;
  const asked = command.source === undefined ? declared : declared.filter(({ id }) => id === command.source);
  if (asked.length === 0)
    throw new UsageError(
      command.source === undefined
        ? "The configuration in force declares no knowledge source."
        : `The configuration in force declares no knowledge source ${command.source}; oqas knowledge list lists them.`,
    );
  const checks = await Promise.all(asked.map(async (source) => ({ source: source.id, check: await sources.check(source) })));
  print({ options, io }, checks.map(checkLine).join("\n"), { checks });
  return checks.some(({ check }) => check.state === "failed") ? ExitCode.prerequisite : ExitCode.passed;
}

/** `oqas knowledge mapping`: tells where the cartography of the knowledge stands, source by source, and its index. */
export function mapped(state: CartographyState, options: Arguments, io: CommandIo): ExitCodeValue {
  print({ options, io }, mappingLines(state).join("\n"), state);
  return ExitCode.passed;
}
