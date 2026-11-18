import { Injectable, type PipeTransform } from "@nestjs/common";
import { sessionOpeningOf } from "./session-opening.ts";
import type { SessionOpening } from "@open-qa-stack/domain/sessions";

/** Validates the body of `POST /sessions` before the route runs: the route and the service only see an opening that is valid. */
@Injectable()
export class SessionOpeningPipe implements PipeTransform<unknown, SessionOpening> {
  /** @throws {@link SessionError} `invalid_request` naming the field at fault. */
  transform(body: unknown): SessionOpening {
    return sessionOpeningOf(body);
  }
}
