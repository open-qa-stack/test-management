import { join } from "node:path";
import type { ResolvedConfig, TraceLine } from "@open-qa-stack/domain";
import { configSecrets } from "./config-secrets.ts";
import { Trace } from "./trace.ts";

/** What a run needs to open its trace. */
export interface RunTraceOptions {
  /** The resolved configuration, whose state folder holds the traces and whose secrets are masked. */
  readonly config: ResolvedConfig;
  /** Absolute path of the test repository. */
  readonly repositoryRoot: string;
  /** The environment the configuration reads its secrets from. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Receives each line as it is written. */
  readonly observe?: (line: TraceLine) => void;
}

/**
 * Opens the trace of a run in the state folder of the test repository.
 *
 * @param options - The configuration, the repository, the environment and the observer.
 * @param name - What the run is, as `cartography-local`.
 * @param now - The clock of the run.
 * @returns The trace, named by `name` and the date the run starts.
 */
export function runTrace(options: RunTraceOptions, name: string, now: () => Date): Trace {
  const { config, repositoryRoot, env, observe } = options;
  return new Trace(Trace.pathFor(join(repositoryRoot, config.repository.stateDir), name, now()), {
    secrets: configSecrets(config, env),
    now,
    ...(observe === undefined ? {} : { observe }),
  });
}
