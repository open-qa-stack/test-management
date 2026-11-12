import type { Recording, RecordingOrigin } from "./recording.ts";
import type { Upstream } from "./upstream.ts";

/** How the gateway answers the model runtime. */
export type GatewayMode =
  /** Serves the exchanges of a recording; never contacts a model. */
  | { readonly kind: "replay"; readonly recording: Recording }
  /** Forwards to the upstream server and records every successful exchange. */
  | { readonly kind: "record"; readonly upstream: Upstream; readonly origin: Extract<RecordingOrigin, { kind: "recorded" }> }
  /** Forwards to the upstream server. */
  | { readonly kind: "live"; readonly upstream: Upstream };
