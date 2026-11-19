import { Module } from "@nestjs/common";
import { Executions } from "@open-qa-stack/engine";
import { ExecutionStore } from "@open-qa-stack/store";
import { DatabaseModule } from "../database/database.module.ts";
import { ExecutionsController } from "./executions.controller.ts";

/** The routes of the executions of tests, over the operations of the engine that read them from the database of the instance. */
@Module({
  imports: [DatabaseModule],
  controllers: [ExecutionsController],
  providers: [{ provide: Executions, inject: [ExecutionStore], useFactory: (store: ExecutionStore) => new Executions(store) }],
})
export class ExecutionsModule {}
