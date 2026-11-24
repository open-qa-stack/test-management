import { Injectable, type PipeTransform } from "@nestjs/common";
import { isModel, isRecord, type Model } from "@open-qa-stack/domain";
import { SessionError } from "../sessions/session-error.ts";

/** A test of the connection to the model: the connection as the person drafts it, and the key they typed and did not save yet. */
export interface ModelTest {
  readonly model: Model;
  readonly key?: string;
}

/**
 * Takes the body of a test of the connection to the model: the section `model` of a configuration, as the person
 * drafts it, and beside its keys, under `key`, the key they typed when they did not save it yet.
 */
@Injectable()
export class ModelBodyPipe implements PipeTransform<unknown, ModelTest> {
  /**
   * @param body - The body of the request.
   * @returns The connection to the model it holds, and the key typed.
   * @throws `SessionError` `invalid_request` when the body is not a connection the configuration would accept, or its key is no text.
   */
  transform(body: unknown): ModelTest {
    const { key, ...model } = isRecord(body) ? body : {};
    if (!isModel(model) || (key !== undefined && typeof key !== "string"))
      throw new SessionError(
        "invalid_request",
        'The body must be the section model of a configuration: a connection the configuration accepts, with the key typed as a text under "key", when there is one.',
      );
    return typeof key === "string" ? { model, key } : { model };
  }
}
