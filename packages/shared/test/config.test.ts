import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { renderSchema, SCHEMA_FILE } from "../scripts/emit-schema.ts";
import { CONFIG_FILE_NAME, configSchema, DEFAULT_REPOSITORY, validateConfig, type ConfigError } from "../src/index.ts";
import { at, errorsOf, example, EXAMPLE_ENV, exampleText, listAt, validateVariant, type JsonObject } from "./helpers.ts";
import { BLOCKED, NetworkAccessError } from "./no-network.ts";

const only = (errors: ConfigError[]) => {
  assert.equal(errors.length, 1, JSON.stringify(errors));
  return errors[0]!;
};

describe("criterion 1 — the configuration file has a valid JSON Schema", () => {
  it("is a valid draft 2020-12 schema", () => {
    const ajv = new Ajv2020({ strict: false });
    assert.equal(ajv.validateSchema(configSchema), true, JSON.stringify(ajv.errors));
  });

  it("is published, unchanged, as schema/oqas.schema.json", () => {
    assert.equal(readFileSync(SCHEMA_FILE, "utf8"), renderSchema());
  });
});

describe("criterion 2 — the example for the target application is valid", () => {
  it("is accepted by the schema and the validation, with its variables set", () => {
    const result = validateConfig(exampleText(), EXAMPLE_ENV);
    assert.equal(result.ok, true, JSON.stringify(result));
  });
});

describe("criterion 3 — the example declares the three applications and their four contracts", () => {
  const config = example();
  const apps = listAt(config, "applications") as JsonObject[];
  const environments = apps.map((app) => listAt(app, "environments") as JsonObject[]);
  const apis = environments.flatMap((envs) => envs.flatMap((env) => (env["apis"] ?? []) as JsonObject[]));

  it("has three applications with one local environment each, on ports 3000, 3010 and 3020", () => {
    assert.equal(apps.length, 3);
    assert.deepEqual(
      environments.map((envs) => envs.map((env) => env["name"])),
      [["local"], ["local"], ["local"]],
    );
    assert.deepEqual(
      environments.map((envs) => new URL(String(envs[0]!["uiUrl"])).port),
      ["3000", "3010", "3020"],
    );
  });

  it("has four named APIs on ports 8080, 8090, 8100 and 8110, each with its OpenAPI contract on /v3/api-docs", () => {
    assert.deepEqual(apis.map((api) => new URL(String(api["baseUrl"])).port).sort(), ["8080", "8090", "8100", "8110"]);
    const contracts = (listAt(config, "knowledge") as JsonObject[]).filter((k) => k["type"] === "openapi");
    assert.equal(contracts.length, 4);
    for (const api of apis) {
      const designating = contracts.filter((k) => (k["attachments"] as JsonObject[]).some((a) => a["api"] === api["name"]));
      assert.equal(designating.length, 1, String(api["name"]));
      assert.equal(designating[0]!["url"], `${String(api["baseUrl"])}/v3/api-docs`);
    }
  });
});

describe("criterion 4 — the example declares the four databases by environment variable", () => {
  const knowledge = listAt(example(), "knowledge") as JsonObject[];
  const databases = knowledge.filter((k) => k["type"] === "postgresql");

  it("declares one PostgreSQL knowledge per database, each with its own variable and application", () => {
    const declared = databases.map((k) => [
      k["id"],
      k["connectionStringEnv"],
      (k["attachments"] as JsonObject[]).map((a) => a["application"]).join(","),
    ]);
    assert.deepEqual(declared, [
      ["customer-core-db", "CUSTOMER_CORE_DB_URL", "customer-management"],
      ["customer-self-service-db", "CUSTOMER_SELF_SERVICE_DB_URL", "customer-self-service"],
      ["customer-management-db", "CUSTOMER_MANAGEMENT_DB_URL", "customer-management"],
      ["policy-management-db", "POLICY_MANAGEMENT_DB_URL", "policy-management"],
    ]);
  });

  it("contains no connection string", () => {
    const values: string[] = [];
    JSON.parse(exampleText(), (_key, value: unknown) => {
      if (typeof value === "string") values.push(value);
      return value;
    });
    for (const prefix of ["postgresql://", "postgres://", "jdbc:"]) {
      assert.equal(values.filter((v) => v.startsWith(prefix)).length, 0, prefix);
    }
  });
});

