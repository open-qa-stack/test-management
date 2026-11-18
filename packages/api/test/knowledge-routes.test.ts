import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvalidDocumentsError, UnknownDocumentError, UnknownDocumentSourceError, type ConfigError } from "@open-qa-stack/domain";
import { expectedProblem } from "../src/problems/expected-problem.ts";
import { problemOf } from "../src/problems/problem-kinds.ts";

describe("a problem of the documents", () => {
  it("is read from each refusal of the operations, with what to do", () => {
    assert.deepEqual(
      expectedProblem(new UnknownDocumentSourceError("manuals")),
      problemOf(
        "unknown_document_source",
        'The configuration in force declares no knowledge source manuals whose documents the instance keeps. Declare it in the configuration, of type document with "stored": true, and save it first.',
      ),
    );
    assert.deepEqual(
      expectedProblem(new UnknownDocumentError("manuals", "quotes.md")),
      problemOf("unknown_document", "The knowledge source manuals holds no document quotes.md."),
    );
    const errors: ConfigError[] = [{ kind: "structure", path: "/documents/0", rule: "document-format", message: "Only Markdown documents are read." }];
    assert.deepEqual(expectedProblem(new InvalidDocumentsError(errors)), {
      ...problemOf(
        "invalid_documents",
        "The documents are refused, and none is kept: 1 error was found. Each error is in errors, at the document it is about, in the order of the upload.",
      ),
      errors,
    });
  });
});
