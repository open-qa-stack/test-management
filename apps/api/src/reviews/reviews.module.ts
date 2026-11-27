import { Module } from "@nestjs/common";
import { Sessions, TestReviews } from "@open-qa-stack/engine";
import { ConfigurationStore, TestDecisionStore } from "@open-qa-stack/store";
import { ApiConfiguration } from "../config/api-configuration.ts";
import { DatabaseModule } from "../database/database.module.ts";
import { SessionsModule } from "../sessions/sessions.module.ts";
import { ReviewsController } from "./reviews.controller.ts";

/**
 * The routes of the review of the tests the agents wrote, over the operation of the engine that reads them from the
 * designs of the test repository and from what a person decided of each, and resumes in the turn of the sessions this
 * process hosts the one that wrote a test to correct it. The routes hold no rule of their own.
 */
@Module({
  imports: [DatabaseModule, SessionsModule],
  controllers: [ReviewsController],
  providers: [
    {
      provide: TestReviews,
      inject: [ApiConfiguration, ConfigurationStore, TestDecisionStore, Sessions],
      useFactory: ({ repository }: ApiConfiguration, configuration: ConfigurationStore, decisions: TestDecisionStore, sessions: Sessions) =>
        new TestReviews(repository, configuration, decisions, sessions),
    },
  ],
})
export class ReviewsModule {}
