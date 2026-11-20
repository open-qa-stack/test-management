import { requestBody } from "./request-body.ts";
import { SessionError } from "./session-error.ts";
import type { LaunchRequest } from "@open-qa-stack/domain/sessions";

/** The fields a client may send; the type keeps the list to those of a launch. */
const FIELDS = ["paths", "environment"] as const satisfies readonly (keyof LaunchRequest)[];

/** Most files of tests a launch names: beyond, it launches every test of the repository instead. */
export const MAX_LAUNCH_PATHS = 500;

/** A path of a file of tests the runner can be given: relative, inside the repository, and that it cannot take for one of its options. */
function isPath(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !/^[-/\\]|^[A-Za-z]:|(^|[/\\])\.\.([/\\]|$)/.test(value);
}

/**
 * Reads the body of a request to launch tests.
 *
 * @param body - The body, as the client sent it.
 * @returns The files of tests, and the environment, each when the client names it.
 * @throws {@link SessionError} `invalid_request` naming the field at fault: a body that is no JSON object, a field
 * that is none of a launch, `paths` that is not a list of at most {@link MAX_LAUNCH_PATHS} paths relative to the
 * repository and inside it, `environment` that is given and is not a text, is empty or starts with `--`.
 */
export function launchRequestOf(body: unknown): LaunchRequest {
  const { paths, environment } = requestBody(body, FIELDS, "a request to launch tests");
  if (paths !== undefined && (!Array.isArray(paths) || paths.length > MAX_LAUNCH_PATHS || !paths.every(isPath)))
    throw new SessionError(
      "invalid_request",
      `paths must be a list of at most ${MAX_LAUNCH_PATHS} files of tests, relative to the test repository and inside it; leave it out to launch every test.`,
    );
  if (environment !== undefined && (typeof environment !== "string" || environment.trim() === "" || environment.startsWith("--")))
    throw new SessionError("invalid_request", "environment must be a text that is not empty and does not start with -- when it is given.");
  return { ...(paths === undefined ? {} : { paths: paths as string[] }), ...(environment === undefined ? {} : { environment }) };
}
