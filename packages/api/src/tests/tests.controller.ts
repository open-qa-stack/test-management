import { BadRequestException, Controller, Get, Header, Query, StreamableFile } from "@nestjs/common";
import { RepositoryTests, TestReadings } from "@open-qa-stack/engine";
import type { RepositoryTestList, TestReading } from "@open-qa-stack/domain/sessions";

/**
 * `GET /tests`, `GET /tests/reading` and `GET /tests/capture`: the operations on the tests of the test repository,
 * said in HTTP. A test is named by its path, relative to the root of the repository, in the query.
 */
@Controller("tests")
export class TestsController {
  readonly #tests: RepositoryTests;
  readonly #readings: TestReadings;

  constructor(tests: RepositoryTests, readings: TestReadings) {
    this.#tests = tests;
    this.#readings = readings;
  }

  /** @returns The tests of the repository as their files are now, in the order of their paths, which no cache may keep. */
  @Get()
  @Header("Cache-Control", "no-store")
  async list(): Promise<RepositoryTestList> {
    return { items: await this.#tests.list() };
  }

  /** @returns The test of the path in steps, from the latest run that ran it, which no cache may keep. */
  @Get("reading")
  @Header("Cache-Control", "no-store")
  read(@Query("path") path: unknown): Promise<TestReading> {
    return this.#readings.read(pathOf(path));
  }

  /** @returns The capture the latest run of the test attached for the step, as its media type says. */
  @Get("capture")
  @Header("Cache-Control", "no-store")
  async capture(@Query("path") path: unknown, @Query("step") step: unknown): Promise<StreamableFile> {
    const number = typeof step === "string" && /^[1-9]\d{0,3}$/.test(step) ? Number(step) : undefined;
    if (number === undefined) throw new BadRequestException("step is the number of a step of the test, from 1.");
    const { contentType, bytes } = await this.#readings.capture(pathOf(path), number);
    return new StreamableFile(bytes, { type: contentType });
  }
}

/** The path a query names a test by. */
function pathOf(path: unknown): string {
  if (typeof path !== "string" || path === "") throw new BadRequestException("path is the path of a test, relative to the root of the test repository.");
  return path;
}
