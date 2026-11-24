import { Injectable, type PipeTransform } from "@nestjs/common";
import { sessionMessageOf } from "./session-message.ts";
import type { SessionMessage } from "@open-qa-stack/domain/sessions";

/** Validates the body of `POST /sessions/:id/messages` before the route runs: the route and the service only see a message that is valid. */
@Injectable()
export class SessionMessagePipe implements PipeTransform<unknown, SessionMessage> {
  /** @throws {@link SessionError} `invalid_request` naming the field at fault. */
  transform(body: unknown): SessionMessage {
    return sessionMessageOf(body);
  }
}
