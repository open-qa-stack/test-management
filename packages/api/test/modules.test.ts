import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpStatus } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { Configuration, KnowledgeDocuments, Sessions } from "@open-qa-stack/engine";
import {
  ConfigurationStore,
  Database,
  type DatabaseState,
  DatabaseStatus,
  DocumentStore,
  InstanceDatabase,
  SchemaMigrations,
  SessionStore,
} from "@open-qa-stack/store";
import { AppModule } from "../src/app.module.ts";
import { ApiConfiguration } from "../src/config/api-configuration.ts";
import { SchemaCheck } from "../src/database/schema-check.ts";
import { HealthController } from "../src/health/health.controller.ts";
import type { HealthStatus } from "../src/health/health-status.ts";
import { HealthService } from "../src/health/health.service.ts";
import { NotReadyError } from "../src/health/not-ready-error.ts";
import { NotReadyFilter } from "../src/health/not-ready.filter.ts";
import type { Readiness } from "../src/health/readiness.ts";
import { EventStreams } from "../src/sessions/event-streams.ts";
import { RunEnvironment } from "../src/sessions/run-environment.ts";
import { SessionsLifecycle } from "../src/sessions/sessions-lifecycle.ts";

const CONFIGURATION = { OQAS_PORT: "8080", OQAS_DATABASE_URL: "postgres://oqas@127.0.0.1:1/oqas" };

const statusOf = (state: DatabaseState) => ({ check: async () => state }) as unknown as DatabaseStatus;

describe("the root module", () => {
  it("compiles with every provider replaced by a double, without an HTTP server", async () => {
    const configuration = ApiConfiguration.read(CONFIGURATION);
    const status: HealthStatus = { status: "ok" };
    const doubles = new Map<unknown, object>([
      [ApiConfiguration, { host: "configuration double", port: 1 }],
      [InstanceDatabase, { prepare: async () => {} }],
      [Database, { close: async () => {} }],
      [SchemaMigrations, { pending: async () => 0 }],
      [DatabaseStatus, { check: async () => ({ check: "up" }) }],
      [SchemaCheck, { onApplicationBootstrap: async () => {} }],
      [HealthService, { status: () => status }],
      [SessionStore, { sessions: async () => [] }],
      [Sessions, { sessions: async () => [] }],
      [SessionsLifecycle, { onApplicationBootstrap: async () => {} }],
    ]);
    let builder = Test.createTestingModule({ imports: [AppModule.forRoot(configuration)] });
    for (const [token, double] of doubles) builder = builder.overrideProvider(token).useValue(double);
    const module = await builder.compile();
    try {
      for (const [token, double] of doubles) assert.equal(module.get(token as never), double);
      assert.equal(module.get(HealthController).status(), status);
    } finally {
      await module.close();
    }
  });

  it("provides the configuration it was given, the database it names, its migrations, its status, the health service, and the operations on sessions, on the configuration and on the documents over that database", async () => {
    const configuration = ApiConfiguration.read(CONFIGURATION);
    const module = await Test.createTestingModule({ imports: [AppModule.forRoot(configuration)] }).compile();
    try {
      assert.equal(module.get(ApiConfiguration), configuration);
      assert.ok(module.get(InstanceDatabase) instanceof InstanceDatabase);
      assert.equal(module.get(Database), module.get(InstanceDatabase).database);
      assert.equal(module.get(SessionStore), module.get(InstanceDatabase).sessions);
      assert.equal(module.get(ConfigurationStore), module.get(InstanceDatabase).configuration);
      assert.ok(module.get(Configuration) instanceof Configuration);
      assert.equal(module.get(DocumentStore), module.get(InstanceDatabase).documents);
      assert.ok(module.get(KnowledgeDocuments) instanceof KnowledgeDocuments);
      assert.ok(module.get(SchemaMigrations) instanceof SchemaMigrations);
      assert.ok(module.get(DatabaseStatus) instanceof DatabaseStatus);
      assert.ok(module.get(SchemaCheck) instanceof SchemaCheck);
      assert.ok(module.get(HealthService) instanceof HealthService);
      assert.ok(module.get(SessionStore) instanceof SessionStore);
      assert.ok(module.get(Sessions) instanceof Sessions);
      assert.ok(module.get(SessionsLifecycle) instanceof SessionsLifecycle);
      assert.ok(module.get(EventStreams) instanceof EventStreams);
      assert.ok(module.get(RunEnvironment) instanceof RunEnvironment);
    } finally {
      await module.close();
    }
  });
});

describe("the health controller", () => {
  it("returns exactly what its service returns, for the status and for the readiness", () => {
    const status: HealthStatus = { status: "ok" };
    const readiness = Promise.resolve<Readiness>({ status: "ready", checks: { database: "up" } });
    const controller = new HealthController({ status: () => status, readiness: () => readiness } as unknown as HealthService);
    assert.equal(controller.status(), status);
    assert.equal(controller.readiness(), readiness);
  });
});

describe("the health service", () => {
  it("tells the process serves requests, and nothing else", () => {
    assert.deepEqual(new HealthService(statusOf({ check: "up" })).status(), { status: "ok" });
  });

  it("tells the instance is ready when the database is up", async () => {
    assert.deepEqual(await new HealthService(statusOf({ check: "up" })).readiness(), { status: "ready", checks: { database: "up" } });
  });

  for (const state of [{ check: "unreachable" }, { check: "migrations_pending", pending: 1 }] as const) {
    it(`raises the readiness of an instance that is not ready when the database is ${state.check}`, async () => {
      await assert.rejects(new HealthService(statusOf(state)).readiness(), (error) => {
        assert.ok(error instanceof NotReadyError);
        assert.deepEqual(error.readiness, { status: "not_ready", checks: { database: state.check } });
        return true;
      });
    });
  }
});

describe("the filter of an instance that is not ready", () => {
  it("answers 503 with the readiness the error carries", () => {
    const readiness: Readiness = { status: "not_ready", checks: { database: "unreachable" } };
    const response = {};
    const replies: unknown[][] = [];
    const adapterHost = { httpAdapter: { reply: (...args: unknown[]) => replies.push(args) } } as unknown as HttpAdapterHost;
    const host = { switchToHttp: () => ({ getResponse: () => response }) } as never;
    new NotReadyFilter(adapterHost).catch(new NotReadyError(readiness), host);
    assert.equal(replies.length, 1);
    assert.equal(replies[0]?.[0], response);
    assert.equal(replies[0]?.[1], readiness);
    assert.equal(replies[0]?.[2], HttpStatus.SERVICE_UNAVAILABLE);
  });
});
