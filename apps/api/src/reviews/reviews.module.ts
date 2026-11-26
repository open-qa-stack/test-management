import { Module } from "@nestjs/common";
import { TestReviews } from "@open-qa-stack/engine";
import { ConfigurationStore, TestDecisionStore } from "@open-qa-stack/store";
import { ApiConfiguration } from "../config/api-configuration.ts";
import { DatabaseModule } from "../database/database.module.ts";
import { ReviewsController } from "./reviews.controller.ts";

/**
 * The routes of the review of the tests the agents wrote, over the operation of the engine that reads them from the
 * designs of the test repository and from what a person decided of each. The routes hold no rule of their own.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [ReviewsController],
  providers: [
    {
      provide: TestReviews,
      inject: [ApiConfiguration, ConfigurationStore, TestDecisionStore],
      useFactory: ({ repository }: ApiConfiguration, configuration: ConfigurationStore, decisions: TestDecisionStore) =>
        new TestReviews(repository, configuration, decisions),
    },
  ],
})
export class ReviewsModule {}
