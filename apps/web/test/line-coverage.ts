import { decode } from "./source-map-span.ts";

/** The block coverage V8 reports for one script, as Chromium's coverage API returns it. */
export interface ScriptCoverage {
  readonly source?: string;
  readonly functions: readonly { readonly ranges: readonly { readonly startOffset: number; readonly endOffset: number; readonly count: number }[] }[];
}

/** A source map with a single generated file. */
export interface GeneratedMap {
  readonly sources: readonly string[];
  readonly mappings: string;
}

/** The lines of a source the generated code maps to, and those of them that did not run. */
export interface LineCoverage {
  readonly lines: readonly number[];
  readonly uncovered: readonly number[];
}

/**
 * Maps the block coverage of a generated script back to the lines of one of its sources.
 *
 * Each mapped position takes the count of the narrowest range around it, as V8 counts blocks; a line is
 * uncovered as soon as one of its positions never ran.
 *
 * @param script - The coverage of the generated script, with its source.
 * @param map - The source map of that script.
 * @param source - The index, in `map.sources`, of the source to measure.
 * @returns The mapped lines of the source, one-based and sorted, and those that did not run.
 */
export function lineCoverage(script: ScriptCoverage, map: GeneratedMap, source: number): LineCoverage {
  const starts = [0];
  for (const line of (script.source ?? "").split("\n")) starts.push(starts.at(-1)! + line.length + 1);
  const ranges = script.functions.flatMap((fn) => fn.ranges);
  const ran = new Map<number, boolean>();
  let sourceIndex = 0;
  let sourceLine = 0;
  map.mappings.split(";").forEach((segments, generatedLine) => {
    let column = 0;
    for (const segment of segments.split(",").filter((s) => s !== "")) {
      const [columnDelta = 0, sourceDelta, lineDelta = 0] = decode(segment);
      column += columnDelta;
      if (sourceDelta === undefined) continue;
      sourceIndex += sourceDelta;
      sourceLine += lineDelta;
      if (sourceIndex !== source) continue;
      const offset = starts[generatedLine]! + column;
      const around = ranges.filter((r) => r.startOffset <= offset && offset < r.endOffset);
      const narrowest = around.reduce<(typeof ranges)[number] | undefined>(
        (best, r) => (best === undefined || r.endOffset - r.startOffset < best.endOffset - best.startOffset ? r : best),
        undefined,
      );
      ran.set(sourceLine + 1, (ran.get(sourceLine + 1) ?? true) && (narrowest?.count ?? 0) > 0);
    }
  });
  const lines = [...ran.keys()].sort((a, b) => a - b);
  return { lines, uncovered: lines.filter((line) => !ran.get(line)) };
}
