import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { closedPort } from "@open-qa-stack/testing";
import { ApiConfiguration } from "../src/config/api-configuration.ts";
import { splitCommandLine } from "../src/config/command-line.ts";
import { API_VARIABLES } from "../src/config/api-variables.ts";
import { ConfigurationError } from "../src/config/configuration-error.ts";
import type { EnvironmentVariable } from "../src/config/environment-variable.ts";
import { processEnvironment } from "../src/config/process-environment.ts";
import { readVariables } from "../src/config/read-variables.ts";
import { absolutePath, commandLine, databaseUrl, nonEmptyText, portNumber, type ValueType } from "../src/config/value-type.ts";
import { childEnvironment, TEST_ENVIRONMENT } from "./support/environment.ts";

const DATABASE = "postgres://oqas:secret@127.0.0.1:5432/oqas";
const MAIN = fileURLToPath(new URL("../src/main.js", import.meta.url));
const RUNNING = fileURLToPath(new URL("../../docs/running.md", import.meta.url));

/** The rows of the table of variables in the documentation, each cell trimmed. */
function documentedVariables(): string[][] {
  const lines = readFileSync(RUNNING, "utf8").split("\n");
  const header = lines.findIndex((line) => line.startsWith("| Variable |"));
  const end = lines.indexOf("", header);
  return lines.slice(header + 2, end).map((line) =>
    line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim()),
  );
}