describe("criterion 5 — the example connects to the local model and is supervised", () => {
  const config = example();

  it("uses a provider key on http://localhost:1234/v1, the key by variable name", () => {
    assert.equal(at(config, "model")["mode"], "provider-key");
    assert.equal(at(config, "model")["baseUrl"], "http://localhost:1234/v1");
    assert.match(String(at(config, "model")["apiKeyEnv"]), /^[A-Z_][A-Z0-9_]*$/);
  });

  it("uses the supervised level", () => {
    assert.deepEqual(at(config, "autonomy"), { level: "supervised" });
  });
});

describe("criterion 6 — a value that is not a variable name is refused without being repeated", () => {
  const leaks = ["postgresql://admin:hunter2@db.internal:5432/app", "user@host:secret", "sk-live-0123456789abcdef"];
  for (const value of leaks) {
    it(`refuses ${value.slice(0, 5)}… as a connection string variable`, () => {
      const errors = errorsOf(validateVariant((c) => (at(c, "knowledge/4")["connectionStringEnv"] = value)));
      const e = only(errors);
      assert.equal(e.path, "/knowledge/4/connectionStringEnv");
      assert.equal(e.rule, "env-var-name");
      assert.ok(!JSON.stringify(errors).includes(value));
    });
  }

  it("applies the same rule to account and model key variables", () => {
    const errors = errorsOf(
      validateVariant((c) => {
        at(c, "applications/0/authentication/accounts/0")["passwordEnv"] = "s3cr3t!";
        at(c, "model")["apiKeyEnv"] = "sk-abc";
      }),
    );
    assert.deepEqual(errors.map((e) => [e.path, e.rule]).sort(), [
      ["/applications/0/authentication/accounts/0/passwordEnv", "env-var-name"],
      ["/model/apiKeyEnv", "env-var-name"],
    ]);
  });
});

describe("criterion 7 — an unknown key is refused at any depth", () => {
  it("at the root", () => {
    const e = only(errorsOf(validateVariant((c) => (c["password"] = "x"))));
    assert.deepEqual([e.path, e.rule], ["/password", "unknown-key"]);
  });

  it("in a nested section", () => {
    const e = only(errorsOf(validateVariant((c) => (at(c, "applications/1/environments/0/apis/0")["token"] = "x"))));
    assert.deepEqual([e.path, e.rule], ["/applications/1/environments/0/apis/0/token", "unknown-key"]);
  });

  it("escapes the key in the JSON Pointer", () => {
    const e = only(errorsOf(validateVariant((c) => (at(c, "autonomy")["a/b~c"] = 1))));
    assert.equal(e.path, "/autonomy/a~1b~0c");
  });
});

describe("criterion 8 — a missing section is named", () => {
  for (const section of ["applications", "knowledge", "model", "autonomy"]) {
    it(`without ${section}`, () => {
      const e = only(errorsOf(validateVariant((c) => delete c[section])));
      assert.deepEqual([e.path, e.rule], [`/${section}`, "required"]);
    });
  }
});

