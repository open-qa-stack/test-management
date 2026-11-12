import { ModelResponseError, ModelUnreachableError, ReplayMissError, type AgentRuntimeError } from "@open-qa-stack/domain";
import type { GatewayFailure } from "../model-gateway/gateway-failure.ts";

/**
 * Names the error a failed model call stands for.
 *
 * @param failure - What the gateway saw, if anything.
 * @returns The error to report in the session's `error` event.
 */
export function runtimeError(failure: GatewayFailure | undefined): AgentRuntimeError {
  switch (failure?.kind) {
    case "unreachable":
      return new ModelUnreachableError(failure.url);
    case "replay-miss":
      return new ReplayMissError(failure.request);
    case "upstream-status":
      return new ModelResponseError(`The model answered with status ${failure.status}.`);
    case "invalid-response":
      return new ModelResponseError("The model answered with a body that is not JSON.");
    case "invalid-request":
      return new ModelResponseError("The model runtime sent a request the gateway could not read.");
    case "unsupported":
      return new ModelResponseError(`The model runtime sent a request the gateway does not support: ${failure.path}.`);
    case undefined:
      return new ModelResponseError("The model call failed.");
  }
}
