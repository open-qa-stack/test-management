import { BadRequestException, Body, Controller, Get, Header, Param, Put } from "@nestjs/common";
import { reviewDecisionOf } from "@open-qa-stack/domain";
import { TestReviews } from "@open-qa-stack/engine";
import type { DecidedTest, ReviewQueue, TestProposal } from "@open-qa-stack/domain/sessions";

/**
 * `GET /reviews`, `GET /reviews/:id` and `PUT /reviews/:id/decision`: the operations of the review of the tests the
 * agents wrote, said in HTTP. A test is named by the identifier of its tag `@oqas-id-…`.
 */
@Controller("reviews")
export class ReviewsController {
  readonly #reviews: TestReviews;

  constructor(reviews: TestReviews) {
    this.#reviews = reviews;
  }

  /** @returns The tests to review and those set aside, and how many of each, which no cache may keep. */
  @Get()
  @Header("Cache-Control", "no-store")
  queue(): Promise<ReviewQueue> {
    return this.#reviews.queue();
  }

  /** @returns What a person reads to decide of a test, which no cache may keep; `unknown_proposal` for an identifier no design gave. */
  @Get(":id")
  @Header("Cache-Control", "no-store")
  proposal(@Param("id") id: string): Promise<TestProposal> {
    return this.#reviews.proposal(id);
  }

  /** @returns The decision kept of a test, and for a test validated the branch it entered; `invalid_request` for a body that is no decision. */
  @Put(":id/decision")
  @Header("Cache-Control", "no-store")
  decide(@Param("id") id: string, @Body() body: unknown): Promise<DecidedTest> {
    const decision = reviewDecisionOf(body);
    if (typeof decision === "string") throw new BadRequestException(decision);
    return this.#reviews.decide(id, decision);
  }
}