describe("criterion 9 — duplicates are refused, one error per duplicate", () => {
  it("reports a duplicated application id, environment name, API name and knowledge id", () => {
    const errors = errorsOf(
      validateVariant((c) => {
        const apps = listAt(c, "applications");
        apps.push({ ...at(c, "applications/1") });
        listAt(c, "applications/2/environments").push({ name: "local", uiUrl: "http://localhost:3020" });
        listAt(c, "applications/2/environments/0/apis").push({ name: "customer-core", baseUrl: "http://localhost:8111" });
        listAt(c, "knowledge").push({ ...at(c, "knowledge/0") });
      }),
    );
    assert.deepEqual(
      errors.map((e) => [e.path, e.rule]),
      [
        ["/applications/2/environments/0/apis/2/name", "duplicate"],
        ["/applications/2/environments/1/name", "duplicate"],
        ["/applications/3/id", "duplicate"],
        ["/knowledge/8/id", "duplicate"],
      ],
    );
  });
});

describe("criterion 10 — URLs are absolute, http or https, without credentials", () => {
  const cases: Array<[string, string]> = [
    ["/applications/0/environments/0/uiUrl", "url-absolute"],
    ["/applications/0/environments/0/apis/0/baseUrl", "url-scheme"],
    ["/knowledge/0/url", "url-credentials"],
    ["/model/baseUrl", "url-absolute"],
  ];

  it("refuses a relative URL, another scheme and embedded credentials", () => {
    const errors = errorsOf(
      validateVariant((c) => {
        at(c, "applications/0/environments/0")["uiUrl"] = "/login";
        at(c, "applications/0/environments/0/apis/0")["baseUrl"] = "ftp://localhost:8080";
        at(c, "knowledge/0")["url"] = "http://user:pass@localhost:8080/v3/api-docs";
        at(c, "model")["baseUrl"] = "v1";
      }),
    );
    assert.deepEqual(errors.map((e) => [e.path, e.rule]), cases);
    assert.ok(!JSON.stringify(errors).includes("pass@"));
  });
});

describe("criterion 11 — a document path may not leave the test repository", () => {
  const document = (path: string) => (c: JsonObject) =>
    listAt(c, "knowledge").push({ id: "specs", type: "document", path, attachments: [{ application: "policy-management" }] });

  for (const [path, rule] of [
    ["../outside.md", "path-outside-root"],
    ["specs/../../outside.md", "path-outside-root"],
    ["..\\outside.md", "path-outside-root"],
    ["/etc/passwd", "path-absolute"],
    ["C:\\specs.md", "path-absolute"],
  ] as const) {
    it(`refuses ${path}`, () => {
      const e = only(errorsOf(validateVariant(document(path))));
      assert.deepEqual([e.path, e.rule], ["/knowledge/8/path", rule]);
    });
  }

  it("accepts a path inside the repository", () => {
    assert.equal(validateVariant(document("specs/./quotes.md")).ok, true);
  });
});

describe("criterion 12 — a missing variable is an environment error that names it", () => {
  it("names each unset or empty variable without repeating any value", () => {
    const env = { ...EXAMPLE_ENV, CUSTOMER_CORE_DB_URL: undefined, OQAS_MODEL_API_KEY: "" };
    const errors = errorsOf(validateConfig(exampleText(), env));
    assert.deepEqual(
      errors.map((e) => [e.kind, e.path, e.rule]),
      [
        ["environment", "/knowledge/4/connectionStringEnv", "env-var-missing"],
        ["environment", "/model/apiKeyEnv", "env-var-missing"],
      ],
    );
    assert.match(errors[0]!.message, /CUSTOMER_CORE_DB_URL/);
    const serialised = JSON.stringify(errors);
    for (const value of Object.values(EXAMPLE_ENV)) assert.ok(!serialised.includes(String(value)));
  });

  it("checks account variables too", () => {
    const errors = errorsOf(validateConfig(exampleText(), { ...EXAMPLE_ENV, CSS_DEMO_PASSWORD: undefined }));
    assert.deepEqual(only(errors).path, "/applications/0/authentication/accounts/0/passwordEnv");
  });
});

