import { Module } from "@nestjs/common";
import { AgentMemory } from "@open-qa-stack/engine";
import { LessonStore, MemoryStore } from "@open-qa-stack/store";
import { DatabaseModule } from "../database/database.module.ts";
import { MemoryController } from "./memory.controller.ts";

/** The routes of the memory of the agents, over the operation of the engine that keeps it in the database of the instance. */
@Module({
  imports: [DatabaseModule],
  controllers: [MemoryController],
  providers: [
    {
      provide: AgentMemory,
      inject: [LessonStore, MemoryStore],
      useFactory: (lessons: LessonStore, memories: MemoryStore) => new AgentMemory(lessons, memories),
    },
  ],
})
export class MemoryModule {}
