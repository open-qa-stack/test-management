import { Injectable, type PipeTransform } from "@nestjs/common";
import { launchRequestOf } from "./launch-request.ts";
import type { LaunchRequest } from "@open-qa-stack/domain/sessions";

/** Validates the body of `POST /launches` before the route runs: the route and the operation only see a launch that is valid. */
@Injectable()
export class LaunchRequestPipe implements PipeTransform<unknown, LaunchRequest> {
  /** @throws {@link SessionError} `invalid_request` naming the field at fault. */
  transform(body: unknown): LaunchRequest {
    return launchRequestOf(body);
  }
}
