import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, Post, Put } from "@nestjs/common";
import { reviewCorrectionOf, reviewDecisionOf } from "@open-qa-stack/domain";
import { TestReviews } from "@open-qa-stack/engine";
import type { CorrectedTest, DecidedTest, ReviewQueue, TestProposal } from "@open-qa-stack/domain/sessions";

/**
 * `GET /reviews`, `GET /reviews/:id`, `PUT /reviews/:id/decision`, `DELETE /reviews/:id/decision` and
 * `POST /reviews/:id/correction`: the operations of the review of the tests the
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

  /** @returns The decision that keeps a test in correction, and the session resumed to correct it; `invalid_request` for a body that is no correction. */
  @Post(":id/correction")
  @Header("Cache-Control", "no-store")
  correct(@Param("id") id: string, @Body() body: unknown): Promise<CorrectedTest> {
    const correction = reviewCorrectionOf(body);
    if (typeof correction === "string") throw new BadRequestException(correction);
    return this.#reviews.correct(id, correction);
  }

  /** Puts a test set aside back in review, answered with `204`; `review_refused` for a test that is not set aside. */
  @Delete(":id/decision")
  @HttpCode(HttpStatus.NO_CONTENT)
  restore(@Param("id") id: string): Promise<void> {
    return this.#reviews.restore(id);
  }
}
