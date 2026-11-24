import { Injectable, type PipeTransform } from "@nestjs/common";
import { campaignPlanOf } from "./campaign-plan.ts";
import type { CampaignPlan } from "@open-qa-stack/domain/sessions";

/** Validates the body of `POST /campaigns` before the route runs: the route and the operation only see a plan that is valid. */
@Injectable()
export class CampaignPlanPipe implements PipeTransform<unknown, CampaignPlan> {
  /** @throws {@link SessionError} `invalid_request` naming the field at fault. */
  transform(body: unknown): CampaignPlan {
    return campaignPlanOf(body);
  }
}
