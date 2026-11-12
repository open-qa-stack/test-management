/** Variables the Copilot runtime needs to start; every other variable, keys included, stays out. */
const PASSED = ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TMPDIR", "TMP", "TEMP", "SystemRoot"] as const;

/**
 * Builds the environment of the Copilot runtime process.
 *
 * @remarks
 * The process is third-party code that writes logs; it gets no variable it does not need, so that a key
 * held in the environment never reaches it.
 *
 * @param source - The environment of the harness, usually `process.env`.
 * @returns The variables the runtime needs, with its own telemetry off.
 */
export function runtimeEnvironment(source: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const passed = PASSED.flatMap((name) => (source[name] === undefined ? [] : [[name, source[name]] as const]));
  return { ...Object.fromEntries(passed), COPILOT_TELEMETRY_DISABLED: "true" };
}
