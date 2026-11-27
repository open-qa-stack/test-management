import { Module } from "@nestjs/common";
import { Defects } from "@open-qa-stack/engine";
import { DefectStore, ExecutionStore } from "@open-qa-stack/store";
import { DatabaseModule } from "../database/database.module.ts";
import { DefectsController } from "./defects.controller.ts";

/**
 * The routes of the defects a person reports from a test that failed, over the operation of the engine that keeps them in
 * the database of the instance and tells whether their test passed since they were fixed. The routes hold no rule of
 * their own.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [DefectsController],
  providers: [
    {
      provide: Defects,
      inject: [DefectStore, ExecutionStore],
      useFactory: (store: DefectStore, executions: ExecutionStore) => new Defects(store, executions),
    },
  ],
})
export class DefectsModule {}
