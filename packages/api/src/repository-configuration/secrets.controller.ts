import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Put } from "@nestjs/common";
import { Secrets } from "@open-qa-stack/engine";
import { SecretValuePipe } from "./secret-value.pipe.ts";
import type { SecretList } from "@open-qa-stack/domain/sessions";

/**
 * `GET /secrets` and `PUT /secrets/:name`: the values of the variables the configuration
 * names, said in HTTP. No route gives a value back; a value saved is replaced by saving another.
 */
@Controller("secrets")
export class SecretsController {
  readonly #secrets: Secrets;

  constructor(secrets: Secrets) {
    this.#secrets = secrets;
  }

  /** @returns Each variable the configuration in force names, and where its value comes from, which no cache may keep. */
  @Get()
  @Header("Cache-Control", "no-store")
  async list(): Promise<SecretList> {
    return { secrets: await this.#secrets.list() };
  }

  /**
   * Saves the value of a variable, out of the test repository, answered with `204`.
   *
   * @param name - The name of the variable.
   * @param value - Its value.
   */
  @Put(":name")
  @HttpCode(HttpStatus.NO_CONTENT)
  save(@Param("name") name: string, @Body(SecretValuePipe) value: string): Promise<void> {
    return this.#secrets.save(name, value);
  }
}
