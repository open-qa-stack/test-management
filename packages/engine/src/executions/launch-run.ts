import {
  CONFIG_FILE_NAME,
  InvalidConfigurationError,
  LaunchRefusedError,
  validateConfig,
  type CommandRunner,
  type EndedLaunch,
  type ExecutionStorePort,
  type LaunchRequest,
  type ResolvedConfig,
  type TestLaunch,
} from "@open-qa-stack/domain";
import { PinnedRun } from "@open-qa-stack/harness";
import type { Configuration } from "../configuration/configuration.ts";
import { ExecutionRecorder } from "../sessions/execution-recorder.ts";

/** What a launch of tests works with. */
export interface LaunchHost {
  /** Absolute path of the test repository the tests run in. */
  readonly repository: string;
  /** The operations on the configuration of the instance, which the launch reads the one in force from. */
  readonly configuration: Configuration;
  /** Where the execution is kept. */
  readonly store: ExecutionStorePort;
  /** The environment of the process: the secrets and the accounts the configuration names. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Runs the commands of the tests; in the test repository by default. */
  readonly runner?: CommandRunner;
  readonly now: () => Date;
}

/**
 * One launch of tests of the repository, as they are, with no agent: the runner runs them at the version the
 * lockfile installs, against an environment the configuration declares, and their execution is kept with the
 * origin `manual`, or `campaign` for the tests of a campaign, as that of a session is.
 *
 * @remarks
 * The launch is made ready before it runs, so that what refuses it is told at once: a configuration that is
 * missing or not valid, an environment it does not declare, or none named when it declares several. Once
 * ready, it never fails: what the runner could not do — prepare the tests, reach the addresses, write its
 * report — and a store that refuses the execution end it with no execution, and say why.
 */
export class LaunchRun {
  /** The launch: the tests it runs, and where. */
  readonly launch: TestLaunch;
  readonly #host: LaunchHost;
  readonly #config: ResolvedConfig;

  private constructor(host: LaunchHost, config: ResolvedConfig, launch: TestLaunch) {
    this.#host = host;
    this.#config = config;
    this.launch = launch;
  }

  /**
   * Makes a launch ready: the configuration in force, the environment of the tests.
   *
   * @param host - What the launch works with.
   * @param request - The tests, and where.
   * @returns The launch, which has not run yet.
   * @throws `NoConfigurationError` or `InvalidConfigurationError` when the configuration in force is missing or not valid.
   * @throws `LaunchRefusedError` when the environment is not one the configuration declares, or none is named among several.
   */
  static async ready(host: LaunchHost, request: LaunchRequest): Promise<LaunchRun> {
    const revision = await host.configuration.synchronise();
    const result = validateConfig(JSON.stringify(revision.document), host.env);
    if (!result.ok) throw new InvalidConfigurationError(CONFIG_FILE_NAME, result.errors, revision.number);
    const declared = [...new Set(result.config.applications.flatMap((application) => application.environments.map((environment) => environment.name)))];
    const environment = request.environment ?? (declared.length === 1 ? declared[0] : undefined);
    if (environment === undefined)
      throw new LaunchRefusedError(`Several environments are declared (${declared.join(", ")}): name the one the tests run against.`);
    if (!declared.includes(environment))
      throw new LaunchRefusedError(`The environment ${environment} is not declared: the configuration declares ${declared.join(", ")}.`);
    const launch: TestLaunch = {
      startedAt: host.now().toISOString(),
      environment,
      paths: [...(request.paths ?? [])],
      ...(request.campaign === undefined ? {} : { campaign: request.campaign }),
    };
    return new LaunchRun(host, result.config, launch);
  }

  /**
   * Runs the tests, then keeps their execution.
   *
   * @returns How the launch ended: the execution it kept, or why it kept none. It never rejects.
   */
  async run(): Promise<EndedLaunch> {
    const { repository, configuration, store, env, runner, now } = this.#host;
    const { environment, paths, campaign } = this.launch;
    const ended = (end: Pick<EndedLaunch, "execution" | "failure">): EndedLaunch => ({ ...this.launch, endedAt: now().toISOString(), ...end });
    try {
      const pinned = new PinnedRun({
        config: this.#config,
        environment,
        repositoryRoot: repository,
        tests: paths,
        env,
        now,
        ...(runner === undefined ? {} : { runner }),
      });
      // A launch of every test names none: what stops the preparation is told before the run, which would say it of no test.
      const prepared = await pinned.prepare();
      if (!prepared.ok) return ended({ failure: prepared.reason });
      const { result } = await pinned.run();
      if (result.report === undefined) return ended({ failure: result.tests[0]?.reason ?? "The runner wrote no report." });
      const execution = await new ExecutionRecorder({ repository, configuration, store, now }).record(
        result.report,
        campaign === undefined ? { origin: "manual" } : { origin: "campaign", campaignId: campaign },
      );
      // The run read the report it wrote: the recorder reads it as well.
      return ended({ execution: execution!.id });
    } catch (error) {
      return ended({ failure: error instanceof Error ? error.message : String(error) });
    }
  }
}
