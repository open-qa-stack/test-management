import { Injectable, type PipeTransform } from "@nestjs/common";
import { isKnowledgeSource, isRecord, type Knowledge } from "@open-qa-stack/domain";
import { SessionError } from "../sessions/session-error.ts";

/** A test of a knowledge source: the source as the person drafts it, and the connection string they typed and did not save yet. */
export interface SourceTest {
  readonly source: Knowledge;
  readonly value?: string;
}

/**
 * Takes the body of a test of a knowledge source: an item of the section `knowledge` of a configuration, as the person
 * drafts it, and beside its keys, under `value`, the connection string they typed for a database when they did not save it.
 */
@Injectable()
export class SourceBodyPipe implements PipeTransform<unknown, SourceTest> {
  /**
   * @param body - The body of the request.
   * @returns The source it holds, and the value typed.
   * @throws `SessionError` `invalid_request` when the body is not a source the configuration would accept, or its value is no text.
   */
  transform(body: unknown): SourceTest {
    const { value, ...source } = isRecord(body) ? body : {};
    if (!isKnowledgeSource(source) || (value !== undefined && typeof value !== "string"))
      throw new SessionError(
        "invalid_request",
        'The body must be a knowledge source of a configuration, its identifier and its attachments left out at will, with the connection string typed as a text under "value", when there is one.',
      );
    return typeof value === "string" ? { source, value } : { source };
  }
}
