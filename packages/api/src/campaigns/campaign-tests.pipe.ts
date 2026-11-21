import { Injectable, type PipeTransform } from "@nestjs/common";
import { campaignTestsOf } from "./campaign-tests.ts";
import type { CampaignTest } from "@open-qa-stack/domain/sessions";

/** Validates the body of `PUT /campaigns/:id/tests` before the route runs. */
@Injectable()
export class CampaignTestsPipe implements PipeTransform<unknown, readonly CampaignTest[]> {
  /** @throws {@link SessionError} `invalid_request` naming the field at fault. */
  transform(body: unknown): readonly CampaignTest[] {
    return campaignTestsOf(body);
  }
}
