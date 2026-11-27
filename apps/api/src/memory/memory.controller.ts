import { BadRequestException, Body, Controller, Get, Header, Param, Patch, Post } from "@nestjs/common";
import { lessonDraftOf, memoryChangeOf } from "@open-qa-stack/domain";
import { AgentMemory } from "@open-qa-stack/engine";
import type { MemoryItem, MemoryList } from "@open-qa-stack/domain/sessions";

/**
 * `GET /memory`, `POST /memory` and `PATCH /memory/:id`: the operations on the memory of the agents, said in HTTP — the
 * lessons the people of the project give them, and what they noted themselves.
 */
@Controller("memory")
export class MemoryController {
  readonly #memory: AgentMemory;

  constructor(memory: AgentMemory) {
    this.#memory = memory;
  }

  /** @returns The lines of the memory, the latest first, and how many are active and set aside, which no cache may keep. */
  @Get()
  @Header("Cache-Control", "no-store")
  list(): Promise<MemoryList> {
    return this.#memory.list();
  }

  /** @returns The instruction kept, as a line of the memory; `invalid_request` for a body that is no lesson. */
  @Post()
  @Header("Cache-Control", "no-store")
  add(@Body() body: unknown): Promise<MemoryItem> {
    const draft = lessonDraftOf(body);
    if (typeof draft === "string") throw new BadRequestException(draft);
    return this.#memory.add(draft);
  }

  /** @returns The line as it stands; `invalid_request` for a body that is no change, `unknown_memory` and `memory_refused` as the engine says. */
  @Patch(":id")
  @Header("Cache-Control", "no-store")
  change(@Param("id") id: string, @Body() body: unknown): Promise<MemoryItem> {
    const change = memoryChangeOf(body);
    if (typeof change === "string") throw new BadRequestException(change);
    return this.#memory.change(id, change);
  }
}