/** Runs the API as a program with the given variables only, and gives its exit code and outputs. */
function api(variables: Record<string, string>): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) =>
    execFile(
      process.execPath,
      ["--enable-source-maps", MAIN],
      { env: childEnvironment(variables), encoding: "utf8", timeout: START_TIMEOUT_MS },
      (error, out, err) => resolve({ code: error === null ? 0 : (error.code as number), out, err }),
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

/** Longest an API that refuses its configuration takes to stop, on a machine that runs the other packages at once. */
const START_TIMEOUT_MS = 60_000;

describe("the configuration of the API", () => {
  it("is read from the environment, with the default address", () => {
    const configuration = ApiConfiguration.read({ OQAS_PORT: "8080", OQAS_DATABASE_URL: DATABASE });
    assert.deepEqual({ host: configuration.host, port: configuration.port }, { host: "0.0.0.0", port: 8080 });
    assert.equal(configuration.database.reveal(), DATABASE);
    assert.ok(Object.isFrozen(configuration));
    assert.equal(ApiConfiguration.read({ OQAS_HOST: "127.0.0.1", OQAS_PORT: "1", OQAS_DATABASE_URL: DATABASE }).host, "127.0.0.1");
    assert.equal(ApiConfiguration.read({ OQAS_PORT: "65535", OQAS_DATABASE_URL: DATABASE }).port, 65535);
  });

  it("is read from the environment of the process", () => {
    assert.equal(processEnvironment(), TEST_ENVIRONMENT);
  });

  it("names every variable at fault in one error", () => {
    assert.deepEqual(
      violationsOf(() => ApiConfiguration.read({ OQAS_HOST: "" })),
      ["OQAS_HOST must be a text that is not empty.", "OQAS_PORT is required and is not set.", "OQAS_DATABASE_URL is required and is not set."],
    );
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
      variable.defaultValue === undefined && variable.optional !== true ? "yes" : "no",
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
    assert.deepEqual(
      ["1", "80", "65535"].map((raw) => portNumber.parse(raw)),
      [1, 80, 65535].map((value) => ({ ok: true, value })),
    );
    for (const raw of ["", "0", "65536", "70000", "123456", "-1", "8080.5", "8e3", "0x50", " 80", "eighty"]) {
      assert.deepEqual(portNumber.parse(raw), { ok: false }, raw);
    }
  });
});

describe("a database URL", () => {
  it("is a postgres or postgresql URL with a host name", () => {
    for (const raw of ["postgres://127.0.0.1/oqas", "postgresql://oqas:p%40ss@db.example:5432/oqas?sslmode=require"]) {
      const parsed = databaseUrl.parse(raw);
      assert.ok(parsed.ok && parsed.value.reveal() === raw, raw);
    }
    for (const raw of [
      "",
      "oqas",
      "mysql://127.0.0.1/oqas",
      "postgres:///oqas",
      "postgres:///oqas?host=/var/run/postgresql",
      "postgres://oqas:%zz@127.0.0.1/oqas",
      "http://127.0.0.1",
    ]) {
      assert.deepEqual(databaseUrl.parse(raw), { ok: false }, raw);
    }
  });
});

describe("a text", () => {
  it("is not empty", () => {
    assert.deepEqual(nonEmptyText.parse("x"), { ok: true, value: "x" });
    assert.deepEqual(nonEmptyText.parse(""), { ok: false });
  });
});

describe("an absolute path", () => {
  it("starts at the root of the file system", () => {
    assert.deepEqual(absolutePath.parse("/srv/tests"), { ok: true, value: "/srv/tests" });
    for (const raw of ["", "tests", "./tests", "../tests"]) assert.deepEqual(absolutePath.parse(raw), { ok: false }, raw);
  });
});

describe("a command", () => {
  it("is split into its program and its arguments at the spaces, however many", () => {
    assert.deepEqual(splitCommandLine("node /clone/packages/cli/src/main.ts"), ["node", "/clone/packages/cli/src/main.ts"]);
    assert.deepEqual(splitCommandLine("  oqas\t--follow \n"), ["oqas", "--follow"]);
    assert.deepEqual(commandLine.parse("oqas"), { ok: true, value: ["oqas"] });
  });

  it("keeps what is between quotes as it is, spaces and the other quote included, and joins it to what touches it", () => {
    assert.deepEqual(splitCommandLine(`node "/my clone/main.ts" --name='it"s' ''`), ["node", "/my clone/main.ts", `--name=it"s`, ""]);
    assert.deepEqual(splitCommandLine(`"/opt/my tools"/oqas`), ["/opt/my tools/oqas"]);
  });

  it("takes nothing else as special: neither a variable, nor an escape, nor what a shell would run", () => {
    assert.deepEqual(splitCommandLine("C:\\tools\\oqas.cmd $HOME ; rm -rf / | `id`"), ["C:\\tools\\oqas.cmd", "$HOME", ";", "rm", "-rf", "/", "|", "`id`"]);
  });

  it("is refused when it names no program or leaves a quote open", () => {
    for (const raw of ["", "   ", `"" --follow`, `node "main.ts`, "node 'main.ts"]) {
      assert.equal(splitCommandLine(raw), undefined, raw);
      assert.deepEqual(commandLine.parse(raw), { ok: false }, raw);
    }
  });
});

describe("an optional variable", () => {
  const variables = {
    port: { name: "TEST_PORT", description: "A port.", type: portNumber, secret: false, optional: true, example: "8080" },
  } satisfies Record<string, EnvironmentVariable<unknown>>;

  it("has no value when it is not set, and is read like any other when it is", () => {
    assert.deepEqual(readVariables(variables, {}), {});
    assert.deepEqual(readVariables(variables, { TEST_PORT: "8080" }), { port: 8080 });
  });

  it("is refused when it is set to an invalid value", () => {
    assert.deepEqual(
      violationsOf(() => readVariables(variables, { TEST_PORT: "" })),
      ["TEST_PORT must be an integer from 1 to 65535."],
    );
  });
});

describe("the bridge to the command line", () => {
  const REQUIRED = { OQAS_PORT: "8080", OQAS_DATABASE_URL: DATABASE };

  it("is not configured by default", () => {
    const configuration = ApiConfiguration.read(REQUIRED);
    assert.deepEqual([configuration.soloRepository, configuration.soloCommand], [undefined, undefined]);
  });

  it("is configured with the test repository and with the command that starts oqas", () => {
    const configuration = ApiConfiguration.read({ ...REQUIRED, OQAS_SOLO_REPOSITORY: "/srv/tests", OQAS_SOLO_COMMAND: "node '/my clone/main.ts'" });
    assert.deepEqual([configuration.soloRepository, configuration.soloCommand], ["/srv/tests", ["node", "/my clone/main.ts"]]);
  });

  it("is refused with a relative repository or a command that cannot be split", () => {
    assert.deepEqual(
      violationsOf(() => ApiConfiguration.read({ ...REQUIRED, OQAS_SOLO_REPOSITORY: "tests", OQAS_SOLO_COMMAND: "node 'main.ts" })),
      [
        "OQAS_SOLO_REPOSITORY must be an absolute path.",
        "OQAS_SOLO_COMMAND must be a program and its arguments, separated by spaces, one that holds a space between quotes.",
      ],
    );
  });
});

describe("a missing mandatory variable", () => {
  it("stops the startup with a non-zero exit code and a message that names the variable", async () => {
    const run = await api({ OQAS_DATABASE_URL: DATABASE });
    assert.equal(run.code, 1);
    assert.equal(run.err, "The configuration is invalid:\n- OQAS_PORT is required and is not set.\n");
    assert.equal(run.out, "");
  });
});

describe("an invalid value", () => {
  for (const raw of ["eighty", "70000", "-1"]) {
    it(`stops the startup with a message that names the variable without the value: ${raw}`, async () => {
      const run = await api({ OQAS_PORT: raw, OQAS_DATABASE_URL: DATABASE });
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

describe("every variable declared secret", () => {
  const WITNESS = "witness-5b8e1c09";
  /** For each secret variable, a valid and an invalid value that both hold the witness. */
  const witnessValues = async (): Promise<Record<string, { valid: string; invalid: string }>> => ({
    OQAS_DATABASE_URL: { valid: `postgres://oqas:${WITNESS}@127.0.0.1:${await closedPort()}/oqas`, invalid: `postgres://oqas:${WITNESS}@/oqas` },
  });
  const secrets = (Object.values(API_VARIABLES) as EnvironmentVariable<unknown>[]).filter((variable) => variable.secret).map((variable) => variable.name);
  const baseline = async () => ({ NO_COLOR: "1", OQAS_HOST: "127.0.0.1", OQAS_PORT: String(await closedPort()), OQAS_DATABASE_URL: DATABASE });

  /** Starts the API, stops it once it listens, and gives everything it wrote. */
  async function startAndStop(variables: Record<string, string>): Promise<string> {
    const child = spawn(process.execPath, ["--enable-source-maps", MAIN], { env: childEnvironment(variables) });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("Listening on")) child.kill("SIGTERM");
      });
    }
    await once(child, "exit");
    return output;
  }

  it("has witness values in this test", async () => {
    assert.deepEqual(Object.keys(await witnessValues()), secrets);
    assert.ok(secrets.length > 0);
  });

  for (const name of secrets) {
    it(`never appears in the outputs of a startup: ${name}`, async () => {
      const { valid, invalid } = (await witnessValues())[name] as { valid: string; invalid: string };
      const started = await startAndStop({ ...(await baseline()), [name]: valid });
      assert.match(started, /Listening on/);
      assert.ok(!started.includes(WITNESS), started);
      const refused = await api({ ...(await baseline()), [name]: invalid });
      assert.equal(refused.code, 1);
      assert.match(refused.err, new RegExp(`^- ${name} must be`, "m"));
      assert.ok(!refused.out.includes(WITNESS) && !refused.err.includes(WITNESS), refused.err);
    });
  }
});
