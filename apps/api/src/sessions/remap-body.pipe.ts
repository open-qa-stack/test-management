import { Injectable, type PipeTransform } from "@nestjs/common";
import { isRecord } from "@open-qa-stack/domain";
import { SessionError } from "./session-error.ts";

/** Takes the body of a request to map the knowledge again: the identifier of one source under `source`, or none for every source. */
@Injectable()
export class RemapBodyPipe implements PipeTransform<unknown, string | undefined> {
  /**
   * @param body - The body of the request: none, or an object.
   * @returns The source named; none for every source.
   * @throws `SessionError` `invalid_request` when the body is no object, or names its source by something else than a text.
   */
  transform(body: unknown): string | undefined {
    // A request without a body is given none: it maps every source, as an empty object does.
    const source = body === undefined ? undefined : isRecord(body) ? body["source"] : null;
    if (source === undefined || typeof source === "string") return source;
    throw new SessionError("invalid_request", 'The body must be empty, or name the source to map again as a text under "source".');
  }
}
