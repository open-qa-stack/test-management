import type { ExportedElement } from "@open-qa-stack/tools";
import { EXPORT_FOLDER } from "./source-folder.ts";

/** Most elements the model is asked to place in one batch. */
export const MAX_BATCH_ELEMENTS = 30;

/** Most characters of summaries in one batch; a batch always holds one element at least. */
export const MAX_BATCH_CHARACTERS = 20_000;

/** Longest summary of an element shown in a batch; a longer one is cut, with where to read the rest. */
export const MAX_SUMMARY_LENGTH = 1500;

/**
 * The summary of an element as a batch shows it.
 *
 * @param element - The element.
 * @returns Its summary, cut past `MAX_SUMMARY_LENGTH` with the number of characters left out and the file
 * of the source folder that holds its definition.
 */
export function batchSummary(element: ExportedElement): string {
  const { summary } = element;
  if (summary.length <= MAX_SUMMARY_LENGTH) return summary;
  return `${summary.slice(0, MAX_SUMMARY_LENGTH)}… [${summary.length - MAX_SUMMARY_LENGTH} more characters, in ${EXPORT_FOLDER}/${element.file}]`;
}

/**
 * Cuts the elements of a source into the batches the model places one after the other.
 *
 * @remarks
 * The order of the export is kept: the tables of a database by schema and name, then its views, then its
 * routines. A batch is closed at `MAX_BATCH_ELEMENTS` elements, or before the element whose summary would
 * take it past `MAX_BATCH_CHARACTERS`.
 *
 * @param elements - The elements to place, in the order of the export.
 * @returns The batches, in order; none for no element.
 */
export function elementBatches(elements: readonly ExportedElement[]): ExportedElement[][] {
  const batches: ExportedElement[][] = [];
  let size = 0;
  for (const element of elements) {
    const length = batchSummary(element).length;
    const open = batches.at(-1);
    if (open === undefined || open.length === MAX_BATCH_ELEMENTS || size + length > MAX_BATCH_CHARACTERS) {
      batches.push([element]);
      size = length;
    } else {
      open.push(element);
      size += length;
    }
  }
  return batches;
}
