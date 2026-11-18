/**
 * Asks a detached program and every program it started to stop: a command line is often a launcher, and
 * stopping the launcher alone would leave what it launched at work.
 *
 * @param pid - The process identifier of the program, which leads its own group; `undefined` when it never started.
 */
export function stopProcessGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // The group is already gone: nothing is left to stop.
  }
}
