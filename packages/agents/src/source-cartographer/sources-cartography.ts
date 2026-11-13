import { runSources } from "../cartographer/run-sources.ts";
import type { CardSource } from "./card-subject.ts";
import { SourceCartographer, type SourceCartographerOptions, type SourceCartographyOutcome } from "./source-cartographer.ts";

/** What the cartography of every source of an environment needs. */
export interface SourcesCartographyOptions extends Omit<SourceCartographerOptions, "source"> {
  /** Name of the environment whose sources are mapped. */
  readonly environment: string;
  /** Most sources mapped at once, each in its own task; one by default. */
  readonly concurrency?: number;
}

/** The cartography of one source among those of an environment. */
export interface SourceCartographyResult {
  readonly source: CardSource;
  readonly outcome: SourceCartographyOutcome;
}

/**
 * Maps every source of an environment that has no up-to-date card, one task per source.
 *
 * @remarks
 * The sources are those the cartographer of the application reads: the knowledge sources attached to the
 * environment, or to none, then the user interface of each application that has one there. Each gets its
 * own cartographer, and so its own session; a source whose card is up to date is kept without the model.
 * Up to `concurrency` sources are mapped at once, in the order of the configuration.
 *
 * @param options - What the cartography needs.
 * @returns The outcome of each source, in the order of the configuration.
 * @throws Error when a card cannot be written to the disk.
 */
export async function mapSources(options: SourcesCartographyOptions): Promise<SourceCartographyResult[]> {
  const { environment, concurrency = 1, ...shared } = options;
  const sources = runSources(options.config, environment).map((source): CardSource => (source.type === "web" ? { id: source.id, type: "web", environment } : source.knowledge));
  const results: SourceCartographyResult[] = [];
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < sources.length; i = next++) {
      results[i] = { source: sources[i]!, outcome: await new SourceCartographer({ ...shared, source: sources[i]! }).run() };
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return results;
}