describe("criterion 13 — the format version is required and recognised", () => {
  it("refuses a file without a version", () => {
    const e = only(errorsOf(validateVariant((c) => delete c["formatVersion"])));
    assert.deepEqual([e.path, e.rule], ["/formatVersion", "required"]);
  });

  it("refuses an unknown version", () => {
    const e = only(errorsOf(validateVariant((c) => (c["formatVersion"] = 2))));
    assert.deepEqual([e.path, e.rule], ["/formatVersion", "format-version"]);
  });
});

describe("criterion 14 — a knowledge source refers only to declared elements", () => {
  const attach = (attachment: JsonObject) => (c: JsonObject) => {
    at(c, "knowledge/0")["attachments"] = [attachment];
  };

  for (const [attachment, field, rule] of [
    [{ application: "billing" }, "application", "unknown-reference"],
    [{ application: "customer-self-service", environment: "staging" }, "environment", "unknown-reference"],
    [{ application: "customer-self-service", environment: "local", api: "billing-backend" }, "api", "unknown-reference"],
    [{ application: "customer-self-service", api: "customer-self-service-backend" }, "api", "api-without-environment"],
  ] as const) {
    it(`refuses ${JSON.stringify(attachment)}`, () => {
      const e = only(errorsOf(validateVariant(attach(attachment))));
      assert.deepEqual([e.kind, e.path, e.rule], ["reference", `/knowledge/0/attachments/0/${field}`, rule]);
    });
  }

  it("refuses an API in an environment that declares none", () => {
    const e = only(
      errorsOf(
        validateVariant((c) => {
          delete at(c, "applications/0/environments/0")["apis"];
          listAt(c, "knowledge").splice(0, 1);
          at(c, "knowledge/0")["attachments"] = [{ application: "customer-self-service", environment: "local", api: "customer-self-service-backend" }];
        }),
      ),
    );
    assert.deepEqual([e.path, e.rule], ["/knowledge/0/attachments/0/api", "unknown-reference"]);
  });

  it("accepts an attachment to a whole application", () => {
    assert.equal(validateVariant(attach({ application: "customer-self-service" })).ok, true);
  });
});

describe("criterion 15 — autonomy levels produce their limits", () => {
  const limits = (autonomy: JsonObject) => {
    const result = validateVariant((c) => (c["autonomy"] = autonomy));
    assert.ok(result.ok, JSON.stringify(result));
    return result.config.autonomy.limits;
  };

  it("supervised: 5 iterations, 10 minutes, 200 actions per task; 40 tests or 3 idle rounds per batch", () => {
    assert.deepEqual(limits({ level: "supervised" }), {
      task: { maxIterations: 5, maxDurationMinutes: 10, maxActions: 200 },
      batch: { maxTests: 40, maxIdleRounds: 3, stopOnPlateau: false },
      guardrailMinutes: null,
    });
  });

  it("autonomous: no volume limit, a two-hour guardrail, a stop once new tests stop coming", () => {
    assert.deepEqual(limits({ level: "autonomous" }), {
      task: { maxIterations: null, maxDurationMinutes: null, maxActions: null },
      batch: { maxTests: null, maxIdleRounds: null, stopOnPlateau: true },
      guardrailMinutes: 120,
    });
  });

  const custom = {
    level: "custom",
    task: { maxIterations: 8, maxDurationMinutes: 15, maxActions: 300 },
    batch: { maxTests: 20, maxIdleRounds: 2 },
    guardrailMinutes: 60,
  };

  it("custom: the limits as written", () => {
    assert.deepEqual(limits(custom), {
      task: custom.task,
      batch: { ...custom.batch, stopOnPlateau: false },
      guardrailMinutes: custom.guardrailMinutes,
    });
  });

  it("custom: refuses a missing limit", () => {
    const e = only(errorsOf(validateVariant((c) => (c["autonomy"] = { ...custom, guardrailMinutes: undefined }))));
    assert.deepEqual([e.path, e.rule], ["/autonomy/guardrailMinutes", "required"]);
  });

  for (const value of [0, -1, 2.5, "10"]) {
    it(`custom: refuses ${JSON.stringify(value)} as a limit`, () => {
      const e = only(errorsOf(validateVariant((c) => (c["autonomy"] = { ...custom, batch: { maxTests: value, maxIdleRounds: 2 } }))));
      assert.equal(e.path, "/autonomy/batch/maxTests");
    });
  }

  it("refuses limits on a predefined level", () => {
    const e = only(errorsOf(validateVariant((c) => (c["autonomy"] = { level: "supervised", guardrailMinutes: 30 }))));
    assert.deepEqual([e.path, e.rule], ["/autonomy/guardrailMinutes", "unknown-key"]);
  });
});

