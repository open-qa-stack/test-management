import { requestBody } from "./request-body.ts";
import { SessionError } from "./session-error.ts";
import type { SessionOpening, SessionScope, TestLevel } from "@open-qa-stack/domain/sessions";

/** The fields a client may send; the type keeps the list to those of an opening. */
const FIELDS = ["request", "environment", "scope"] as const satisfies readonly (keyof SessionOpening)[];

/** The lists a scope may hold. */
const SCOPE_FIELDS = ["applications", "domains", "levels"] as const satisfies readonly (keyof SessionScope)[];

/** The levels of the pyramid of tests a scope may name. */
const LEVELS: readonly TestLevel[] = ["smoke", "functional", "business", "cross-application", "end-to-end"];

/** Most identifiers a list of a scope holds. */
export const MAX_SCOPE_ITEMS = 50;

/** An identifier of an application or of a domain, as the configuration and the cartography write them. */
const IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Longest request a person may send, in characters: it is handed whole to the agents, and to a command line as one argument. */
export const MAX_REQUEST_LENGTH = 4000;

/**
 * Whether a value is a text a session can be opened with: one that holds more than spaces, and that a
 * command line cannot take for one of its options.
 */
function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !value.startsWith("--");
}

/**
 * Reads the body of a request to open a session.
 *
 * @param body - The body, as the client sent it.
 * @returns What to test, and the environment when the client names one.
 * @throws {@link SessionError} `invalid_request` naming the field at fault: a body that is no JSON object, a
 * field that is none of an opening, `request` that is not a text, is empty, starts with `--` or is longer than
 * {@link MAX_REQUEST_LENGTH}, `environment` that is given and is not a text, is empty or starts with `--`.
 */
export function sessionOpeningOf(body: unknown): SessionOpening {
  const { request, environment, scope } = requestBody(body, FIELDS, "a request to open a session");
  const scoped = scope === undefined ? {} : { scope: scopeOf(scope) };
  if (!isText(request)) throw new SessionError("invalid_request", "request must be a text that is not empty and does not start with --.");
  if (request.length > MAX_REQUEST_LENGTH) throw new SessionError("invalid_request", `request must not be longer than ${MAX_REQUEST_LENGTH} characters.`);
  if (environment === undefined) return { request, ...scoped };
  if (!isText(environment)) {
    throw new SessionError("invalid_request", "environment must be a text that is not empty and does not start with -- when it is given.");
  }
  return { request, environment, ...scoped };
}

/**
 * Reads the scope of an opening: lists of identifiers of applications and domains, and of levels.
 *
 * @throws {@link SessionError} `invalid_request` naming the field at fault.
 */
function scopeOf(scope: unknown): SessionScope {
  const { applications, domains, levels } = requestBody(scope, SCOPE_FIELDS, "a scope");
  const list = (value: unknown, name: string, valid: (item: unknown) => boolean): readonly string[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > MAX_SCOPE_ITEMS || !value.every(valid))
      throw new SessionError(
        "invalid_request",
        `scope.${name} must be a list of at most ${MAX_SCOPE_ITEMS} ${name === "levels" ? `levels among ${LEVELS.join(", ")}` : "identifiers"}.`,
      );
    return [...new Set(value as string[])];
  };
  const identifier = (item: unknown): boolean => typeof item === "string" && IDENTIFIER.test(item);
  const read = {
    applications: list(applications, "applications", identifier),
    domains: list(domains, "domains", identifier),
    levels: list(levels, "levels", (item) => LEVELS.includes(item as TestLevel)) as readonly TestLevel[] | undefined,
  };
  return Object.fromEntries(Object.entries(read).filter(([, value]) => value !== undefined && value.length > 0)) as SessionScope;
}
