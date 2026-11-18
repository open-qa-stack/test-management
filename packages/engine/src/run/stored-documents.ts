import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { storedDocumentsPath, type DocumentStorePort } from "@open-qa-stack/domain";

/**
 * Writes the documents of the sources the instance keeps to the state folder of the test repository, where the
 * tools of the agents read them as they read a folder of documents of the repository.
 *
 * @remarks
 * Each source has a folder of its own, emptied first: what it holds is a copy for the run, which the next run
 * replaces, and never read back. The names of the documents were checked when they were uploaded: none leads out
 * of its folder.
 *
 * @param repositoryRoot - Absolute path of the test repository.
 * @param stateDir - Its state folder, relative to its root.
 * @param sources - The identifiers of the sources whose documents the instance keeps.
 * @param store - The store of the documents.
 */
export async function writeStoredDocuments(
  repositoryRoot: string,
  stateDir: string,
  sources: readonly string[],
  store: Pick<DocumentStorePort, "documents">,
): Promise<void> {
  for (const source of sources) {
    const folder = resolve(repositoryRoot, storedDocumentsPath(stateDir, source));
    await rm(folder, { recursive: true, force: true });
    await mkdir(folder, { recursive: true });
    for (const { name, text } of await store.documents(source)) await writeFile(join(folder, name), text);
  }
}
