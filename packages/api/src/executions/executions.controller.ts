import { Controller, Get, Header } from "@nestjs/common";
import { Executions } from "@open-qa-stack/engine";
import type { ExecutionList } from "@open-qa-stack/domain/sessions";

/** `GET /executions`: the operations on the executions of tests the instance keeps, said in HTTP. */
@Controller("executions")
export class ExecutionsController {
  readonly #executions: Executions;

  constructor(executions: Executions) {
    this.#executions = executions;
  }

  /** @returns The executions, the latest first, each with what came of each of its tests, which no cache may keep. */
  @Get()
  @Header("Cache-Control", "no-store")
  async list(): Promise<ExecutionList> {
    return { items: await this.#executions.list() };
  }
}
