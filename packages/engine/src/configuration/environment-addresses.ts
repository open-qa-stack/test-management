import type { AddressCheck } from "@open-qa-stack/domain";

/** How long an address has to answer, in milliseconds. */
export const ADDRESS_TIMEOUT_MS = 10_000;

/** The codes of the system that say no machine has the name of an address. */
const UNKNOWN_HOST = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NONAME"]);

/**
 * The test of the addresses of the environments of an application — that of its interface, those of its APIs —, as
 * the person types them, before or after they are saved: it tells whether something answers there, and why not
 * otherwise, in time for a typo to be corrected before a session breaks on it. It writes nothing and calls no model.
 */
export class EnvironmentAddresses {
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  /**
   * @param options - How long an address has to answer, in milliseconds, and what asks it; fetch by default.
   */
  constructor({ timeoutMs = ADDRESS_TIMEOUT_MS, fetch: asks = fetch }: { readonly timeoutMs?: number; readonly fetch?: typeof fetch } = {}) {
    this.#timeoutMs = timeoutMs;
    this.#fetch = asks;
  }

  /**
   * Tests that an address answers: any HTTP answer in time, whatever its status, is one; a redirection is not followed.
   *
   * @param address - The address, as the person typed it.
   * @returns What the test found, the address said without the name and the password it carries.
   */
  async check(address: string): Promise<AddressCheck> {
    const url = URL.parse(address.trim());
    if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) return { state: "malformed", url: address };
    url.username = "";
    url.password = "";
    const shown = url.href;
    try {
      const response = await this.#fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(this.#timeoutMs) });
      await response.body?.cancel();
      return { state: "answers", url: shown, status: response.status };
    } catch (failure) {
      // The signal aborts the request only when its time is over.
      if (failure instanceof DOMException) return { state: "timeout", url: shown };
      const code = codeOf(failure);
      if (code !== undefined && UNKNOWN_HOST.has(code)) return { state: "unknown-host", url: shown };
      if (code === "ECONNREFUSED") return { state: "refused", url: shown };
      return { state: "unreachable", url: shown, ...(code === undefined ? {} : { code }) };
    }
  }
}

/** The code of the system a failed request carries, as fetch keeps it in the cause of the error it rejects with. */
function codeOf(failure: unknown): string | undefined {
  const cause = (failure as Error).cause as { code?: unknown } | undefined;
  return typeof cause?.code === "string" ? cause.code : undefined;
}
