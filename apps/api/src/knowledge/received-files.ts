import { InvalidDocumentsError, MAX_DOCUMENT_BYTES, MAX_DOCUMENTS_PER_UPLOAD, uploadErrors, type ReceivedFile } from "@open-qa-stack/domain";
import { SessionError } from "../sessions/session-error.ts";
import type { FastifyRequest } from "fastify";

/** What a request that uploads documents is told when it is not multipart, or holds a part that is no file. */
const FILES_ONLY = "Send the documents as multipart/form-data, each one a file part, with no other field.";

/**
 * Reads the files of a request that uploads documents, by `@fastify/multipart`, each into memory.
 *
 * @remarks
 * Nothing larger than what the rules of an upload take is read: a file is cut one byte past the largest document,
 * so that its size tells it is too large, and the parser stops one file past the most an upload holds. The rules of
 * the documents are the operations' to apply, but for the count, which the parser stops on.
 *
 * @param request - The request.
 * @returns The files, in the order of the request, each with what was read of its content.
 * @throws {@link SessionError} `invalid_request` for a request that is not multipart, holds a field, or whose body
 * cannot be read.
 * @throws `InvalidDocumentsError` for a request that holds more files than an upload takes.
 */
export async function receivedFiles(request: FastifyRequest): Promise<ReceivedFile[]> {
  if (!request.isMultipart()) throw new SessionError("invalid_request", FILES_ONLY);
  const { FilesLimitError } = request.server.multipartErrors;
  const files: ReceivedFile[] = [];
  try {
    const parts = request.files({ limits: { fileSize: MAX_DOCUMENT_BYTES + 1, files: MAX_DOCUMENTS_PER_UPLOAD + 1, fields: 0 }, throwFileSizeLimit: false });
    for await (const part of parts) {
      const content = await part.toBuffer();
      files.push({ name: part.filename, bytes: content.length, content });
    }
  } catch (error) {
    if (error instanceof FilesLimitError) throw new InvalidDocumentsError(uploadErrors(files));
    // A field, or a body cut short or malformed: what the request holds cannot be read as documents.
    throw new SessionError("invalid_request", FILES_ONLY);
  }
  return files;
}
