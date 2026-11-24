import { Injectable, type PipeTransform } from "@nestjs/common";
import { isRecord } from "@open-qa-stack/domain";
import { SessionError } from "../sessions/session-error.ts";

/**
 * Takes the body of a test of an address of an environment: the address, under `address`, as the person typed it,
 * whatever it holds — the test says when it is no address.
 */
@Injectable()
export class AddressBodyPipe implements PipeTransform<unknown, string> {
  /**
   * @param body - The body of the request.
   * @returns The address.
   * @throws `SessionError` `invalid_request` when the body holds no text under `address`.
   */
  transform(body: unknown): string {
    const address = isRecord(body) ? body["address"] : undefined;
    if (typeof address !== "string") throw new SessionError("invalid_request", 'The body must hold the address to test, as a text under "address".');
    return address;
  }
}
