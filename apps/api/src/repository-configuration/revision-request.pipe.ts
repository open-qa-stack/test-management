import { Injectable, type PipeTransform } from "@nestjs/common";
import { revisionRequestOf, type RevisionRequest } from "./revision-request.ts";

/** Validates the body of `POST /configuration/revisions` before the route runs: the route only sees a change it can read. */
@Injectable()
export class RevisionRequestPipe implements PipeTransform<unknown, RevisionRequest> {
  /** @throws {@link SessionError} `invalid_request` naming the field at fault. */
  transform(body: unknown): RevisionRequest {
    return revisionRequestOf(body);
  }
}
