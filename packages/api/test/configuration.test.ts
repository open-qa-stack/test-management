import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ApiConfiguration } from "../src/config/api-configuration.ts";
import { API_VARIABLES } from "../src/config/api-variables.ts";
import { ConfigurationError } from "../src/config/configuration-error.ts";
import type { EnvironmentVariable } from "../src/config/environment-variable.ts";
import { processEnvironment } from "../src/config/process-environment.ts";
import { readVariables } from "../src/config/read-variables.ts";
import { nonEmptyText, portNumber, type ValueType } from "../src/config/value-type.ts";

const MAIN = fileURLToPath(new URL("../src/main.js", import.meta.url));
const RUNNING = fileURLToPath(new URL("../../docs/running.md", import.meta.url));

/** The rows of the table of variables in the documentation, each cell trimmed. */
function documentedVariables(): string[][] {
  const lines = readFileSync(RUNNING, "utf8").split("\n");
  const header = lines.findIndex((line) => line.startsWith("| Variable |"));
  const end = lines.indexOf("", header);
  return lines.slice(header + 2, end).map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
}

/** Runs the API as a program with the given variables only, and gives its exit code and outputs. */
function api(variables: Record<string, string>): Promise<{ code: number | null; out: string; err: string }> {
  const env = { NODE_V8_COVERAGE: process.env["NODE_V8_COVERAGE"] ?? "", ...variables };
  return new Promise((resolve) =>
    execFile(process.execPath, ["--enable-source-maps", MAIN], { env, encoding: "utf8", timeout: 10_000 }, (error, out, err) =>
      resolve({ code: error === null ? 0 : (error.code as number), out, err }),
    ),
  );
}

function violationsOf(action: () => unknown): readonly string[] {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof ConfigurationError);
    return error.violations;
  }
  return assert.fail("no configuration error was raised");
}

describe("the configuration of the API", () => {
  it("is read from the environment, with the default address", () => {
    const configuration = ApiConfiguration.read({ OQAS_PORT: "8080" });
    assert.deepEqual({ host: configuration.host, port: configuration.port }, { host: "0.0.0.0", port: 8080 });
    assert.ok(Object.isFrozen(configuration));
    assert.equal(ApiConfiguration.read({ OQAS_HOST: "127.0.0.1", OQAS_PORT: "1" }).host, "127.0.0.1");
    assert.equal(ApiConfiguration.read({ OQAS_PORT: "65535" }).port, 65535);
  });

  it("is read from the environment of the process", () => {
    assert.equal(processEnvironment(), process.env);
  });

  it("names every variable at fault in one error", () => {
    assert.deepEqual(violationsOf(() => ApiConfiguration.read({ OQAS_HOST: "" })), [
      "OQAS_HOST must be a text that is not empty.",
      "OQAS_PORT is required and is not set.",
    ]);
  });

  it("documents a type, a description and an example for every variable", () => {
    for (const variable of Object.values(API_VARIABLES) as EnvironmentVariable<unknown>[]) {
      assert.match(variable.name, /^OQAS_[A-Z_]+$/);
      assert.ok(variable.description.length > 0 && variable.type.rule.length > 0);
      assert.ok(variable.type.parse(variable.example).ok);
      if (variable.defaultValue !== undefined) assert.ok(variable.type.parse(variable.defaultValue).ok);
    }
  });
});

describe("the documentation of the configuration", () => {
  it("lists exactly the variables the API reads, with their rule, whether required or secret, default and example", () => {
    const code = (value: string | undefined): string => (value === undefined ? "" : `\`${value}\``);
    const expected = (Object.values(API_VARIABLES) as EnvironmentVariable<unknown>[]).map((variable) => [
      code(variable.name),
      variable.type.rule,
      variable.defaultValue === undefined ? "yes" : "no",
      variable.secret ? "yes" : "no",
      code(variable.defaultValue),
      code(variable.example),
      variable.description,
    ]);
    assert.deepEqual(documentedVariables(), expected);
  });
});

describe("a port", () => {
  it("is an integer from 1 to 65535, in decimal digits", () => {
    assert.deepEqual(["1", "80", "65535"].map((raw) => portNumber.parse(raw)), [1, 80, 65535].map((value) => ({ ok: true, value })));
    for (const raw of ["", "0", "65536", "70000", "123456", "-1", "8080.5", "8e3", "0x50", " 80", "eighty"]) {
      assert.deepEqual(portNumber.parse(raw), { ok: false }, raw);
    }
  });
});

describe("a text", () => {
  it("is not empty", () => {
    assert.deepEqual(nonEmptyText.parse("x"), { ok: true, value: "x" });
    assert.deepEqual(nonEmptyText.parse(""), { ok: false });
  });
});

describe("a missing mandatory variable", () => {
  it("stops the startup with a non-zero exit code and a message that names the variable", async () => {
    const run = await api({});
    assert.equal(run.code, 1);
    assert.equal(run.err, "The configuration is invalid:\n- OQAS_PORT is required and is not set.\n");
    assert.equal(run.out, "");
  });
});

describe("an invalid value", () => {
  for (const raw of ["eighty", "70000", "-1"]) {
    it(`stops the startup with a message that names the variable without the value: ${raw}`, async () => {
      const run = await api({ OQAS_PORT: raw });
      assert.equal(run.code, 1);
      assert.equal(run.err, "The configuration is invalid:\n- OQAS_PORT must be an integer from 1 to 65535.\n");
      assert.ok(!run.err.includes(raw) && !run.out.includes(raw));
    });
  }
});

describe("a variable declared secret", () => {
  const WITNESS = "witness-3f9c2a7e";
  const token: ValueType<string> = { rule: "a text of 40 characters", parse: (raw) => (raw.length === 40 ? { ok: true, value: raw } : { ok: false }) };
  const variables = {
    token: { name: "TEST_TOKEN", description: "A token.", type: token, secret: true, example: "x".repeat(40) },
    port: { name: "TEST_PORT", description: "A port.", type: portNumber, secret: false, example: "8080" },
  } satisfies Record<string, EnvironmentVariable<unknown>>;

  it("never appears in the message of a configuration error", () => {
    const violations = violationsOf(() => readVariables(variables, { TEST_TOKEN: WITNESS }));
    assert.deepEqual(violations, ["TEST_TOKEN must be a text of 40 characters.", "TEST_PORT is required and is not set."]);
    const error = new ConfigurationError(violations);
    assert.ok(!error.message.includes(WITNESS) && !String(error.stack).includes(WITNESS));
  });

  it("is read like any other variable once valid", () => {
    const secret = WITNESS.padEnd(40, "0");
    assert.deepEqual(readVariables(variables, { TEST_TOKEN: secret, TEST_PORT: "8080" }), { token: secret, port: 8080 });
  });
});
