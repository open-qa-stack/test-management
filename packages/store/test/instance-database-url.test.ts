import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "vitest";
import { DatabaseUrl } from "../src/database/database-url.ts";
import { DATABASE_URL_VARIABLE, instanceDatabaseUrl } from "../src/instance/instance-database-url.ts";
import { PendingMigrationsError } from "../src/instance/pending-migrations-error.ts";

let repository: string;
beforeEach(() => {
  repository = mkdtempSync(join(tmpdir(), "oqas-instance-url-"));
});
afterEach(() => rmSync(repository, { recursive: true, force: true }));

describe("the database of an instance", () => {
  it("is the one whose URL the instance was given, whatever its test repository", () => {
    const given = DatabaseUrl.parse("postgres://oqas@127.0.0.1:5432/oqas") as DatabaseUrl;
    assert.equal(instanceDatabaseUrl(given, repository), given);
    assert.equal(instanceDatabaseUrl(given, undefined), given);
  });

  it("is, without a URL, a SQLite file in the state folder of the test repository: the default one, or the one its configuration names", () => {
    writeFileSync(join(repository, "oqas.json"), "{}");
    assert.equal(instanceDatabaseUrl(undefined, repository).file, join(repository, ".oqas", "oqas.db"));
    writeFileSync(join(repository, "oqas.json"), JSON.stringify({ repository: { stateDir: "state/oqas" } }));
    assert.equal(instanceDatabaseUrl(undefined, repository).file, join(repository, "state", "oqas", "oqas.db"));
  });

  it("cannot be told without a URL when the test repository holds no configuration file", () => {
    assert.throws(() => instanceDatabaseUrl(undefined, repository), { code: "ENOENT" });
  });

  it("is named to every process by the same environment variable", () => {
    assert.equal(DATABASE_URL_VARIABLE, "OQAS_DATABASE_URL");
  });
});

describe("migrations a server has not applied", () => {
  it("are counted in the refusal, which says what to do", () => {
    const one = new PendingMigrationsError(1);
    assert.deepEqual([one.name, one.pending], ["PendingMigrationsError", 1]);
    assert.equal(one.message, "The database schema is not up to date: 1 migration is pending. Apply them with the migration command, then start again.");
    assert.match(new PendingMigrationsError(2).message, /^The database schema is not up to date: 2 migrations are pending\. /);
  });
});
