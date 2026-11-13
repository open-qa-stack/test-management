import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.ts";
import { ApiConfiguration } from "../src/config/api-configuration.ts";
import { HealthController } from "../src/health/health.controller.ts";
import type { HealthStatus } from "../src/health/health-status.ts";
import { HealthService } from "../src/health/health.service.ts";

describe("the root module", () => {
  it("compiles with every provider replaced by a double, without an HTTP server", async () => {
    const configuration = ApiConfiguration.read({ OQAS_PORT: "8080" });
    const configurationDouble = { host: "configuration double", port: 1 };
    const status: HealthStatus = { status: "ok" };
    const healthDouble = { status: () => status };
    const module = await Test.createTestingModule({ imports: [AppModule.forRoot(configuration)] })
      .overrideProvider(ApiConfiguration)
      .useValue(configurationDouble)
      .overrideProvider(HealthService)
      .useValue(healthDouble)
      .compile();
    try {
      assert.equal(module.get(ApiConfiguration), configurationDouble);
      assert.equal(module.get(HealthService), healthDouble);
      assert.equal(module.get(HealthController).status(), status);
    } finally {
      await module.close();
    }
  });

  it("provides the configuration it was given and the health service", async () => {
    const configuration = ApiConfiguration.read({ OQAS_PORT: "8080" });
    const module = await Test.createTestingModule({ imports: [AppModule.forRoot(configuration)] }).compile();
    try {
      assert.equal(module.get(ApiConfiguration), configuration);
      assert.ok(module.get(HealthService) instanceof HealthService);
    } finally {
      await module.close();
    }
  });
});

describe("the health controller", () => {
  it("returns exactly what its service returns", () => {
    const status = { status: "ok" } as const;
    const controller = new HealthController({ status: () => status });
    assert.equal(controller.status(), status);
  });
});

describe("the health service", () => {
  it("tells the process serves requests, and nothing else", () => {
    assert.deepEqual(new HealthService().status(), { status: "ok" });
  });
});
