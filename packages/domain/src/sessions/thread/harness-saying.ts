/**
 * What the harness says, by its form: a note it journals, what a refusal opens on, or the reason it gives a
 * verdict. A presentation words each code in its language, with the values the text named.
 */
export type SayingCode =
  | "configurationValid"
  | "prerequisitesSucceeded"
  | "cartographySucceeded"
  | "designSucceeded"
  | "executionSucceeded"
  | "summaryWritten"
  | "cardKept"
  | "domainFileKept"
  | "indexKept"
  | "scenarioOpened"
  | "testWritten"
  | "testPassed"
  | "testFailed"
  | "callsBeyondSheet"
  | "callBeyondSheet"
  | "planWritten"
  | "designWritten"
  | "designWrittenNothing"
  | "testsCommitted"
  | "planAcceptedEmpty"
  | "planAccepted"
  | "noTestEmptyPlan"
  | "noTestCovered"
  | "planFull"
  | "planNoRoom"
  | "roundEnded"
  | "roundEndedBounded"
  | "visualEnded"
  | "visualEndedBounded"
  | "briefCovered"
  | "onlyDuplicates"
  | "briefUnfeasible"
  | "askedConfirmation"
  | "setAsideByHarness"
  | "setAsideByReviewer"
  | "answerLeftOut"
  | "coherenceFault"
  | "codeFault"
  | "sharedLocator"
  | "allTestsRun"
  | "testsRun"
  | "verdictPassed"
  | "verdictFailed"
  | "everyAttemptPassed"
  | "planRefused"
  | "planRefusedByHarness"
  | "planUncovered"
  | "noTestWritten";

/** What the harness said, as a code and the values its text named, such as a source or a scenario. */
export interface Saying {
  readonly code: SayingCode;
  readonly values: Readonly<Record<string, string>>;
}

/** An identifier, a file or a branch: no space in it. */
const ID = String.raw`\S+`;

