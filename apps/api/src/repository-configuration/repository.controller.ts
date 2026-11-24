import { Controller, Get, Header, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { RepositorySetup } from "@open-qa-stack/engine";
import type { RepositoryPreparation, RepositoryState } from "@open-qa-stack/domain/sessions";

/**
 * `GET /repository` and `POST /repository/preparation`: where the test repository of the instance stands, and its
 * setup as a Playwright project, said in HTTP.
 */
@Controller("repository")
export class RepositoryController {
  readonly #setup: RepositorySetup;

  constructor(setup: RepositorySetup) {
    this.#setup = setup;
  }

  /** @returns Whether the test repository is a git repository with a commit, and a Playwright project, which no cache may keep. */
  @Get()
  @Header("Cache-Control", "no-store")
  state(): Promise<RepositoryState> {
    return this.#setup.state();
  }

  /**
   * Makes a Playwright project of the test repository, from the configuration in force, and a git repository with a
   * commit of a folder that is none.
   *
   * @returns What was written, kept and committed, answered with `200`; an instance without a configuration is answered
   * with `404`, and one that was given no test repository with `503`.
   */
  @Post("preparation")
  @HttpCode(HttpStatus.OK)
  prepare(): Promise<RepositoryPreparation> {
    return this.#setup.prepare();
  }
}
