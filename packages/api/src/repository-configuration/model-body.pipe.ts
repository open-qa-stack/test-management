import { Injectable, type PipeTransform } from "@nestjs/common";
import { isModel, type Model } from "@open-qa-stack/domain";
import { SessionError } from "../sessions/session-error.ts";

/** Takes the body of a test of the connection to the model: the section `model` of a configuration, as the person drafts it. */
@Injectable()
export class ModelBodyPipe implements PipeTransform<unknown, Model> {
  /**
   * @param body - The body of the request.
   * @returns The connection to the model it holds.
   * @throws `SessionError` `invalid_request` when the body is not a connection the configuration would accept.
   */
  transform(body: unknown): Model {
    if (!isModel(body))
      throw new SessionError("invalid_request", "The body must be the section model of a configuration: a connection the configuration accepts.");
    return body;
  }
}
