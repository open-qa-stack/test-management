import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { Sessions } from "@open-qa-stack/engine";
import { LaunchRequestPipe } from "./launch-request.pipe.ts";
import type { LaunchRequest, LaunchState, TestLaunch } from "@open-qa-stack/domain/sessions";

/**
 * `POST /launches` and `GET /launches`: the launches of tests of the repository as they are, with no agent, said in
 * HTTP. They take the turn of the sessions, which this process hosts.
 */
@Controller("launches")
export class LaunchesController {
  readonly #sessions: Sessions;

  constructor(sessions: Sessions) {
    this.#sessions = sessions;
  }

  /** @returns The launch, which runs: its execution is kept once it ended, as `GET /launches` then says. */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  launch(@Body(LaunchRequestPipe) request: LaunchRequest): Promise<TestLaunch> {
    return this.#sessions.launch(request);
  }

  /** @returns The launch that runs, and the last one that ended, which no cache may keep. */
  @Get()
  @Header("Cache-Control", "no-store")
  launches(): LaunchState {
    return this.#sessions.launches();
  }
}
