import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  attachmentsOf,
  CONFIG_FILE_NAME,
  InvalidDocumentsError,
  isStoredDocuments,
  MAX_DOCUMENT_BYTES,
  UnknownDocumentSourceError,
  type Knowledge,
  type ReceivedFile,
  type SourceCheck,
  type CartographyState,
  type StoredDocumentSummary,
} from "@open-qa-stack/domain";
import { UsageError } from "../errors/usage-error.ts";

/** What a source is, in the words of the command. */
const KINDS: Readonly<Record<Knowledge["type"] | "stored", string>> = {
  openapi: "OpenAPI contract",
  postgresql: "PostgreSQL database",
  document: "documents of the repository",
  stored: "documents the instance keeps",
  "source-code": "source code",
  logs: "logs",
};

/**
 * @param source - A knowledge source of the configuration.
 * @returns The line that names it, what it is, where it is read from, never a secret, and what it is attached to, or
 * that it is for the whole project.
 */
export function sourceLine(source: Knowledge): string {
  const where =
    source.type === "postgresql"
      ? `, variable ${source.connectionStringEnv}`
      : source.type === "openapi"
        ? `, ${source.url ?? source.path}`
        : source.type === "logs"
          ? `, ${source.path ?? `container ${source.container}`}`
          : source.path === undefined
            ? ""
            : `, ${source.path}`;
  const attached = attachmentsOf(source).map(({ application, environment, api }) =>
    [application, environment, api].filter((part) => part !== undefined).join(" > "),
  );
  const reach = attached.length === 0 ? "for the whole project" : `attached to ${attached.join(", ")}`;
  return `${source.id}: ${KINDS[isStoredDocuments(source) ? "stored" : source.type]}${where}; ${reach}.`;
}

/**
 * @param document - A document a source of the instance keeps.
 * @returns The line that names it, with its size and the date it was uploaded.
 */
export function documentLine(document: StoredDocumentSummary): string {
  return `  ${document.name}, ${document.bytes} bytes, uploaded on ${document.uploadedAt}`;
}

/**
 * Reads the files a command names as the files of an upload: a file larger than a document is not read further
 * than its size, which the rules of an upload refuse.
 *
 * @param cwd - The folder the paths are relative to.
 * @param paths - The paths of the files.
 * @returns The files, each named after the last part of its path.
 * @throws {@link UsageError} naming the first file that cannot be read.
 */
export async function receivedFiles(cwd: string, paths: readonly string[]): Promise<ReceivedFile[]> {
  return Promise.all(
    paths.map(async (path) => {
      const file = resolve(cwd, path);
      try {
        const { size } = await stat(file);
        return { name: basename(file), bytes: size, content: size > MAX_DOCUMENT_BYTES ? new Uint8Array() : await readFile(file) };
      } catch {
        throw new UsageError(`${path} cannot be read.`);
      }
    }),
  );
}

/**
 * Tells why documents were refused, and what to do, each error at the file it is about.
 *
 * @param error - What the operations on documents raised.
 * @param paths - The paths of the files of the upload, in its order.
 * @returns The lines that tell it, without a final newline; `undefined` for an error that is no refusal of documents.
 */
export function documentsRefusal(error: unknown, paths: readonly string[]): string | undefined {
  if (error instanceof UnknownDocumentSourceError)
    return `${error.message} Declare it in ${CONFIG_FILE_NAME}, of type document with "stored": true, then take it with oqas config import.`;
  if (!(error instanceof InvalidDocumentsError)) return undefined;
  const at = (path: string): string => (path === "" ? "the upload" : paths[Number(path.slice("/documents/".length))]!);
  return [error.message, ...error.errors.map(({ path, message }) => `${at(path)}: ${message}`)].join("\n");
}

/**
 * @param checked - A knowledge source, and what its test found.
 * @returns The line `oqas knowledge check` prints of it.
 */
export function checkLine({ source, check }: { readonly source: string; readonly check: SourceCheck }): string {
  switch (check.state) {
    case "ok":
      return `${source}  answers, ${check.items === 1 ? "1 item" : `${check.items} items`}`;
    case "failed":
      return `${source}  does not answer: ${check.reason}`;
    case "unchecked":
      return `${source}  not tested: logs are read while a session runs`;
  }
}

/** Where the cartography of a source stands, in the words of a line. */
const MAPPING = { waiting: "waits to be mapped", mapping: "is being mapped", mapped: "mapped", truncated: "mapped in part: a limit stopped it" } as const;

/**
 * @param state - Where the cartography of the knowledge stands.
 * @returns The lines `oqas knowledge mapping` prints: a line a source, then one of the index.
 */
export function mappingLines({ environment, sources, index }: CartographyState): string[] {
  if (environment === undefined) return ["The instance has no configuration yet: nothing is mapped."];
  const lines = sources.map(({ id, state, mappedAt }) => `${id}  ${MAPPING[state]}${mappedAt === undefined ? "" : ` on ${mappedAt}`}`);
  const indexed =
    index === undefined
      ? "No index puts the cards together yet."
      : `The index was written on ${index.producedAt}${index.status === "truncated" ? ", in part" : ""}.`;
  return [`The knowledge of the environment ${environment}:`, ...lines, indexed];
}
