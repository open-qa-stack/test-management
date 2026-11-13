# Designer

`new Designer(options).run()` writes three or four Playwright tests, from a brief and the [domain index](../../shared/docs/domain-index.md) of the test repository, on a new local branch, after a test plan. It needs the resolved configuration, the path of the test repository, the environment variables the configuration names, an `AgentRuntime`, a `TestRunner` that runs each test against the application (such as the `TrialRunner` of the harness), and the system instructions of the designer, which the caller composes from the test charter:

```ts
const charter = resolveCharter(config.charter);
const instructions = designerInstructions(charter.rules, config.repository);
const outcome = await new Designer({ config, repositoryRoot, env, runtime, instructions, runner, brief: "Test the search of a customer and their profile." }).run();
```

`brief` says what to test in the developer's words: a domain, a ticket, a rule, a journey. Without it, the designer works on the whole index. `planReview`, a `PlanReview` of `@open-qa-stack/domain`, decides whether the test plan may be carried out; by default every plan is accepted as it is.

## A run

1. **Test repository.** The path must be the root of a git repository with a commit. No tracked file may be changed, no untracked file may lie outside the state folder (`repository.stateDir`) and the index folder (`repository.indexDir`), and the branch to create must not exist. Otherwise the journal names each problem, no session starts, and nothing is written. The untracked index the cartographer leaves does not stop the run.
2. **Index.** `<indexDir>/domain-index.json` must match its schema. The request gives the agent the brief and one line per domain of the index, not the index whole: the agent looks it up (see [The index as a map](#the-index-as-a-map)).
3. **Session.** The agent gets the browser tools of the applications of the environment of the index, watched (see [The screens](#the-screens)); the tools of every knowledge source attached to that environment or to none — documents, contracts, bases, source code and logs — the bases read in a read-only transaction, the logs masking the value of every variable the configuration names; and the notes. It explores, then submits a test plan with `propose_plan` (see [The plan](#the-plan)). Once the plan is accepted, it runs each test it writes with `run_test`, against the application, and fixes it until it passes; then it proposes it with `propose_test`, naming its scenario, under the limits of the configured autonomy, every trial counting against them. While no plan is accepted, or fewer than three tests are, an agent that stops is reminded up to three times.
4. **Branch.** Once the session is over, a branch is created from the revision checked out, and stays checked out. The accepted tests and the design state are committed on it with the identity and the hooks of the repository. The message is `test: add <n> generated Playwright tests`, with one line per test, which gives the verdict and the failure of a test that does not pass. Nothing contacts a remote, and no existing branch nor the git configuration is changed.

The branch is `oqas/design-<date>` by default, such as `oqas/design-20261113T100000Z`; `branch` gives another name.

## The index as a map

The index tells where to look, without limiting where the agent may look:

- `index_find` takes words and gives the domains, then the elements of the sources — sections of documents, operations of contracts, tables, folders of code, screens — that echo them, those that echo most words first, at most twelve of each. Words match without regard to case or accents; a word matches another it begins, or that begins it, when the shorter of the two has four letters or more, so that `customer` finds `Customers`. Each element comes with the summary of its card, when the card is readable.
- `index_entry` takes a domain, or a source and one of its elements, and gives each source with its type and the tools of the agent that read it, such as `shop_guide_read_section` for a document, or says that no tool of the agent reads it. A tool belongs to the knowledge source or the application whose identifier its name starts with, the longest one when several do, the index listing it or not.

The tools of a source read the whole source, not only what the index places in it.

## The screens

A test relies on screens the agent saw. The browser tools are those of `@open-qa-stack/tools`, with what the agent needs to see added to their results:

- opening an address returns the snapshot of the page, each element with the locator a test uses for it, without the reference of each element nor the address of each link, which a test has no use for;
- `click`, `fill`, `select_option` and `check` return the lines of the snapshot that appeared after the action.

For a test of an application with a user interface:

| Refusal | Cause |
|---|---|
| `You have not looked at the screens of <application> yet…` | No snapshot of the application was taken. |
| `You have not done the steps of the scenario yourself yet…` | The scenario is `functional`, and the agent did no action in the browser. |
| `No screen you looked at showed <locators>…` | The test uses a locator by role, text, label, placeholder, test id, title or alternative text that no snapshot showed: the role at the start of a line, and the name or the text in a line, the same or another — the name of a row is that of its cells — whatever the case. A name or a text given as a regular expression or a variable is not checked. |
| `What verifies names was already on the page before the action…` | In a `functional` scenario, every text the assertion of `verifies` names was on the page before any action since it was opened, and none appeared after one. An assertion that names no text, such as a count, is not concerned. |

An application without a user interface is held to none of this.

## The plan

No test is run or proposed before a plan is accepted: `run_test` and `propose_test` are refused, with a message that asks for the plan. `propose_plan` takes three or four scenarios; each test carries out one of them. A scenario has a slug of its own (`id`), a `title`, its `intent`, its `kind` — `functional`, `visual`, `accessibility` or `other` — the `expected` result, and the `sources` it relies on, each a source and, when one is named, an element of it. A source is a knowledge source of the environment or an application, whether the index lists it or not. A plan whose slugs repeat, or that holds the value of a variable the configuration names, is refused, and the agent may submit another: the plan is written to the design state. The brief is written there as it was given.

A plan that keeps these rules goes to `planReview`, one plan at a time. Accepted, it is kept in the design state, and no other may be submitted. Refused, the journal gives the reason, every later call of the agent, whatever its tool, is refused, the agent is not reminded, and the design fails without writing any test or creating any branch.

## Writing rules

A test may create, change or delete data of the application in a test environment, as long as it relies on no data written before it.

A proposal names one application of the environment, a domain of the index, a scenario of the accepted plan, the `expect` assertion of the test that verifies the expected result of that scenario, copied as written in the test (`verifies`), a file name in lower-case words separated by hyphens and ending with `.spec.ts`, the reason for the test in one sentence, and the text of the file. The file is placed in `<appsDir>/<application>/`; nothing is written in the blocks nor the journeys folders.

A proposal is refused, the journal says why, and the agent is told so that it can fix the test and propose it again, when:

| Refusal | Cause |
|---|---|
| `No test plan is accepted yet…` | The plan was not submitted, or not accepted. |
| `<scenario> is no scenario of the accepted plan` | The scenario named is not in the plan. |
| `verifies must copy, as written in the test, the expect assertion…` | `verifies` is not an `expect` assertion found in the text of the test, whatever its spaces and the quotes it is written with; it is checked once the text of the test keeps the other rules. |
| `In a functional scenario, the assertion of verifies checks what an action produced…` | In a scenario of kind `functional`, no navigation, input or request (`goto`, `click`, `fill`, `press`, `selectOption`, `check`, a `get` or `post` of a request…) comes before the assertion of `verifies`, or the same check is made elsewhere in the test. That a field shows verifies no behaviour. |
| `… is already taken` | A test of the design, or a file of the repository, already has this path. |
| `The test does not parse as TypeScript: line L, column C: …` | The first syntax error of the file. |
| `Line N imports <module>; import only <packages> or a relative path…` | The file imports a package the `package.json` of the test repository does not declare, a platform package included. The team chooses the tools its tests may use, such as `@axe-core/playwright` for accessibility, by declaring them; without any declared, only `@playwright/test`. |
| `Line N imports a module whose name is computed` | An `import(…)` or `require(…)` of anything but a string. |
| `Line N imports <path>, outside the test repository.` | A relative path that leaves the repository. |
| `Line N imports <path>, another test file` | A relative path to a `.spec` or `.test` file: a test never imports another. |
| `The test holds <address>, an address of the configuration` | A user interface, an API or a contract URL the configuration declares, written in full or by its host. Tests reach an application by paths relative to the base URL that the Playwright configuration gives. |
| `The proposal holds the value of <VARIABLE>` | The value of a variable the configuration names — a test account, a connection string, the key of the model — in the reason or the text of the test. A test that signs in reads its account with `process.env`. |
| A finding of the check | The `check` option, a `TestCheck` such as the `CharterCheck` of the harness, is run on a test the rules above accept; each finding refuses the test, and goes back to the agent with its line, its column and the rule of the charter or the code of the compiler. |

## Running each test

No test is kept unless it ran. The `runner` option, a `TestRunner` such as the `TrialRunner` of the harness, runs a test file with the real runner against the application.

- `run_test` names the scenario the test carries out, checks the file against the rules above, then runs it, and tells the agent the verdict of each of its tests and, for one that did not pass, its whole error, the `test.step` that failed, the path of its trace, and the instant from which the logs of the services tell what happened. A file the rules refuse is not run.
- `propose_test` runs the file too, unless that very text was already tried. The test is kept when each of its tests passed. When it failed, it is refused with what the run gave, unless the agent ran that very text with `run_test` and says, in `failure`, why the application rather than the test is at fault: it is then kept with the harness's verdict `failed` and that explanation, never as passed. A test that did not run to a verdict (`not_run`, `skipped`, `blocked`) is always refused.
- A test writes no file: `saveAs`, `storageState`, `pdf` and any `path` option are refused. What the runner keeps goes to its own folder.
- A visual test compares a page with its reference, with `toHaveScreenshot`. Its references are made at its first trial, and it runs again against them; they are committed with the test, listed in the design state, for review.

Every value of the variables the configuration names is masked in the journal and in what the agent is told. Once four tests are accepted, any further proposal is set aside, and the journal names it.

## Design state

The state is written to `<stateDir>/designs/design-<date>.json`, and committed with the tests unless git ignores it. It holds the brief, when one was given, and the plan accepted:

```json
{
  "formatVersion": 1,
  "producedAt": "2026-11-13T10:00:00.000Z",
  "environment": "local",
  "brief": "Test the search of a customer and their profile.",
  "plan": {
    "scenarios": [
      { "id": "search-customer", "title": "Search a customer by name", "intent": "Verifies that a search by the start of a last name finds the customer.", "kind": "functional", "expected": "The list shows the customer, with their city.", "sources": [{ "source": "policy-management-specs", "item": "5. Use cases" }] }
    ]
  },
  "branch": "oqas/design-20261113T100000Z",
  "base": "<commit the branch was created from>",
  "model": { "provider": "openai", "baseUrl": "http://localhost:1234/v1", "model": "<model>" },
  "run": { "iterations": 6, "actions": 3, "durationMs": 81234 },
  "tests": [
    { "path": "apps/policy-management/list-policies.spec.ts", "application": "policy-management", "domain": "policies", "scenario": "list-policies", "verifies": "await expect(rows).toHaveCount(2);", "reason": "Checks that the policies of a customer are listed.", "verdict": "passed" },
    { "path": "apps/policy-management/quote-total.spec.ts", "application": "policy-management", "domain": "quote-requests", "scenario": "quote-total", "verifies": "await expect(total).toHaveText('1 250 CHF');", "reason": "Checks the total of a quote.", "verdict": "failed", "failure": "The total stays empty although the quote has two lines." },
    { "path": "apps/policy-management/policies-look.spec.ts", "application": "policy-management", "domain": "policies", "scenario": "policies-look", "verifies": "await expect(page).toHaveScreenshot();", "reason": "Checks that the list of policies looks as it should.", "verdict": "passed", "references": ["apps/policy-management/policies-look.spec.ts-snapshots/policies-look-1-policy-management.png"] }
  ]
}
```

## Outcome

The session is traced in `<stateDir>/traces/design-<environment>-<date>.jsonl`, in the format of the [trace of a cartography](./cartographer.md), with one phase, `design`: the request and each reminder, every reasoning, text and tool call of the agent with its result, each entry of the journal, and how the design ended — `done`, `truncated` when a limit cut a design that gave its tests, `failed` otherwise. Each line is handed to `observe` as it is written. A design stopped before its session writes no trace.

`run()` returns `ok`, true when at least three tests were written; the path of the trace, when a session started; the branch and the path of the state, when tests were written; the tests; and the journal, as `{ level, message }` entries.

- With one or two tests, they are written and committed all the same, and the journal gives their number.
- With none, nothing is written and no branch is created.
- When the plan is refused, nothing is written and no branch is created; the journal gives the reason.
- When a limit of the autonomy stops the task, the journal names the limit. The tests accepted before it are written; the proposal under way is not.

The designer neither runs the tests nor judges them.