describe("criterion 16 — validation needs no network, database or model", () => {
  it("runs with every network entry point refusing to work", () => {
    assert.ok(Object.keys(BLOCKED).length >= 40);
    for (const [label, stub] of Object.entries(BLOCKED)) assert.throws(stub, NetworkAccessError, label);
    assert.equal(validateConfig(exampleText(), EXAMPLE_ENV).ok, true);
    assert.equal(validateConfig("{}", {}).ok, false);
  });
});

describe("criterion 17 — the file name is defined once", () => {
  it("appears as a literal only in its constant", () => {
    const roots = ["src", "scripts", "test"].map((dir) => new URL(`../${dir}/`, import.meta.url));
    const files = roots.flatMap((root) =>
      readdirSync(root, { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".ts"))
        .map((f) => new URL(f, root)),
    );
    const offenders = files.filter((f) => readFileSync(f, "utf8").includes(CONFIG_FILE_NAME) && !f.pathname.endsWith("/config/file-names.ts"));
    assert.deepEqual(offenders, []);
    assert.equal(files.filter((f) => f.pathname.endsWith("/config/file-names.ts")).length, 1);
  });
});

describe("criterion 19 — the documentation examples are valid", () => {
  const doc = readFileSync(new URL("../docs/configuration.md", import.meta.url), "utf8");
  const blocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!);

  it("has a complete file example that validates", () => {
    const file = blocks.find((b) => b.includes('"formatVersion"'));
    assert.ok(file);
    const result = validateConfig(file, EXAMPLE_ENV);
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  it("has a custom autonomy example that validates", () => {
    const custom = blocks.find((b) => b.includes('"custom"'));
    assert.ok(custom);
    const result = validateVariant((c) => (c["autonomy"] = JSON.parse(custom) as JsonObject));
    assert.equal(result.ok, true, JSON.stringify(result));
  });
});

describe("other structural rules", () => {
  it("refuses a file that is not JSON, without quoting it", () => {
    const errors = errorsOf(validateConfig('{"model": sk-not-json', EXAMPLE_ENV));
    assert.deepEqual(only(errors), { kind: "syntax", path: "", rule: "json", message: "The file is not valid JSON." });
  });

  it("refuses an identifier that is not a slug", () => {
    const e = only(errorsOf(validateVariant((c) => (at(c, "applications/1")["id"] = "Policy_Management"))));
    assert.deepEqual([e.path, e.rule], ["/applications/1/id", "slug"]);
  });

  it("refuses an unknown knowledge type or model mode", () => {
    const errors = errorsOf(
      validateVariant((c) => {
        at(c, "knowledge/0")["type"] = "graphql";
        at(c, "model")["mode"] = "github-app";
      }),
    );
    assert.deepEqual(errors.map((e) => [e.path, e.rule]), [
      ["/knowledge/0/type", "unknown-variant"],
      ["/model/mode", "unknown-variant"],
    ]);
  });

  it("requires exactly one source for an OpenAPI contract", () => {
    const neither = only(errorsOf(validateVariant((c) => delete at(c, "knowledge/0")["url"])));
    const both = only(errorsOf(validateVariant((c) => (at(c, "knowledge/0")["path"] = "contracts/api.json"))));
    for (const e of [neither, both]) assert.deepEqual([e.path, e.rule], ["/knowledge/0", "openapi-source"]);
  });

  it("accepts an OpenAPI contract stored in the repository", () => {
    const result = validateVariant((c) => {
      delete at(c, "knowledge/0")["url"];
      at(c, "knowledge/0")["path"] = "contracts/customer-self-service.json";
    });
    assert.equal(result.ok, true);
  });

  it("reports other type errors by keyword", () => {
    const e = only(errorsOf(validateVariant((c) => (c["applications"] = []))));
    assert.deepEqual([e.path, e.rule], ["/applications", "too-few-items"]);
  });

  it("requires a user interface URL for a web application, not for an API", () => {
    const missing = only(errorsOf(validateVariant((c) => delete at(c, "applications/1/environments/0")["uiUrl"])));
    assert.deepEqual([missing.path, missing.rule], ["/applications/1/environments/0/uiUrl", "ui-url-required"]);
    const api = validateVariant((c) => {
      at(c, "applications/1")["type"] = "api";
      delete at(c, "applications/1/environments/0")["uiUrl"];
    });
    assert.equal(api.ok, true);
  });

  it("accepts an environment without APIs and a model without a key", () => {
    const result = validateVariant((c) => {
      listAt(c, "knowledge").splice(1, 1);
      delete at(c, "applications/1/environments/0")["apis"];
      delete at(c, "model")["apiKeyEnv"];
    });
    assert.equal(result.ok, true, JSON.stringify(result));
  });
});

describe("repository layout", () => {
  it("defaults to apps/, blocs/, parcours/ and .oqas/", () => {
    const result = validateConfig(exampleText(), EXAMPLE_ENV);
    assert.ok(result.ok);
    assert.deepEqual(result.config.repository, DEFAULT_REPOSITORY);
    assert.deepEqual(DEFAULT_REPOSITORY, {
      appsDir: "apps",
      blocksDir: "blocs",
      journeysDir: "parcours",
      stateDir: ".oqas",
      indexDir: ".oqas/index",
    });
  });

  it("keeps the folders the file sets and refuses one outside the repository", () => {
    const set = validateVariant((c) => (c["repository"] = { journeysDir: "journeys" }));
    assert.ok(set.ok);
    assert.equal(set.config.repository.journeysDir, "journeys");
    assert.equal(set.config.repository.appsDir, "apps");
    const e = only(errorsOf(validateVariant((c) => (c["repository"] = { stateDir: "../state" }))));
    assert.deepEqual([e.path, e.rule], ["/repository/stateDir", "path-outside-root"]);
  });
});

describe("hardening", () => {
  it("refuses a key written twice, which JSON.parse would silently drop", () => {
    const text = exampleText().replace('"formatVersion": 1,', '"formatVersion": 1,\n  "model": { "apiKey": "sk-pasted-by-mistake" },');
    const errors = errorsOf(validateConfig(text, EXAMPLE_ENV));
    assert.deepEqual(only(errors), { kind: "structure", path: "/model", rule: "duplicate-key", message: "Duplicate key." });
    assert.ok(!JSON.stringify(errors).includes("sk-pasted"));
  });

  it("locates a repeated key inside arrays and escaped names", () => {
    const text = '{"a": [1, {"x": "\\"q", "y": 2}, {"k\\u0041": 1, "kA": 2}], "b": {"c": {}, "c": []}}';
    const errors = errorsOf(validateConfig(text, {}));
    assert.deepEqual(errors.map((e) => e.path), ["/a/2/kA", "/b/c"]);
  });

  it("checks a document that is a single value", () => {
    assert.deepEqual(only(errorsOf(validateConfig('"oqas"', {}))).rule, "wrong-type");
  });

  it("ignores a leading byte order mark", () => {
    assert.equal(validateConfig(`\uFEFF${exampleText()}`, EXAMPLE_ENV).ok, true);
  });

  it("does not repeat an unknown key in its message", () => {
    const e = only(errorsOf(validateVariant((c) => (c["sk-pasted-key"] = 1))));
    assert.equal(e.message, "Unknown key.");
  });

  it("refuses control characters in a path", () => {
    const e = only(errorsOf(validateVariant((c) => (c["repository"] = { indexDir: "index\u0000" }))));
    assert.deepEqual([e.path, e.rule], ["/repository/indexDir", "path-invalid"]);
  });

  it("refuses credentials or a foreign scheme in $schema, accepts a relative path", () => {
    const credentials = only(errorsOf(validateVariant((c) => (c["$schema"] = "https://admin:pw@example.org/s.json"))));
    assert.deepEqual([credentials.path, credentials.rule], ["/$schema", "url-credentials"]);
    const scheme = only(errorsOf(validateVariant((c) => (c["$schema"] = "postgresql://admin:pw@db/app"))));
    assert.deepEqual([scheme.path, scheme.rule], ["/$schema", "url-scheme"]);
    assert.equal(validateVariant((c) => (c["$schema"] = "https://example.org/oqas.schema.json")).ok, true);
  });

  it("names a missing variant tag once", () => {
    const e = only(errorsOf(validateVariant((c) => delete at(c, "autonomy")["level"])));
    assert.deepEqual([e.path, e.rule, e.message], ["/autonomy/level", "required", 'Missing required key "level".']);
  });

  it("reports an unsupported enumerated value as an unknown variant", () => {
    const e = only(errorsOf(validateVariant((c) => (at(c, "applications/0")["type"] = "desktop"))));
    assert.deepEqual([e.path, e.rule], ["/applications/0/type", "unknown-variant"]);
  });

  it("names empty values and values below the minimum", () => {
    const errors = errorsOf(
      validateVariant((c) => {
        at(c, "applications/0")["name"] = "";
        c["autonomy"] = { level: "custom", task: { maxIterations: 0, maxDurationMinutes: 1, maxActions: 1 }, batch: { maxTests: 1, maxIdleRounds: 1 }, guardrailMinutes: 1 };
      }),
    );
    assert.deepEqual(errors.map((e) => [e.path, e.rule]), [
      ["/applications/0/name", "empty-value"],
      ["/autonomy/task/maxIterations", "below-minimum"],
    ]);
  });

  it("keeps its defaults frozen, whatever a caller does", () => {
    assert.ok(Object.isFrozen(DEFAULT_REPOSITORY));
    assert.throws(() => Object.assign(DEFAULT_REPOSITORY, { stateDir: "../elsewhere" }), TypeError);
  });
});

describe("source code — a folder of the workstation, possibly outside the test repository", () => {
  const code = (fields: JsonObject) => (c: JsonObject) =>
    listAt(c, "knowledge").push({ id: "policy-code", type: "source-code", attachments: [{ application: "policy-management" }], ...fields });

  it("accepts a folder inside or outside the repository, with any command level", () => {
    for (const fields of [{ path: "app" }, { path: "../policy-management" }, { path: "../../x", commands: "none" }, { path: "x", commands: "git" }, { path: "x", commands: "shell" }]) {
      assert.equal(validateVariant(code(fields)).ok, true, JSON.stringify(fields));
    }
  });

  for (const [fields, path, rule] of [
    [{ path: "/srv/code" }, "/knowledge/8/path", "path-absolute"],
    [{ path: "a\u0007b" }, "/knowledge/8/path", "path-invalid"],
  ] as const) {
    it(`refuses the path ${JSON.stringify(fields.path)}`, () => {
      const e = only(errorsOf(validateVariant(code(fields))));
      assert.deepEqual([e.path, e.rule], [path, rule]);
    });
  }

  it("refuses an unknown command level, and a folder without path", () => {
    assert.equal(validateVariant(code({ path: "x", commands: "root" })).ok, false);
    assert.equal(validateVariant(code({})).ok, false);
  });
});
