import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { expectedProblem } from "./expected-problem.ts";
import { problemOf } from "./problem-kinds.ts";

/**
 * Answers every error of the API with a problem, as RFC 9457 describes one: a client reads one shape whatever
 * went wrong, and decides on its code.
 *
 * @remarks
 * An error the API does not expect is logged whole and answered `500` with a detail that says nothing of it:
 * the message of such an error may name a file, a query or an address of the instance.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  readonly #adapterHost: HttpAdapterHost;
  readonly #logger = new Logger("Api");

  constructor(adapterHost: HttpAdapterHost) {
    this.#adapterHost = adapterHost;
  }

  catch(error: unknown, host: ArgumentsHost): void {
    const expected = expectedProblem(error);
    if (expected === undefined)
      this.#logger.error("A request failed on an error the API does not expect.", error instanceof Error ? error.stack : String(error));
    const problem = expected ?? problemOf("error", "The API failed to answer the request; the log of the instance has the error.");
    const { httpAdapter } = this.#adapterHost;
    const response: unknown = host.switchToHttp().getResponse();
    httpAdapter.setHeader(response, "Content-Type", "application/problem+json");
    httpAdapter.reply(response, problem, problem.status);
  }
}
