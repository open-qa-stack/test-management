import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { Configuration, ModelConnection } from "@open-qa-stack/engine";
import { ConfigurationBodyPipe } from "./configuration-body.pipe.ts";
import { ModelBodyPipe, type ModelTest } from "./model-body.pipe.ts";
import { RevisionRequestPipe } from "./revision-request.pipe.ts";
import type { RevisionRequest } from "./revision-request.ts";
import type { ConfigurationCheck, ConfigurationView, ModelConnectionCheck, RevisionList } from "@open-qa-stack/domain/sessions";

/**
 * `GET /configuration`, `GET /configuration/revisions`, `POST /configuration/validation`,
 * `POST /configuration/revisions`, `POST /configuration/synchronisation` and `POST /configuration/model-connection`:
 * each route is one operation on the configuration, said in HTTP.
 */
@Controller("configuration")
export class ConfigurationController {
  readonly #configuration: Configuration;
  readonly #connection: ModelConnection;

  constructor(configuration: Configuration, connection: ModelConnection) {
    this.#configuration = configuration;
    this.#connection = connection;
  }

  /** @returns The revision in force, and how the configuration file stands to it, which no cache may keep. */
  @Get()
  @Header("Cache-Control", "no-store")
  view(): Promise<ConfigurationView> {
    return this.#configuration.view();
  }

  /** @returns Every revision without its document, the latest first, which no cache may keep. */
  @Get("revisions")
  @Header("Cache-Control", "no-store")
  async revisions(): Promise<RevisionList> {
    return { items: await this.#configuration.revisions() };
  }

  /** @returns Every error the configuration sent holds, each where it is, answered with `200`: nothing is recorded. */
  @Post("validation")
  @HttpCode(HttpStatus.OK)
  validate(@Body(ConfigurationBodyPipe) document: Readonly<Record<string, unknown>>): ConfigurationCheck {
    return { errors: this.#configuration.check(document) };
  }

  /**
   * Saves a change of the configuration, which rewrites the configuration file.
   *
   * @returns The configuration as it is now, answered with `201`; a change that is not valid is answered with
   * `422`, one made from a revision another replaced since or that would overwrite a file that changed with
   * `409`, and an API that was given no test repository with `503`.
   */
  @Post("revisions")
  async save(@Body(RevisionRequestPipe) { document, basedOn, replaceFile }: RevisionRequest): Promise<ConfigurationView> {
    await this.#configuration.save(document, basedOn, replaceFile);
    return this.#configuration.view();
  }

  /**
   * Brings the revision in force in step with the configuration file: a file that changed becomes the revision in force.
   *
   * @returns The configuration as it is now, answered with `200`; a file that is not valid is answered with
   * `422`, and an instance with neither a revision nor a file with `404`.
   */
  @Post("synchronisation")
  @HttpCode(HttpStatus.OK)
  async synchronise(): Promise<ConfigurationView> {
    await this.#configuration.synchronise();
    return this.#configuration.view();
  }

  /**
   * Tests a connection to the model as the person drafts it, with the key they typed, before anything is saved.
   *
   * @returns What the test found, answered with `200`: whether the model answers and what it offers, or why it
   * does not; a body that is not a connection the configuration accepts is answered with `400`.
   */
  @Post("model-connection")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  testModel(@Body(ModelBodyPipe) { model, key }: ModelTest): Promise<ModelConnectionCheck> {
    return this.#connection.check(model, key);
  }
}
