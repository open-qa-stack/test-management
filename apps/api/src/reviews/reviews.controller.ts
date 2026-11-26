import { Controller, Get, Header, Param } from "@nestjs/common";
import { TestReviews } from "@open-qa-stack/engine";
import type { ReviewQueue, TestProposal } from "@open-qa-stack/domain/sessions";

/**
 * `GET /reviews` and `GET /reviews/:id`: the operations of the review of the tests the agents wrote, said in HTTP. A
 * test is named by the identifier of its tag `@oqas-id-…`.
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
}
