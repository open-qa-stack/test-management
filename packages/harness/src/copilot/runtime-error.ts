import { ModelKeyRefusedError, ModelResponseError, ModelUnreachableError, ReplayMissError, type AgentRuntimeError } from "@open-qa-stack/domain";
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
      if (failure.status === 401 || failure.status === 403) return new ModelKeyRefusedError(failure.status);
      return new ModelResponseError(
        failure.reason === undefined
          ? `The model answered with status ${failure.status}.`
          : `The model answered with status ${failure.status}: ${failure.reason}`,
      );
    case "timed-out":
      return new ModelResponseError(`The model gave no answer within ${failure.seconds} seconds, ${failure.attempts} times in a row.`);
    case "invalid-response":
      return new ModelResponseError("The model answered with a body that is not JSON.");
    case "invalid-request":
      return new ModelResponseError("The model runtime sent a request the gateway could not read.");
    case "task-stopped":
      return new ModelResponseError("The task was stopped by a limit before the model call.");
    case "unsupported":
      return new ModelResponseError(`The model runtime sent a request the gateway does not support: ${failure.path}.`);
    case undefined:
      return new ModelResponseError("The model call failed.");
  }
}
