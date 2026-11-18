import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  CONFIG_FILE_NAME,
  InvalidDocumentsError,
  isStoredDocuments,
  MAX_DOCUMENT_BYTES,
  UnknownDocumentSourceError,
  type Knowledge,
  type ReceivedFile,
  type StoredDocumentSummary,
} from "@open-qa-stack/domain";
import { UsageError } from "./usage-error.ts";

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
 * @returns The line that names it, what it is, where it is read from, never a secret, and what it is attached to.
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
  const attached = source.attachments.map(({ application, environment, api }) =>
    [application, environment, api].filter((part) => part !== undefined).join(" > "),
  );
  return `${source.id}: ${KINDS[isStoredDocuments(source) ? "stored" : source.type]}${where}; attached to ${attached.join(", ")}.`;
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
