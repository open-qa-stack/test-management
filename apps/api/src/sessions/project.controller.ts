import { Controller, Get, Header } from "@nestjs/common";
import { Sessions } from "@open-qa-stack/engine";
import type { Project } from "@open-qa-stack/domain/sessions";

/** `GET /project`. */
@Controller("project")
export class ProjectController {
  readonly #sessions: Sessions;

  constructor(sessions: Sessions) {
    this.#sessions = sessions;
  }

  /** @returns The project of the instance, which no cache may keep: it is read as it is now. */
  @Get()
  @Header("Cache-Control", "no-store")
  project(): Promise<Project> {
    return this.#sessions.project();
  }
}
