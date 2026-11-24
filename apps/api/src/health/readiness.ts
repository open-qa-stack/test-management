import type { DatabaseState } from "@open-qa-stack/store";

/** Body of the readiness route: whether the instance can serve, and the state of what it depends on. */
export interface Readiness {
  readonly status: "ready" | "not_ready";
  readonly checks: { readonly database: DatabaseState["check"] };
}
