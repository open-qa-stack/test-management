import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { Sessions } from "@open-qa-stack/engine";
import { RemapBodyPipe } from "./remap-body.pipe.ts";
import type { KnowledgeRemap } from "@open-qa-stack/domain/sessions";

/**
 * `POST /knowledge/mapping`: maps the knowledge again, on demand, said in HTTP: a session that maps it opens, and takes
 * the turn of the sessions, which this process hosts. `GET /knowledge/mapping` tells where the cartography stands.
 */
@Controller("knowledge/mapping")
export class RemapController {
  readonly #sessions: Sessions;

  constructor(sessions: Sessions) {
    this.#sessions = sessions;
  }

  /**
   * @returns The session opened, which runs or waits its turn; the session that maps already, when one waits or runs, which
   * opens no second; or that no such source is declared — each answered with `200`.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  remap(@Body(RemapBodyPipe) source: string | undefined): Promise<KnowledgeRemap> {
    return this.#sessions.remap(source);
  }
}
