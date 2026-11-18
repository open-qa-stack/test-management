import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigurationConflictError, InvalidConfigurationError, NoConfigurationError, StaleRevisionError, type ConfigError } from "@open-qa-stack/domain";
import { expectedProblem } from "../src/problems/expected-problem.ts";
import { problemOf } from "../src/problems/problem-kinds.ts";
import { ConfigurationBodyPipe } from "../src/repository-configuration/configuration-body.pipe.ts";
import { RevisionRequestPipe } from "../src/repository-configuration/revision-request.pipe.ts";
import { SessionError } from "../src/sessions/session-error.ts";

/** The refusal of a request the routes cannot read, with what it says. */
const invalid = (message: string) => (error: unknown) => error instanceof SessionError && error.failure === "invalid_request" && error.message === message;

describe("the body of a change of the configuration", () => {
  const pipe = new RevisionRequestPipe();

  it("is read with the revision it was made from, its document, and whether it rewrites a file that changed, false when left out", () => {
    assert.deepEqual(pipe.transform({ basedOn: 0, document: { formatVersion: 1 } }), { basedOn: 0, document: { formatVersion: 1 }, replaceFile: false });
    assert.deepEqual(pipe.transform({ basedOn: 3, document: {}, replaceFile: true }), { basedOn: 3, document: {}, replaceFile: true });
  });

  it("is refused when it names a field of its own, a revision that is no whole number from 0, a document that is no object, or a replacement that is no boolean", () => {
    const revision = "basedOn must be the number of the revision the change was made from: a whole number, 0 when there was none.";
    for (const [body, message] of [
      [[], "The body must be a JSON object."],
      [{ basedOn: 1, document: {}, force: true }, "force is not a field of a change of the configuration."],
      [{ document: {} }, revision],
      [{ basedOn: "1", document: {} }, revision],
      [{ basedOn: 1.5, document: {} }, revision],
      [{ basedOn: -1, document: {} }, revision],
      [{ basedOn: 1, document: [] }, "document must be the configuration, a JSON object."],
      [{ basedOn: 1, document: {}, replaceFile: "yes" }, "replaceFile must be true or false when it is given."],
    ] as const)
      assert.throws(() => pipe.transform(body), invalid(message));
  });
});

describe("the body of a validation of the configuration", () => {
  it("is the configuration, as a JSON object", () => {
    const pipe = new ConfigurationBodyPipe();
    assert.deepEqual(pipe.transform({ formatVersion: 1 }), { formatVersion: 1 });
    for (const body of [[], "{}", null]) assert.throws(() => pipe.transform(body), invalid("The body must be the configuration, a JSON object."));
  });
});

describe("a problem of the configuration", () => {
  it("is read from each refusal of the operations, with the ways out it leaves", () => {
    assert.deepEqual(
      expectedProblem(new StaleRevisionError(2, 3)),
      problemOf(
        "stale_revision",
        "The change was made from the revision 2 of the configuration, and the revision in force is 3. Read the configuration again, and make the change from the revision in force.",
      ),
    );
    assert.deepEqual(
      expectedProblem(new ConfigurationConflictError()),
      problemOf(
        "configuration_conflict",
        'oqas.json changed since the revision in force of the configuration was read from it or written to it, and the change would overwrite it. Keep the file: POST /api/configuration/synchronisation makes it the revision in force. Or keep the change: send it again with "replaceFile": true, which rewrites oqas.json.',
      ),
    );
    const errors: ConfigError[] = [{ kind: "structure", path: "/applications", rule: "too-few-items", message: "Too few items." }];
    assert.deepEqual(expectedProblem(new InvalidConfigurationError("The change", errors)), {
      ...problemOf(
        "invalid_configuration",
        'The change is not a valid configuration: 1 error was found. Each error is in errors, where it is. A file that is not valid is corrected, or replaced by a change sent with "replaceFile": true.',
      ),
      errors,
    });
    assert.deepEqual(
      expectedProblem(new NoConfigurationError("/srv/tests/oqas.json")),
      problemOf(
        "no_configuration",
        "/srv/tests/oqas.json cannot be read, and the instance keeps no revision of the configuration. Write oqas.json at the root of the test repository, or save a configuration made from the revision 0.",
      ),
    );
  });
});
