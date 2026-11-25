import { BadRequestException, Body, Controller, Get, Header, Patch, Query, StreamableFile } from "@nestjs/common";
import { Executions, RepositoryTests, TestReadings, TestSources } from "@open-qa-stack/engine";
import { isRecord, type TestChange, type TestEdit } from "@open-qa-stack/domain";
import type {
  RepositoryTest,
  RepositoryTestList,
  TestExecutionList,
  TestReading,
  TestSource,
  LastVerdictList,
  TestVersionList,
} from "@open-qa-stack/domain/sessions";

/**
 * `GET /tests`, `PATCH /tests`, `GET /tests/source`, `GET /tests/reading`, `GET /tests/capture`, `GET /tests/trace`, `GET /tests/executions`,
 * `GET /tests/verdicts` and `GET /tests/versions`: the operations on the tests of the test repository, said in HTTP. A test is named by its path, relative to the root of the repository, in the
 * query; a reading, a capture and a trace come from the latest run of the test, or from the execution the query names.
 */
@Controller("tests")
export class TestsController {
  readonly #tests: RepositoryTests;
  readonly #readings: TestReadings;
  readonly #executions: Executions;
  readonly #sources: TestSources;

  constructor(tests: RepositoryTests, readings: TestReadings, executions: Executions, sources: TestSources) {
    this.#tests = tests;
    this.#readings = readings;
    this.#executions = executions;
    this.#sources = sources;
  }

  /** @returns The tests of the repository as their files are now, in the order of their paths, which no cache may keep. */
  @Get()
  @Header("Cache-Control", "no-store")
  async list(): Promise<RepositoryTestList> {
    return this.#tests.listed();
  }

  /** @returns The test as its file tells it once changed — its own title, or the text of one of its steps — with its identifier. */
  @Patch()
  @Header("Cache-Control", "no-store")
  change(@Body() body: unknown): Promise<RepositoryTest> {
    return this.#sources.change(changeOf(body));
  }

  /** @returns The text of the file of tests of the path as it is now, which no cache may keep. */
  @Get("source")
  @Header("Cache-Control", "no-store")
  source(@Query("path") path: unknown): Promise<TestSource> {
    return this.#sources.read(pathOf(path));
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

  /** @returns The trace the run of the test kept, that of the execution named or the latest, as an archive the trace viewer of Playwright opens. */
  @Get("trace")
  @Header("Cache-Control", "no-store")
  async trace(@Query("path") path: unknown, @Query("execution") execution: unknown): Promise<StreamableFile> {
    return new StreamableFile(await this.#readings.trace(pathOf(path), executionOf(execution)), { type: "application/zip" });
  }

  /** @returns What came of the tests of the file of the path in its latest executions, the latest first, which no cache may keep. */
  @Get("executions")
  @Header("Cache-Control", "no-store")
  async executions(@Query("path") path: unknown): Promise<TestExecutionList> {
    return { items: await this.#executions.ofFile(pathOf(path)) };
  }

  /** @returns What came of each test the last time it ran, which no cache may keep. */
  @Get("verdicts")
  @Header("Cache-Control", "no-store")
  async verdicts(): Promise<LastVerdictList> {
    return { items: await this.#executions.verdicts() };
  }

  /** @returns The versions of the tests of the file of the path, the latest first, which no cache may keep. */
  @Get("versions")
  @Header("Cache-Control", "no-store")
  async versions(@Query("path") path: unknown): Promise<TestVersionList> {
    return { items: await this.#executions.versions(pathOf(path)) };
  }
}

/** What a body asks to change of a test: its own title, or the text of a step by its number. */
function editOf(change: unknown): TestEdit {
  if (isRecord(change) && Object.keys(change).length === 1 && typeof change["title"] === "string") return { title: change["title"] };
  if (
    isRecord(change) &&
    Object.keys(change).length === 2 &&
    Number.isInteger(change["step"]) &&
    (change["step"] as number) >= 1 &&
    typeof change["text"] === "string"
  )
    return { step: change["step"] as number, text: change["text"] };
  throw new BadRequestException("change is { title } or { step, text }: the new own title of the test, or the number of a step from 1 and its new text.");
}

/** The change a body asks for: the test by its path and its titles, and what changes of it. */
function changeOf(body: unknown): TestChange {
  if (!isRecord(body) || typeof body["title"] !== "string")
    throw new BadRequestException("The body is { path, title, change }: the test as GET /tests names it, and what changes.");
  return { path: pathOf(body["path"]), title: body["title"], change: editOf(body["change"]) };
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
