import assert from "node:assert/strict";
import type { ProblemCode } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { problemCode, problemText } from "../../src/api/problem-text.ts";

/** Every code of a problem the console has a wording for. */
const WORDED: readonly ProblemCode[] = [
  "unknown_session",
  "invalid_request",
  "session_running",
  "unavailable",
  "not_opened",
  "opening_timed_out",
  "session_ended",
];

describe("the code of a problem", () => {
  it("is kept when the console knows it", () => {
    assert.deepEqual(WORDED.map(problemCode), WORDED);
    assert.equal(problemCode("error"), "error");
  });

  it("is an error when the answer has none, one that is no text, or one the console does not know", () => {
    assert.deepEqual(
      [undefined, null, 404, {}, "", "quota_exceeded", "toString"].map(problemCode),
      Array.from({ length: 7 }, () => "error"),
    );
  });
});

describe("the wording of a problem", () => {
  it("is a French sentence of the console for each code it knows, whatever the API says of it", () => {
    const wordings = WORDED.map((code) => problemText(code, "The API says it in its own words."));
    assert.deepEqual(wordings, [
      "Le projet ne garde aucune session de ce nom.",
      "La demande n’est pas valide : dites aux agents quoi tester.",
      "Une session est déjà en cours : attendez qu’elle se termine pour en ouvrir une autre.",
      "Aucune source de sessions n’est configurée sur cette instance.",
      "La session n’a pas pu être ouverte.",
      "L’ouverture de la session a pris trop de temps : réessayez dans un instant.",
      "La session vient de se terminer : elle ne prend plus ni message ni arrêt.",
    ]);
    assert.equal(problemText("unavailable", undefined), wordings[3]);
  });

  it("is what the API says of any other problem, when it says something", () => {
    assert.equal(problemText("error", "The folder of the sessions cannot be read."), "The folder of the sessions cannot be read.");
  });

  it("says no more than that the instance failed when the API says nothing to show", () => {
    assert.deepEqual(
      [undefined, null, "", 42, {}].map((detail) => problemText("error", detail)),
      Array.from({ length: 5 }, () => "L’instance a rencontré une erreur."),
    );
  });
});
