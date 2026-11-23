import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Put } from "@nestjs/common";
import { Configuration, EnvironmentAddresses, ModelConnection } from "@open-qa-stack/engine";
import { AddressBodyPipe } from "./address-body.pipe.ts";
import { ConfigurationBodyPipe } from "./configuration-body.pipe.ts";
import { ModelBodyPipe, type ModelTest } from "./model-body.pipe.ts";
import { RevisionRequestPipe } from "./revision-request.pipe.ts";
import type { RevisionRequest } from "./revision-request.ts";
import type { AddressCheck, ConfigurationCheck, ConfigurationView, ModelConnectionCheck, RevisionList } from "@open-qa-stack/domain/sessions";

/**
 * `GET /configuration`, `GET /configuration/revisions`, `POST /configuration/validation`,
 * `POST /configuration/revisions`, `POST /configuration/synchronisation`, `POST /configuration/model-connection` and
 * `POST /configuration/address-check`:
 * each route is one operation on the configuration, said in HTTP.
 */
@Controller("configuration")
export class ConfigurationController {
  readonly #configuration: Configuration;
  readonly #connection: ModelConnection;
  readonly #addresses: EnvironmentAddresses;

  constructor(configuration: Configuration, connection: ModelConnection, addresses: EnvironmentAddresses) {
    this.#configuration = configuration;
    this.#connection = connection;
    this.#addresses = addresses;
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
   * Saves a change of the configuration, as the revision in force: no file is written.
   *
   * @returns The configuration as it is now, answered with `201`; a change that is not valid is answered with
   * `422`, and one made from a revision another replaced since with `409`.
   */
  @Post("revisions")
  async save(@Body(RevisionRequestPipe) { document, basedOn }: RevisionRequest): Promise<ConfigurationView> {
    await this.#configuration.save(document, basedOn);
    return this.#configuration.view();
  }

  /**
   * Takes the configuration file as the revision in force, when it differs from it.
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
   * Writes the revision in force to the configuration file of the test repository, in the order the schema declares
   * its keys, to keep it with the tests in git or give it to the continuous integration.
   *
   * @returns The configuration as it is now, answered with `200`; an instance without a revision is answered with
   * `404`, and an API that was given no test repository with `503`.
   */
  @Put("file")
  async writeFile(): Promise<ConfigurationView> {
    await this.#configuration.restore();
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

  /**
   * Tests that an address of an environment answers, as the person typed it, before or after it is saved.
   *
   * @returns What the test found, answered with `200`: whether something answers there, or why not; a body without an
   * address is answered with `400`.
   */
  @Post("address-check")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  checkAddress(@Body(AddressBodyPipe) address: string): Promise<AddressCheck> {
    return this.#addresses.check(address);
  }
}