/** Each form the harness writes in, and its code; the values are the named groups of the form. */
const FORMS: readonly (readonly [SayingCode, RegExp])[] = [
  ["configurationValid", new RegExp(`^The configuration is valid; the run targets the environment (?<environment>${ID})\\.$`)],
  ["prerequisitesSucceeded", /^The prerequisites succeeded\.$/],
  ["cartographySucceeded", /^The cartography succeeded\.$/],
  ["designSucceeded", /^The design succeeded\.$/],
  ["executionSucceeded", /^The execution succeeded\.$/],
  ["summaryWritten", /^The summary of the run was written\.$/],
  ["cardKept", new RegExp(`^The card of (?<source>${ID}) is up to date; it was kept\\.$`)],
  ["domainFileKept", new RegExp(`^The file of the domain (?<domain>${ID}) is up to date; it was kept\\.$`)],
  // The index is named by where it lies on the machine that ran: a path its reader has no use for.
  ["indexKept", /^The index .+ is complete and made of the cards every source has now, by their fingerprints; it was kept\.$/],
  ["scenarioOpened", new RegExp(`^The scenario (?<scenario>${ID}) was opened; its test is (?<test>${ID})\\.$`)],
  ["testWritten", new RegExp(`^The test (?<test>${ID}) was written\\.$`)],
  ["testPassed", new RegExp(`^The test (?<test>${ID}) was run: passed\\.$`)],
  ["testFailed", new RegExp(`^The test (?<test>${ID}) was run: failed\\.$`)],
  ["callsBeyondSheet", new RegExp(`^Scenario (?<scenario>${ID}): (?<count>\\d+) calls beyond its sheet\\.$`)],
  ["callBeyondSheet", new RegExp(`^\\[SHEET-BEYOND\\] Scenario (?<scenario>${ID}), after failed run (?<run>\\d+): (?<tool>${ID})\\.$`)],
  ["planWritten", new RegExp(`^The plan was written to (?<file>${ID})\\.$`)],
  ["designWritten", new RegExp(`^The design state was written to (?<file>${ID})\\.$`)],
  [
    "designWrittenNothing",
    new RegExp(`^The design state was written to (?<file>${ID}), and its plan to (?<plan>${ID}); no new test was written, and nothing was committed\\.$`),
  ],
  ["testsCommitted", new RegExp(`^The tests were committed on (?<branch>${ID}); the active branch of the test repository is (?<active>${ID})\\.$`)],
  ["planAcceptedEmpty", /^The plan was accepted: no scenario\.$/],
  ["planAccepted", /^The plan was accepted: (?<scenarios>.+)\.$/],
  ["noTestEmptyPlan", /^No test was written: the plan holds no scenario, and says what the brief asks that no test can do\.$/],
  ["noTestCovered", /^No test was written: the plan holds no scenario, the tests already written covering the brief\.$/],
  ["planFull", /^The harness asked for no more scenarios: the plan holds as many scenarios as it may\.$/],
  ["planNoRoom", new RegExp(`^The plan is full at (?<count>\\d+), and had no room for: (?<scenarios>.+)\\.$`)],
  // The end of each round of a batch, and of the design of its visual tests, with the tests of the batch.
  ["roundEnded", /^Round (?<round>\d+): (?<fresh>\d+) new, (?<total>\d+) in the batch\.$/],
  ["roundEndedBounded", /^Round (?<round>\d+): (?<fresh>\d+) new, (?<total>\d+) of (?<max>\d+) in the batch\.$/],
  ["visualEnded", /^Visual tests: (?<fresh>\d+) new, (?<total>\d+) in the batch\.$/],
  ["visualEndedBounded", /^Visual tests: (?<fresh>\d+) new, (?<total>\d+) of (?<max>\d+) in the batch\.$/],
  ["briefCovered", /^The harness asked for no more scenarios: the agent said the brief is covered\.$/],
  ["onlyDuplicates", /^The harness asked for no more scenarios: the scenarios last submitted were duplicates, and the agent has nothing new to verify\.$/],
  ["briefUnfeasible", /^The harness asked for no more scenarios: the agent said no test can do what the brief asks\.$/],
  [
    "askedConfirmation",
    new RegExp(`^The harness asked the agent to confirm that the test of (?<scenario>${ID}) fails because of the application, with runs left\\.$`),
  ],
  [
    "setAsideByHarness",
    new RegExp(`^The scenario (?<scenario>${ID}) was set aside as a duplicate of (?<of>${ID}), by the harness \\((?<rule>[A-Z-]+)\\): (?<reason>[^]+)$`),
  ],
  ["setAsideByReviewer", new RegExp(`^The scenario (?<scenario>${ID}) was set aside as a duplicate of (?<of>${ID}), by the plan reviewer: (?<reason>[^]+)$`)],
  ["answerLeftOut", new RegExp(`^The harness left out an answer of the plan reviewer: (?<scenario>${ID}) as a duplicate of (?<of>${ID})\\.$`)],
  ["coherenceFault", new RegExp(`^The coherence reviewer found fault with the test of (?<scenario>${ID}): (?<remark>[^]+)$`)],
  ["codeFault", new RegExp(`^The code reviewer found fault with the test of (?<scenario>${ID}): (?<remark>[^]+)$`)],
  ["sharedLocator", /^The harness warned the agent \(\d+\) that (?<count>\d+) elements share .+, which shows (?<shown>.+)\.$/],
  ["allTestsRun", /^(?<run>\d+) of the (?<designed>\d+) tests designed are run; left out as unfinished, duplicate or unfeasible: none\.$/],
  ["testsRun", /^(?<run>\d+) of the (?<designed>\d+) tests designed are run; left out as unfinished, duplicate or unfeasible: (?<left>.+)\.$/],
  // A verdict line names the test by its project, its file and its title: the title alone is what a person reads.
  ["verdictPassed", /^passed: .+ › (?<title>[^›]+)\.$/],
  ["verdictFailed", /^failed: .+ › (?<title>[^›]+)\.$/],
  ["everyAttemptPassed", /^Every attempt passed\.$/],
  ["planRefusedByHarness", /^The plan was refused by the harness$/],
  ["planRefused", /^The plan was refused$/],
  ["planUncovered", /^The plan does not cover what the brief asks$/],
  ["noTestWritten", /^No test was written$/],
];

/**
 * Reads what the harness said by the form it writes it in. A session keeps the text of the harness as it was
 * written, in English, whatever the language of its reader: this reading lets a presentation word it again, in its
 * own words, from a code and the values the text named.
 *
 * @param text - A note of the harness, what one of its refusals opens on, or the reason of a verdict, whole.
 * @returns Its code and values; `undefined` for a text of no known form, which is shown as it is.
 */
export function sayingOf(text: string): Saying | undefined {
  for (const [code, form] of FORMS) {
    const said = form.exec(text);
    if (said === null) continue;
    return { code, values: { ...said.groups } };
  }
  return undefined;
}
