import { Injectable, type PipeTransform } from "@nestjs/common";
import { configurationOf } from "./revision-request.ts";

/** Reads the body of `POST /configuration/validation` before the route runs: a configuration, as a JSON object. */
@Injectable()
export class ConfigurationBodyPipe implements PipeTransform<unknown, Readonly<Record<string, unknown>>> {
  /** @throws {@link SessionError} `invalid_request` for a body that is no JSON object. */
  transform(body: unknown): Readonly<Record<string, unknown>> {
    return configurationOf(body);
  }
}
