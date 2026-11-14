import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { redactText, secretForms, type SourceExport } from "@open-qa-stack/tools";

/** Folder of the export, in the folder of a source. */
export const EXPORT_FOLDER = "export";

/** File of the export that sums up every element. */
export const SUMMARY_FILE = "summary.txt";

/**
 * The folder of one source in the test repository, where the harness writes what it read of the source
 * without the model.
 *
 * @remarks
 * Every text is written with the secrets of the configuration masked, in every form `secretForms` gives.
 */
export class SourceFolder {
  /** Absolute path of the folder. */
  public readonly root: string;
  private readonly forms: readonly string[];

  /**
   * @param root - Absolute path of the folder.
   * @param secrets - The secrets of the configuration, which no file may hold.
   */
  public constructor(root: string, secrets: readonly string[]) {
    this.root = root;
    this.forms = secrets.flatMap(secretForms);
  }

  /**
   * Writes the export of the source, in place of the one written before.
   *
   * @remarks
   * `export/summary.txt` holds the summary of every element, in the order of the export, a blank line
   * between two; the definition of each element goes to its own file, under `export/`.
   *
   * @param exported - The export of the source.
   * @throws Error when a file cannot be written to the disk.
   */
  public async writeExport(exported: SourceExport): Promise<void> {
    const folder = join(this.root, EXPORT_FOLDER);
    await rm(folder, { recursive: true, force: true });
    await this.write(join(folder, SUMMARY_FILE), exported.elements.map((element) => element.summary).join("\n\n"));
    for (const element of exported.elements) await this.write(join(folder, element.file), element.definition);
  }

  /** Writes a text, its secrets masked, and the folders above it. */
  private async write(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${redactText(text, this.forms)}\n`);
  }
}
