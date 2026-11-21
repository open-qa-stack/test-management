import { Injectable, type PipeTransform } from "@nestjs/common";
import { isRecord } from "@open-qa-stack/domain";
import { SessionError } from "../sessions/session-error.ts";

/** Takes the body of `PUT /secrets/:name`: the value of the variable. */
@Injectable()
export class SecretValuePipe implements PipeTransform<unknown, string> {
  /**
   * @param body - The body of the request.
   * @returns The value it holds.
   * @throws `SessionError` `invalid_request` when the body is not an object whose `value` is a text.
   */
  transform(body: unknown): string {
    if (!isRecord(body) || typeof body["value"] !== "string")
      throw new SessionError("invalid_request", 'The body must be an object whose "value" is the value of the variable, as a text.');
    return body["value"];
  }
}
