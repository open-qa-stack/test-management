import type { CommandRunner, ResolvedConfig, SessionStorePort } from "@open-qa-stack/domain";
import type { OpenRuntime } from "../ports/open-runtime.ts";
import type { SessionsLogger } from "./sessions-logger.ts";
import type { WriterPace } from "./session-writer.ts";

/** What whoever hosts the operations on sessions gives them: where the sessions are kept, and what their runs work with. */
export interface SessionsHost {
  /** The store of the sessions: the truth of what the operations do. */
  readonly store: SessionStorePort;
  /**
   * Absolute path of the test repository the sessions run in, a folder that holds `oqas.json`; `undefined` for
   * a host that has none, which serves what the store keeps and opens no session.
   */
  readonly repository: string | undefined;
  /** The environment of the runs: the secrets and the accounts the configuration of the repository names. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Where the operations report what happens to a session, and what goes wrong around it. */
  readonly logger: SessionsLogger;
  /** Opens the runtime of the agents of a run; on the model of the configuration, with the key `env` holds, by default. */
  readonly openRuntime?: (config: ResolvedConfig) => Promise<OpenRuntime>;
  /** Runs the commands of the machine and of the tests; in the test repository by default. */
  readonly runner?: CommandRunner;
  /** The clock of the runs; that of the machine by default. */
  readonly now?: () => Date;
  /** How a write to the store that failed is made again; the pace of the writer by default. */
  readonly writerPace?: WriterPace;
}
