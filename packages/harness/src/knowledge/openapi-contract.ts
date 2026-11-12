import type { OpenApiKnowledge } from "@open-qa-stack/shared";
import { readRepositoryFile } from "./repository-file.ts";

/** An operation of an OpenAPI contract, as the list tool shows it. */
export interface OperationSummary {
  /** HTTP method, upper case. */
  readonly method: string;
  /** Path of the operation, as the contract writes it. */
  readonly path: string;
  readonly operationId?: string;
  readonly summary?: string;
}

/** The HTTP methods an OpenAPI path item may hold operations for. */
export const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

/** Longest wait for a contract served at a URL, in milliseconds. */
export const CONTRACT_TIMEOUT_MS = 10_000;

/** How deep `$ref` are resolved in an operation; deeper ones are left as they are. */
const MAX_REF_DEPTH = 8;

type JsonObject = Record<string, unknown>;

/**
 * The contract of an OpenAPI knowledge source, loaded on first use and kept.
 *
 * @remarks
 * A contract served at a URL is fetched with a time limit and without following redirects, so that it
 * comes from the declared address only; one stored in the repository is read from it. A failed load is
 * not kept, so that a later call tries again.
 */
export class OpenApiContract {
  private readonly knowledge: OpenApiKnowledge;
  private readonly repositoryRoot: string;
  private loaded: Promise<JsonObject> | undefined;

  /**
   * @param knowledge - The knowledge source, with its URL or its path.
   * @param repositoryRoot - Absolute path of the test repository, for a contract stored in it.
   */
  public constructor(knowledge: OpenApiKnowledge, repositoryRoot: string) {
    this.knowledge = knowledge;
    this.repositoryRoot = repositoryRoot;
  }

  /**
   * @returns Every operation of the contract, in the order of the document.
   * @throws Error when the contract cannot be loaded.
   */
  public async operations(): Promise<OperationSummary[]> {
    const paths = child(await this.document(), "paths");
    if (!isPlainObject(paths)) return [];
    return Object.entries(paths).flatMap(([path, item]) =>
      HTTP_METHODS.flatMap((method) => {
        const operation = child(item, method);
        return isPlainObject(operation) ? [summarize(method, path, operation)] : [];
      }),
    );
  }

  /**
   * @param method - HTTP method, in any case.
   * @param path - Path of the operation, as the contract writes it.
   * @returns The operation with the parameters of its path and its local `$ref` resolved, or `undefined`
   * when the contract has no such operation.
   * @throws Error when the contract cannot be loaded.
   */
  public async operation(method: string, path: string): Promise<unknown> {
    const key = method.toLowerCase();
    if (!(HTTP_METHODS as readonly string[]).includes(key)) return undefined;
    const document = await this.document();
    const item = child(child(document, "paths"), path);
    const operation = child(item, key);
    if (!isPlainObject(operation)) return undefined;
    const parameters = mergeParameters(child(item, "parameters"), operation["parameters"]);
    return resolveRefs({ ...operation, ...(parameters.length === 0 ? {} : { parameters }) }, document, 0);
  }

  private document(): Promise<JsonObject> {
    this.loaded ??= this.load().catch((failure: unknown) => {
      this.loaded = undefined;
      throw failure;
    });
    return this.loaded;
  }

  private async load(): Promise<JsonObject> {
    const { knowledge } = this;
    const text = knowledge.url === undefined ? await readRepositoryFile(this.repositoryRoot, knowledge.path) : await fetchContract(knowledge.url);
    const document: unknown = JSON.parse(text);
    return isPlainObject(document) ? document : {};
  }
}

async function fetchContract(url: string): Promise<string> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(CONTRACT_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`The contract at ${url} answered with status ${response.status}.`);
  return response.text();
}

function summarize(method: string, path: string, operation: JsonObject): OperationSummary {
  const { operationId, summary } = operation;
  return {
    method: method.toUpperCase(),
    path,
    ...(typeof operationId === "string" ? { operationId } : {}),
    ...(typeof summary === "string" ? { summary } : {}),
  };
}

/** Path parameters apply to every operation of the path, unless the operation redefines one with the same name and location. */
function mergeParameters(fromPath: unknown, fromOperation: unknown): unknown[] {
  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  const identity = (parameter: unknown) => `${String(child(parameter, "in"))}:${String(child(parameter, "name"))}`;
  const redefined = new Set(list(fromOperation).map(identity));
  return [...list(fromPath).filter((p) => !redefined.has(identity(p))), ...list(fromOperation)];
}

/** Replaces local `$ref` (`#/…`) by what they point to, to a bounded depth, so that the model reads one self-contained operation. */
function resolveRefs(value: unknown, document: JsonObject, depth: number): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, document, depth));
  if (!isPlainObject(value)) return value;
  const ref = value["$ref"];
  if (typeof ref === "string" && ref.startsWith("#/") && depth < MAX_REF_DEPTH) {
    const target = ref.slice(2).split("/").reduce<unknown>((node, segment) => child(node, segment.replaceAll("~1", "/").replaceAll("~0", "~")), document);
    return resolveRefs(target, document, depth + 1);
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, document, depth)]));
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The own property `key` of `value`, or `undefined` when `value` is not an object or has no such property. */
function child(value: unknown, key: string): unknown {
  return isPlainObject(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}
