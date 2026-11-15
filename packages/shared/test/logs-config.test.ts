import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { declaredValues, validateConfig, type ConfigError } from "../src/index.ts";
import { errorsOf, EXAMPLE_ENV, exampleText, listAt, validateVariant, type JsonObject } from "./helpers.ts";

const logs = (fields: JsonObject) => (c: JsonObject) =>
  listAt(c, "knowledge").push({ id: "policy-logs", type: "logs", attachments: [{ application: "policy-management", environment: "local" }], ...fields });

const pairs = (errors: ConfigError[]) => errors.map((e) => [e.path, e.rule]);

describe("logs criterion 1 — a configuration that declares a log file or a container is validated", () => {
  it("accepts a log file, inside or outside the repository", () => {
    for (const path of ["logs/policy.log", "../policy-management/logs/app.log"]) {
      const result = validateVariant(logs({ path }));
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.deepEqual(result.ok && result.config.knowledge.at(-1), {
        id: "policy-logs",
        type: "logs",
        attachments: [{ application: "policy-management", environment: "local" }],
        path,
      });
    }
  });

  it("accepts a container read by Podman or Docker", () => {
    for (const engine of ["podman", "docker"]) {
      assert.equal(validateVariant(logs({ container: "policy-management-backend_1", engine })).ok, true, engine);
    }
  });

  for (const [what, fields] of [
    ["neither a file nor a container", {}],
    ["a container without its engine", { container: "policy" }],
    ["a file and a container", { path: "a.log", container: "policy", engine: "podman" }],
    ["a file with an engine", { path: "a.log", engine: "podman" }],
  ] as const) {
    it(`refuses ${what}, with one error`, () => {
      assert.deepEqual(
        errorsOf(validateVariant(logs(fields))).map((e) => [e.path, e.rule, e.message]),
        [["/knowledge/8", "logs-source", 'Declare either "path", or "container" and "engine".']],
      );
    });
  }

  it("refuses an unknown engine, a container name an engine would read as an option, and an absolute path", () => {
    assert.deepEqual(pairs(errorsOf(validateVariant(logs({ container: "policy", engine: "lxc" })))), [["/knowledge/8/engine", "unknown-variant"]]);
    assert.deepEqual(pairs(errorsOf(validateVariant(logs({ container: "--help", engine: "podman" })))), [["/knowledge/8/container", "container-name"]]);
    assert.deepEqual(pairs(errorsOf(validateVariant(logs({ path: "/var/log/policy.log" })))), [["/knowledge/8/path", "path-absolute"]]);
  });

  it("refuses a log source attached to an environment the application does not have", () => {
    const result = validateVariant((c) =>
      listAt(c, "knowledge").push({
        id: "policy-logs",
        type: "logs",
        attachments: [{ application: "policy-management", environment: "staging" }],
        path: "a.log",
      }),
    );
    assert.deepEqual(pairs(errorsOf(result)), [["/knowledge/8/attachments/0/environment", "unknown-reference"]]);
  });
});

describe("logs criterion 4 — the values to mask are those of the secrets the configuration names", () => {
  it("gives the connection strings and the model key, each once, without the unset ones nor the credentials of the test accounts", () => {
    const result = validateConfig(exampleText(), EXAMPLE_ENV);
    assert.ok(result.ok);
    const env = { ...EXAMPLE_ENV, CUSTOMER_CORE_DB_URL: EXAMPLE_ENV["POLICY_MANAGEMENT_DB_URL"], CUSTOMER_SELF_SERVICE_DB_URL: "", UNRELATED: "not-named" };
    assert.deepEqual(
      new Set(declaredValues(result.config, env)),
      new Set([
        "postgresql://user:secret@localhost:5433/customermanagement",
        "postgresql://user:secret@localhost:5433/policymanagement",
        "test-model-key-value",
      ]),
    );
    assert.equal(declaredValues(result.config, env).length, 3);
  });
});
