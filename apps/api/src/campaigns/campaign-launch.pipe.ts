import { Injectable, type PipeTransform } from "@nestjs/common";
import { isRecord, type CampaignLaunchScope } from "@open-qa-stack/domain";
import { requestBody } from "../sessions/request-body.ts";
import { SessionError } from "../sessions/session-error.ts";

/** The tests of a campaign a launch may be limited to. */
const SCOPES: readonly CampaignLaunchScope[] = ["failed", "not_run"];

/**
 * Validates the body of `POST /campaigns/:id/launches` before the route runs: none, an empty object, or one whose
 * `only` names the tests to launch.
 */
@Injectable()
export class CampaignLaunchPipe implements PipeTransform<unknown, CampaignLaunchScope | undefined> {
  /** @throws {@link SessionError} `invalid_request` naming the field at fault. */
  transform(body: unknown): CampaignLaunchScope | undefined {
    if (body === undefined || (isRecord(body) && Object.keys(body).length === 0)) return undefined;
    const { only } = requestBody(body, ["only"], "a launch of a campaign");
    if (!SCOPES.includes(only as CampaignLaunchScope))
      throw new SessionError("invalid_request", `only must be one of ${SCOPES.join(", ")}, or left out to launch every test.`);
    return only as CampaignLaunchScope;
  }
}
