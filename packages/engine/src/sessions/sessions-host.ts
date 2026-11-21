import type { CommandRunner, DocumentStorePort, ExecutionStorePort, MemoryStorePort, ResolvedConfig, SessionStorePort } from "@open-qa-stack/domain";
import type { Configuration } from "../configuration/configuration.ts";
import type { OpenRuntime } from "../ports/open-runtime.ts";
import type { SessionsLogger } from "./sessions-logger.ts";
import type { WriterPace } from "./session-writer.ts";
import type { SessionsPace } from "./sessions-pace.ts";

/** What whoever hosts the operations on sessions gives them: where the sessions are kept, and what their runs work with. */
export interface SessionsHost {
  /** The store of the sessions: the truth of what the operations do. */
  readonly store: SessionStorePort;
  /** The operations on the configuration of the instance, which the runs read theirs from, in the test repository of the host. */
  readonly configuration: Configuration;
  /** The store of the documents of the knowledge sources the instance keeps, which the runs read. */
  readonly documents: DocumentStorePort;
  /** The store of the memories of the agents, which the runs recall and add to. */
  readonly memory: MemoryStorePort;
  /** The store of the executions of tests, which keeps the execution of the tests each session ran. */
  readonly executions: ExecutionStorePort;
  /**
   * Absolute path of the test repository the sessions run in, a folder that holds `oqas.json`; `undefined` for
   * a host that has none, which serves what the store keeps and opens no session.
   */
  readonly repository: string | undefined;
  /**
   * Whether the host stays to run whatever waits, as a server does: it then takes over the sessions that wait
   * for a host that died. A host that runs the session it opens and leaves, a command in a terminal, takes
   * none over: they wait for a host that stays.
   */
  readonly takesOver: boolean;
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
  /** The paces of the process among the others that reach the store; `DEFAULT_PACE` by default. */
  readonly pace?: SessionsPace;
}
