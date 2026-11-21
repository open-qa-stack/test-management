import type { ModelChoice, ModelConnectionCheck } from "@open-qa-stack/domain";

/** Longest wait for a provider to list its models, in milliseconds. */
export const LIST_TIMEOUT_MS = 10_000;

/**
 * Checks the connection to an OpenAI-compatible server by listing its models, `GET <baseUrl>/models`, with the key
 * when there is one.
 *
 * @param baseUrl - The address of the API of the server.
 * @param apiKey - The key, or `undefined` for a server that needs none.
 * @returns `connected` with the models the server lists, or without a list when the server gives none;
 * `key-refused` when it answers `401` or `403`; `unreachable` when nothing answers in time.
 */
export async function checkProviderModels(baseUrl: string, apiKey: string | undefined): Promise<ModelConnectionCheck> {
  const url = new URL("models", `${baseUrl.replace(/\/+$/, "")}/`).href;
  const headers: Record<string, string> = apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` };
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
  } catch {
    return { state: "unreachable", url: baseUrl };
  }
  if (response.status === 401 || response.status === 403) return { state: "key-refused", status: response.status };
  const models = response.ok ? listed(await response.json().catch(() => undefined)) : undefined;
  return models === undefined ? { state: "connected" } : { state: "connected", models };
}

/** The models of an answer of the OpenAI form, `{ data: [{ id }] }`, sorted by name; `undefined` for any other answer, or an empty list. */
function listed(body: unknown): ModelChoice[] | undefined {
  const data = (body as { data?: unknown } | undefined)?.data;
  if (!Array.isArray(data)) return undefined;
  const ids = data.flatMap((item) => (typeof (item as { id?: unknown }).id === "string" ? [(item as { id: string }).id] : []));
  if (ids.length === 0) return undefined;
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b)).map((id) => ({ id, name: id, reasoningEfforts: [] }));
}
