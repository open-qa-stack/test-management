import { execFile } from "node:child_process";
import type { ContainerEngine } from "@open-qa-stack/shared";
import { lineInstant } from "./log-instant.ts";
import type { LogLines, LogSource } from "./log-source.ts";

/** Longest the engine may take to give the logs, in milliseconds. */
export const ENGINE_TIMEOUT_MS = 10_000;
/** Most bytes read from each output of the engine; the rest is left out. */
export const MAX_ENGINE_OUTPUT_BYTES = 10_000_000;
/**
 * The variables an engine needs to reach its service, passed on from the environment of the harness; no
 * other is, so that its keys and connection strings never reach the engine.
 */
export const ENGINE_VARIABLES = ["PATH", "HOME", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "CONTAINER_HOST", "CONTAINER_CONNECTION", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"];

/**
 * The logs of a container, read by the command line of its engine.
 *
 * @remarks
 * The only command run is `<engine> logs --timestamps --since <instant> -- <container>`, without a shell. The
 * container comes from the configuration; the instant is written by the harness from a parsed date, so that
 * no text of the agent reaches the command. The standard and error outputs of the container are merged in
 * the order of their timestamps.
 */
export class ContainerLogs implements LogSource {
  private readonly engine: ContainerEngine;
  private readonly container: string;
  private readonly timeoutMs: number;

  /**
   * @param engine - The engine that runs the container.
   * @param container - Name of the container.
   * @param timeoutMs - Longest the engine may take; `ENGINE_TIMEOUT_MS` by default.
   */
  public constructor(engine: ContainerEngine, container: string, timeoutMs = ENGINE_TIMEOUT_MS) {
    this.engine = engine;
    this.container = container;
    this.timeoutMs = timeoutMs;
  }

  /** {@inheritDoc LogSource.lines} */
  public lines(since: number): Promise<LogLines> {
    const args = ["logs", "--timestamps", "--since", new Date(since).toISOString(), "--", this.container];
    const env = Object.fromEntries(ENGINE_VARIABLES.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]])));
    return new Promise((resolve, reject) => {
      execFile(this.engine, args, { env, timeout: this.timeoutMs, maxBuffer: MAX_ENGINE_OUTPUT_BYTES, encoding: "utf8" }, (failure, stdout, stderr) => {
        const code = (failure as { code?: unknown } | null)?.code;
        const cut = code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        if (failure !== null && !cut) {
          reject(new Error(this.failure(code, failure.killed === true, stderr)));
          return;
        }
        resolve({ lines: byInstant([...outputLines(stdout), ...outputLines(stderr)]), cut });
      });
    });
  }

  private failure(code: unknown, killed: boolean, stderr: string): string {
    if (typeof code === "string") return `${this.engine} cannot be run: ${code}.`;
    if (killed) return `${this.engine} logs ran out of time.`;
    return `${this.engine} cannot read the logs of ${this.container}: ${stderr.trim().split("\n")[0]}`;
  }
}

function outputLines(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => line !== "");
}

/** Orders lines by the timestamp the engine puts first, keeping the order of the lines that share one. */
function byInstant(lines: readonly string[]): string[] {
  return lines.map((line) => ({ line, instant: lineInstant(line) ?? 0 })).sort((a, b) => a.instant - b.instant).map(({ line }) => line);
}
