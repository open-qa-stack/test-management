import { type ArgumentsHost, Catch, type ExceptionFilter, HttpStatus } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { NotReadyError } from "./not-ready-error.ts";

/** Answers {@link NotReadyError} with `503` and the readiness it carries. */
@Catch(NotReadyError)
export class NotReadyFilter implements ExceptionFilter<NotReadyError> {
  readonly #adapterHost: HttpAdapterHost;

  constructor(adapterHost: HttpAdapterHost) {
    this.#adapterHost = adapterHost;
  }

  catch(error: NotReadyError, host: ArgumentsHost): void {
    this.#adapterHost.httpAdapter.reply(host.switchToHttp().getResponse(), error.readiness, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
