/**
 * The version of `@playwright/test` an npm lockfile installs.
 *
 * @param lockfile - The text of `package-lock.json`.
 * @returns The installed version; none when the lockfile cannot be read or does not install the package.
 */
export function lockedPlaywrightVersion(lockfile: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(lockfile);
  } catch {
    return undefined;
  }
  const version = (parsed as { packages?: Record<string, { version?: unknown }> } | null)?.packages?.["node_modules/@playwright/test"]?.version;
  return typeof version === "string" ? version : undefined;
}
