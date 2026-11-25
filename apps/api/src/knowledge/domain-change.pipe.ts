import { Injectable, type PipeTransform } from "@nestjs/common";
import type { DomainChange } from "@open-qa-stack/domain";
import { requestBody } from "../sessions/request-body.ts";
import { SessionError } from "../sessions/session-error.ts";

/** Validates the body of `PATCH /knowledge/domains/:id` before the route runs: a name, whether the domain is excluded, or both. */
@Injectable()
export class DomainChangePipe implements PipeTransform<unknown, DomainChange> {
  /** @throws {@link SessionError} `invalid_request` naming what is at fault. */
  transform(body: unknown): DomainChange {
    const { label, excluded } = requestBody(body, ["label", "excluded"], "a change of a domain");
    if (label === undefined && excluded === undefined) throw new SessionError("invalid_request", "A change of a domain holds label, excluded, or both.");
    if (label !== undefined && typeof label !== "string") throw new SessionError("invalid_request", "label must be a text.");
    if (excluded !== undefined && typeof excluded !== "boolean") throw new SessionError("invalid_request", "excluded must be true or false.");
    return { ...(label === undefined ? {} : { label }), ...(excluded === undefined ? {} : { excluded }) };
  }
}
