import type { Application } from "./types.ts";

/** What the agents do in an environment that it may not allow: write tests, run them. */
export type EnvironmentActivity = "design" | "run";

/** What each activity is called in a refusal. */
const DOING: Readonly<Record<EnvironmentActivity, string>> = { design: "Writing tests", run: "Running tests" };

/**
 * Tells why an activity is refused in an environment, when an application its environment of that name does not allow
 * it: none otherwise. An environment allows each activity unless its `allow` says `false`.
 *
 * @param applications - The applications the session or the launch acts on.
 * @param environment - The name of the environment.
 * @param activity - What is asked there.
 * @returns Why it is refused, naming the applications that forbid it and what to do; nothing when it is allowed.
 */
export function activityRefusal(applications: readonly Application[], environment: string, activity: EnvironmentActivity): string | undefined {
  const forbidding = applications.filter(({ environments }) => environments.find(({ name }) => name === environment)?.allow?.[activity] === false);
  if (forbidding.length === 0) return undefined;
  const names = forbidding.map(({ name }) => name).join(", ");
  return `${DOING[activity]} is not allowed on the environment ${environment} of ${names}: allow it in the settings of that environment, or choose another one.`;
}
