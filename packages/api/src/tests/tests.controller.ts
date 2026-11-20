import { BadRequestException, Controller, Get, Header, Query, StreamableFile } from "@nestjs/common";
import { Executions, RepositoryTests, TestReadings } from "@open-qa-stack/engine";
import type { RepositoryTestList, TestExecutionList, TestReading, TestVersionList } from "@open-qa-stack/domain/sessions";

/**
 * `GET /tests`, `GET /tests/reading`, `GET /tests/capture`, `GET /tests/executions` and `GET /tests/versions`: the operations on the tests of
 * the test repository, said in HTTP. A test is named by its path, relative to the root of the repository, in the
 * query; a reading and a capture come from the latest run of the test, or from the execution the query names.
 */
@Controller("tests")
export class TestsController {
  readonly #tests: RepositoryTests;
  readonly #readings: TestReadings;
  readonly #executions: Executions;

  constructor(tests: RepositoryTests, readings: TestReadings, executions: Executions) {
    this.#tests = tests;
    this.#readings = readings;
    this.#executions = executions;
  }

  /** @returns The tests of the repository as their files are now, in the order of their paths, which no cache may keep. */
  @Get()
  @Header("Cache-Control", "no-store")
  async list(): Promise<RepositoryTestList> {
    return { items: await this.#tests.list() };
  }

  /** @returns The test of the path in steps, from the execution named or the latest run that ran it, which no cache may keep. */
  @Get("reading")
  @Header("Cache-Control", "no-store")
  read(@Query("path") path: unknown, @Query("execution") execution: unknown): Promise<TestReading> {
    return this.#readings.read(pathOf(path), executionOf(execution));
  }

  /** @returns The capture the run of the test attached for the step, that of the execution named or the latest, as its media type says. */
  @Get("capture")
  @Header("Cache-Control", "no-store")
  async capture(@Query("path") path: unknown, @Query("step") step: unknown, @Query("execution") execution: unknown): Promise<StreamableFile> {
    const number = typeof step === "string" && /^[1-9]\d{0,3}$/.test(step) ? Number(step) : undefined;
    if (number === undefined) throw new BadRequestException("step is the number of a step of the test, from 1.");
    const { contentType, bytes } = await this.#readings.capture(pathOf(path), number, executionOf(execution));
    return new StreamableFile(bytes, { type: contentType });
  }

  /** @returns What came of the tests of the file of the path in its latest executions, the latest first, which no cache may keep. */
  @Get("executions")
  @Header("Cache-Control", "no-store")
  async executions(@Query("path") path: unknown): Promise<TestExecutionList> {
    return { items: await this.#executions.ofFile(pathOf(path)) };
  }

  /** @returns The versions of the tests of the file of the path, the latest first, which no cache may keep. */
  @Get("versions")
  @Header("Cache-Control", "no-store")
  async versions(@Query("path") path: unknown): Promise<TestVersionList> {
    return { items: await this.#executions.versions(pathOf(path)) };
  }
}

/** The execution a query names, if it names one. */
function executionOf(execution: unknown): string | undefined {
  if (execution === undefined) return undefined;
  if (typeof execution !== "string" || execution === "") throw new BadRequestException("execution is the identifier of an execution the instance keeps.");
  return execution;
}

/** The path a query names a test by. */
function pathOf(path: unknown): string {
  if (typeof path !== "string" || path === "") throw new BadRequestException("path is the path of a test, relative to the root of the test repository.");
  return path;
}
