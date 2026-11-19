import { Controller, Get, Header } from "@nestjs/common";
import { RepositoryTests } from "@open-qa-stack/engine";
import type { RepositoryTestList } from "@open-qa-stack/domain/sessions";

/** `GET /tests`: the operation that lists the tests of the test repository, said in HTTP. */
@Controller("tests")
export class TestsController {
  readonly #tests: RepositoryTests;

  constructor(tests: RepositoryTests) {
    this.#tests = tests;
  }

  /** @returns The tests of the repository as their files are now, in the order of their paths, which no cache may keep. */
  @Get()
  @Header("Cache-Control", "no-store")
  async list(): Promise<RepositoryTestList> {
    return { items: await this.#tests.list() };
  }
}
