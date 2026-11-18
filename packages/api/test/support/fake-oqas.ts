import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandLine } from "../../src/config/command-line.ts";
import { temporaryFolder } from "./test-repository.ts";

/** What each fake of the `oqas` command line does once started. */
const FAKES = {
  /**
   * Starts a run: writes a journal whose first entry tells the arguments it was given and whose second names
   * the variables of its environment, then goes on for a moment.
   */
  starts: `
    import { appendFileSync, mkdirSync } from "node:fs";
    import { join } from "node:path";
    const argv = process.argv.slice(2);
    const runs = join(argv[argv.indexOf("--repository") + 1], ".oqas", "runs");
    mkdirSync(runs, { recursive: true });
    const now = new Date();
    const entry = { at: now.toISOString(), step: "configuration", event: "info", message: JSON.stringify(argv) };
    const given = { ...entry, message: "environment: " + Object.keys(process.env).sort().join(",") };
    appendFileSync(join(runs, "oqas-" + now.toISOString().replace(/[:.]/g, "-") + ".jsonl"), JSON.stringify(entry) + "\\n" + JSON.stringify(given) + "\\n");
    setTimeout(() => {}, 150);
  `,
  /** Starts a run, and stops at once: writes a journal, then exits. */
  flashes: `
    import { mkdirSync, writeFileSync } from "node:fs";
    import { join } from "node:path";
    const argv = process.argv.slice(2);
    const runs = join(argv[argv.indexOf("--repository") + 1], ".oqas", "runs");
    mkdirSync(runs, { recursive: true });
    writeFileSync(join(runs, "oqas-" + new Date().toISOString().replace(/[:.]/g, "-") + ".jsonl"), "{}\\n");
  `,
  /** Refuses to run: writes twelve lines to its error output, then exits with an error. */
  fails: `
    for (let line = 1; line <= 12; line++) console.error("error line " + line);
    console.error("");
    process.exitCode = 3;
  `,
  /** Exits at once, without a word. */
  leaves: "",
  /**
   * Never starts a run: starts a program of its own that waits, tells both process identifiers in the
   * repository, then waits too.
   */
  hangs: `
    import { spawn } from "node:child_process";
    import { writeFileSync } from "node:fs";
    import { join } from "node:path";
    const argv = process.argv.slice(2);
    const started = spawn(process.execPath, ["--eval", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    writeFileSync(join(argv[argv.indexOf("--repository") + 1], "pids"), process.pid + " " + started.pid);
    setInterval(() => {}, 1000);
  `,
} as const;

/**
 * Writes a fake of the `oqas` command line.
 *
 * @param behaviour - What it does once started.
 * @param leading - Arguments the command carries before those it is started with.
 * @returns The command that starts it.
 */
export function fakeOqas(behaviour: keyof typeof FAKES, ...leading: string[]): CommandLine {
  const script = join(temporaryFolder(), "oqas.mjs");
  writeFileSync(script, FAKES[behaviour]);
  return [process.execPath, script, ...leading];
}
