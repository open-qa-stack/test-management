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
2. **Index.** `<indexDir>/domain-index.json` must match its schema. The request gives the agent the brief and what the index holds for it, as `index_find` would give it for the words of the brief; without a brief, or when nothing echoes it, one line per domain of the index. The index is never given whole: the agent looks it up (see [The index as a map](#the-index-as-a-map)). Then come the applications, each with how a test signs in — with its `fill` tool and the account named, whose result gives the line a test writes, or, without a user interface, the variables a test reads — the packages a test may import, and the next call. The rules of a test are not repeated in it: each is a gate of the harness, told when it refuses, or a line of the system instructions.
3. **Session.** The agent gets the browser tools of the applications of the environment of the index, watched (see [The screens](#the-screens)); the tools of every knowledge source attached to that environment or to none — documents, contracts, bases, source code and logs — the bases read in a read-only transaction, the logs masking the value of every variable the configuration names; and the notes. It explores, then submits a test plan with `propose_plan` (see [The plan](#the-plan)). Once the plan is accepted, the harness opens its scenarios one at a time, in the order of the plan (see [Writing each test](#writing-each-test)): the agent runs the test of the scenario open with `run_test`, against the application, fixes it, and closes the scenario with `propose_test`, under the limits of the configured autonomy, every run counting against them. While no plan is accepted, or a scenario is open, an agent that stops is reminded up to three times, with where the design stands — `No plan is accepted yet.`, `The plan was last refused for: <codes>.`, or the scenario open, such as `Scenario 1 of 3, list-orders: its last run failed (1 of 3).`, its test having otherwise `not run` or `passed and is not closed` — and the next call. The search of each base says in its description that a value of the data of a plan comes from a result such as its own.
4. **Branch.** Once the session is over, a branch is created from the revision checked out, and stays checked out. The kept tests and the design state are committed on it with the identity and the hooks of the repository. The message is `test: add <n> generated Playwright tests`, with one line per test: its path and the title of its scenario, or, for a test kept failing, `- <path>: failing (<cause>) at step <n>`, the number of the step its last run failed at. Nothing contacts a remote, and no existing branch nor the git configuration is changed.

The branch is `oqas/design-<date>` by default, such as `oqas/design-20261113T100000Z`; `branch` gives another name.

## The index as a map

The index tells where to look, without limiting where the agent may look:

- `index_find` takes words and gives the domains, then the elements of the sources — sections of documents, operations of contracts, tables, folders of code, screens — that echo them, those that echo most words first, at most twelve of each. An element echoes by its name, the summary of its card and its key fields. Words match without regard to case or accents; a word matches another it begins, or that begins it, when the shorter of the two has four letters or more, so that `customer` finds `Customers`. Each element comes with the summary of its card, when the card is readable, and ends with what it is: `(table)`, `(screen)`, `(section)`, `(operations)` or `(folder)`.
- `index_entry` takes a domain, or a source and one of its elements, and gives each source with its type and the tools of the agent that read it, such as `shop_guide_read_section` for a document, or says that no tool of the agent reads it. A tool belongs to the knowledge source or the application whose identifier its name starts with, the longest one when several do, the index listing it or not. An element comes with what its card holds: its key fields, then each fact the harness read, such as the keys of a table, the operations of a tag, the files and routes of a folder or the title and links of a screen. For a table whose base the agent can search, it ends with the call that finds a row, such as `Find a row: shop_db_search({ "schema": "public", "table": "orders", "value": "<text>" })`. An answer holds sixty lines at most, the last one saying how many were left out.

The tools of a source read the whole source, not only what the index places in it.

## The screens

A test relies on screens the agent saw. The browser tools are those of `@open-qa-stack/tools`, with what the agent needs to see added to their results:

- opening an address returns the snapshot of the page, each element with the locator a test uses for it, without the reference of each element nor the address of each link, which a test has no use for;
- `click`, `fill`, `select_option` and `check` return the lines of the snapshot that appeared after the action (`appeared`), sixty at most, and those that went (`gone`), twenty at most; a snapshot of a part of the page, taken with `within`, is not what the next action is compared with;
- each of these tools returns in `code` the line a test writes to do the same, as the [browser tools](../../tools/docs/browser-tools.md) give it;
- the descriptions of `goto` and of the actions say what they return: what the page shows, or what appeared and what went, and the line of code.

An application without a user interface has no browser tools, and none of what follows that reads the screens applies to it.

## The sources

A plan relies on what the agent read. The tools of the knowledge sources return what they always do; the harness keeps, for each source, every text and number of what its tools returned, each value of the variables the configuration names masked first, up to 200,000 characters, the oldest going first. A call whose result is an error reads nothing. A call of a tool of a source of logs or of source code counts as a look at what a failed run did, and so does a call of a tool of any source for an application without a user interface (see `TEST-LOOK`).

## Refusals

Every refusal of `propose_plan`, `run_test` and `propose_test` gives each reason on a line of its own, which starts with `Refused (<code>):`, then ends with `Nothing else was refused.`: the agent fixes all of them at once. The journal gives each reason with its code first, such as `[PLAN-ID] The plan was refused by the harness: …`, so that a trial is scored by counting codes.

The harness counts, for the plan and for each scenario, how many calls each code refused; the count of a scenario starts again when its test runs. From the third refusal of one code, the agent is told only what that gate would accept, after `Third refusal for the same reason. Do this:` (then `Fourth`, `Fifth`): the skeleton of the scenario for `TEST-ONE` and `TEST-STEPS`; for `TEST-VALUE` and `TEST-POLARITY`, every assertion of each step refused, not only of the texts it misses, so that a model does not drop the others, written as the skeleton writes it (see [Writing each test](#writing-each-test)), such as `Step 2 must hold all of these, with its actions:` then `await expect(page.getByRole("row", { name: "ORD-1042 Mira Veldane" })).toBeVisible();`; for `TEST-LOCATOR`, the closest elements the screens showed; for `PLAN-DATA`, the tool that reads the source and the last five texts it returned; for any other code, its first refusal alone. The fifth refusal of one code closes the scenario, and the journal records it as an error. When a run of its test gave a verdict, the text of the last such run is kept as it ended: passed, or failing with the cause `test` and the evidence `closed by the harness after 5 refusals for <code>`, the state giving the code in `closedBy`; the agent is told `Scenario <id> was closed by the harness after 5 refusals for <code>, with the test of its last run: <outcome>. Go on with the next scenario.` Otherwise the scenario has no test: the agent is told `Scenario <id> was closed by the harness after 5 refusals for <code>. Go on with the next scenario.`, and the design state lists it in `unwritten`. Either way the sheet of the next scenario follows. The sixth plan the gates refuse stops the design, as a plan the review refuses does.

A text is observed in what the tools returned when, its spaces collapsed and its case aside, it is part of one of their texts; a text shorter than three characters is not checked.

## The plan

No test is run before a plan is accepted: `run_test` and `propose_test` are refused with `PLAN-NONE`. `propose_plan` takes three or four scenarios; each test carries out one of them. A scenario has:

- a slug of its own (`id`), which names the file of its test, a `title` and its `intent`;
- its `kind` — `functional`, `visual`, `accessibility` or `other` — and its `case`: `negative` when the input matches nothing, is wrong or is forbidden, `nominal` otherwise;
- the one `application` it is about, and the `domain` of the index it comes from;
- the `sources` it relies on, each a source and, when one is named, an element of it; a source is a knowledge source of the environment or an application, whether the index lists it or not;
- its `data`: each value its test enters, with the source or the application whose tool showed it, or `made-up` for a value it invents;
- its `steps`, one to eight, each an `action` of the user and zero to four `expects`, each a `result` in one sentence with the exact texts the screen then `shows` and those it no longer shows (`absent`).

The harness numbers the steps from 1, and the expects of step `n` from `n.1`. A source without any tool is held to none of the gates that read it, and a text or a value shorter than three characters is not checked. A plan is refused, and the agent may submit another, when:

| Code | Cause |
|---|---|
| `PLAN-ID` | Two scenarios share a slug. |
| `PLAN-SECRET` | The plan holds the value of a variable the configuration names: it is written to the design state. |
| `PLAN-NEGATIVE` | The plan holds two functional scenarios or more, and none of them is negative. |
| `PLAN-EXPECT` | A functional scenario has no expect, or an expect names no text. |
| `PLAN-RESULT` | A functional scenario of an application with a user interface names no text that the agent saw appear on a screen after one of its actions, among those it `shows`, nor go, among those that are `absent`. The line of a field is no result, whether it appeared or went, empty or not: neither the name of the field nor the value typed counts, and the line changes when the field only gains or loses the focus. |
| `PLAN-READ` | A scenario cites a source nothing was read of: no call of one of its tools succeeded, or, for an application with a user interface, no page of it was opened, read or acted on. The refusal names the tool to call. |
| `PLAN-DATA` | A value of the data comes from a source or an application, and was observed in nothing its tools returned, or in no snapshot of the application. |
| `PLAN-MADE-UP` | A value of the data is said `made-up`, and the first line of the screens of an application that held it was no field, or a tool of a knowledge source returned it before a field of a screen held it: the agent read it before it typed it, if it ever did. A source that returns it afterwards, such as a base that holds the row the test saved, read what the test made. The refusal names the source to give instead, such as `{ "value": "Mira Veldane", "from": "shop" }`. |
| `PLAN-SHOWN` | A text a scenario `shows`, or one that is `absent`, was observed on no screen of its application, even a value its test types, which the screen shows once the agent typed it in a field. For an application without a user interface, it was observed in nothing any tool returned, and is no part of a value the scenario invents (`made-up`) for a text it `shows`, nor of a value of its data for one that is `absent`. A test finds a text as the screen gives it, which a base may give otherwise. A text that is `absent` and that the screens of the application showed only in a field is refused too: the field keeps what the agent typed whatever the application answers, and the refusal says to expect gone a text the action removed, such as a row the search filtered out. |
| `PLAN-NOMINAL` | A nominal scenario of an application with a user interface expects `absent` a text that holds a value of its data the agent typed in a field, and that a screen showed beside the fields, while no step before expects the value in `shows`: what it searches for would find nothing. A step before that shows it makes the scenario remove what it made or found. The refusal says to put the text in `shows`, to make the scenario negative, or, when a step removes it, to show it in the step before, and, when the screens found nothing, to try a part of the value, such as a first or a last name. |

The sixth plan the gates refuse stops the design (see [Refusals](#refusals)). A plan that keeps these rules goes to `planReview`, one plan at a time. Accepted, it is frozen and kept in the design state, no other may be submitted, and the agent is told the sheet of the first scenario. Refused, the journal gives the reason, every later call of the agent, whatever its tool, is refused, the agent is not reminded, and the design fails without writing any test or creating any branch. The brief is written to the state as it was given.

## Writing each test

The scenarios are opened one at a time, in the order of the plan; the agent never names one, nor a file. The test of a scenario goes to `<appsDir>/<application>/<id>.spec.ts`, or `<id>-2.spec.ts`, `<id>-3.spec.ts`… when a file of the repository already has that path; nothing is written in the blocks nor the journeys folders.

The sheet of a scenario, which the agent is told when it opens, gives its rank in the plan, its id, title, kind, case and application, its data, its file, then the skeleton of its test, then the next call:

```text
Scenario 1 of 3: search-order-by-customer — Search an order by customer name (functional, nominal), application shop.
Data: "Veldane" (shop-db).
File: apps/shop/search-order-by-customer.spec.ts

import { expect, test } from "@playwright/test";

test("Search an order by customer name", async ({ page }, testInfo) => {
  await test.step("1. Search the orders of Veldane", async () => {
    // Do: Search the orders of Veldane. Copy the code lines the browser tools returned.
    // Expect 1.1: The search lists the order of Mira Veldane only.
    await expect(page.getByRole("textbox", { name: "Search orders", exact: true })).toHaveValue("Veldane");
    await expect(page.getByRole("cell", { name: "ORD-1042", exact: true })).toBeVisible();
    await expect(page.getByText("ORD-1057")).toBeHidden();
    await testInfo.attach("1", { body: await page.screenshot(), contentType: "image/png" });
  });
});

Next: do the steps of search-order-by-customer with the browser tools, fill its skeleton with the code they return, then call run_test.
```

The skeleton parses and keeps the default charter and the gates below as it is: one `test.step` per step of the plan, titled by its number then its action, and an assertion of each text of its expects, on the element the screens showed it in, the last seen first, among the lines an action produced first: the element named by the text, by its locator in the snapshot or by its role and name (`toBeVisible`); else an element whose line holds the text and gives its locator (`toBeVisible` when the locator names the text, `toContainText` otherwise); else the field whose value is the text (`toHaveValue`), a field holding what the agent typed whatever the application answers; else the text anywhere on the page (`getByText`). A text expected gone is looked for first in the lines an action removed, never in a field, and asserted `toBeHidden()`. The agent may find its element better, never change the text. The screenshot of each step is there when the `screenshots` option says so, as the solo command does while the rule `PW-SHOT-01` of the charter is active.

`run_test` takes the whole text of the file, checks it, then runs it against the application. The checks come in tiers; the first tier that refuses gives all its reasons, and a text refused is not run:

| Tier | Code | Cause |
|---|---|---|
| 1 | `PLAN-NONE`, `PLAN-DONE` | No plan is accepted, or every scenario is closed. |
| 1 | `TEST-STOP` | The test of the scenario already failed three runs: it is closed with a diagnosis. |
| 1 | `TEST-SAME` | This very text already ran and did not pass. |
| 1 | `TEST-LOOK` | The last run failed, and since then the agent called no browser tool of the application, nor any tool of a source of logs or of source code; for an application without a user interface, no tool of any source. The refusal names the tools there are to look with; with none, the gate does not apply. |
| 2 | `TEST-SYNTAX` | The text does not parse as TypeScript; the first syntax error, with its line and column. |
| 2 | `TEST-IMPORT` | The file imports a package the `package.json` of the test repository does not declare, a platform package included, a module whose name is computed, a relative path that leaves the repository, or another `.spec` or `.test` file. The team chooses the tools its tests may use, such as `@axe-core/playwright` for accessibility, by declaring them; without any declared, only `@playwright/test`. |
| 2 | `TEST-FILE` | The test writes a file: `saveAs`, `storageState`, `pdf` or any `path` option. What the runner keeps goes to its own folder. |
| 2 | `TEST-ADDRESS` | The test holds a user interface, an API or a contract URL the configuration declares, written in full or by its host. Tests reach an application by paths relative to the base URL that the Playwright configuration gives. |
| 2 | `TEST-SECRET` | The test holds the value of a variable the configuration names; a test that signs in reads its account with `process.env`. |
| 3 | `TEST-ONE` | The file does not hold exactly one `test(…)`. |
| 3 | `TEST-STEPS` | The `test.step` calls that no other step holds are not one per step of the plan, in its order, each titled by its number, a dot and a space, such as `2. Search the orders of Veldane`; the rest of a title is free. |
| 3 | `TEST-VALUE` | A text an expect of step `n` names, in `shows` or `absent`, is observed in no string of an `expect` statement of the step `n` of the test: neither in its subject, the first argument of `expect`, such as the name of a locator, nor in what its matcher is given. The message of an `expect` holds no text, nor does a statement whose subject chains `.or(…)`, which may pass on the other element. |
| 3 | `TEST-POLARITY` | A text the screen `shows` is held only by negative statements — `.not`, `toBeHidden`, `toHaveCount(0)` — or a text it no longer shows only by affirmative ones. |
| 3 | `TEST-TAUT` | A text matcher — `toHaveText`, `toContainText`, `toHaveValue` — expects a text that the locator of its own subject finds the element by: it can only pass. |
| 3 | `TEST-TYPED` | A string given to `fill`, `type`, `pressSequentially` or `selectOption` is neither empty, nor a value of the data of the scenario, nor a part of one of three characters or more. |
| 3 | `TEST-LOCATOR` | The test uses a locator by role, text, label, placeholder, test id, title or alternative text that no snapshot showed: the role at the start of a line, and the name or the text observed in a line, the same or another — the name of a row is that of its cells. A name or a text given as a regular expression or a variable is not checked. The refusal gives the lines of the screens closest to those locators, five at most: the same role, or a shared word. |
| 4 | `TEST-CHECK` | A finding of the `check` option, a `TestCheck` such as the `CharterCheck` of the harness, with its line, its column and the rule of the charter or the code of the compiler, then the example of the rule when it has one: `Line 12, column 9 (rule PW-WAIT-01): Unexpected use of page.waitForTimeout(). Example: …`. |

A text the checks accept is run with the `runner` option, a `TestRunner` such as the `TrialRunner` of the harness. The agent is told the verdict of each of its tests and, for one that did not pass, its error, cut past 1,500 characters, the `test.step` that failed, the path of its trace, and the instant from which the logs of the services tell what happened; then one hint, picked by what the run stopped on, and how many runs of the scenario failed, out of three; then the next call. A run that could not happen, or gave no verdict, counts as failed.

| Class | Read from the error | Hint |
|---|---|---|
| `strict` | `strict mode violation` | Start from the parent the snapshot shows, or use the full name. |
| `navigation` | `net::ERR_`, `page.goto:`, a navigation timeout | Check the path; a test uses a path relative to the base URL. |
| `assertion` | A matcher of `expect(locator)` or `expect(page)` that failed, whether the element was found or not, or another `expect` whose error gives what was expected and received | What the application shows, cut past 200 characters, or `no such element`, and what the plan expects, which stays: check the locator and the wait, or diagnose. |
| `locator` | A timeout waiting for an element, on an action | The element is not on the screen at that step: redo the steps before it with the browser tools. |
| `other` | Anything else | Read it, and look at the page at that step. |

A test writes no file. A visual test compares a page with its reference, with `toHaveScreenshot`; its references are made at its first run, committed with the test, and listed in the design state.

`propose_test` closes the scenario open with the text of its last run that gave a verdict, which is not run again, and opens the next one, whose sheet the agent is told; once all are closed, the agent is told how many passed, how many fail, and how many were closed without a test. The calls of `run_test` and `propose_test` run one after the other, even those of one turn, each seeing the run the previous one recorded. It is refused when:

| Code | Cause |
|---|---|
| `PROPOSE-RUN` | The test of the scenario has not run, or its last run gave no verdict — it could not run, or was `not_run`, `skipped` or `blocked` — and fewer than three of its runs failed. With three, the scenario is closed with its last run that gave a verdict, under the rules below, or without a test when none did, which the journal says. |
| `PROPOSE-DIAG` | The last run failed, and no `diagnosis` is given. |
| `PROPOSE-EARLY` | The cause is `test`, and fewer than three runs failed: the test is repaired first. |
| `PROPOSE-CAUSE` | The cause is `application` or `plan`, and the last run did not fail on an assertion: it stopped before any check of the application. |
| `PROPOSE-SECRET` | The evidence of the diagnosis holds the value of a variable the configuration names. |

Every refusal leaves a way out: a run that fails again counts, a scenario with three failed runs may be closed with the cause `test`, or is closed without a test when none of its runs gave a verdict, and a scenario refused five times for one reason is closed by the harness, its test kept as its last run that gave a verdict ended.

A test whose last run passed is kept as passed, whatever the diagnosis says. One whose last run failed is kept unchanged, as failing, with the `cause` of the diagnosis — `application` when the application does not do what the plan expects, `plan` when an expected text of the plan is wrong, `test` when the test could not be made to work — its `evidence`: what the run showed and what the agent checked, and the step and the class its last run failed on. The verdict is always the harness's. A test kept failing counts towards the three a design expects only when the application is at fault.

Every value of the variables the configuration names is masked in the journal and in what the agent is told.

## Design state

The state is written to `<stateDir>/designs/design-<date>.json`, and committed with the tests unless git ignores it. It holds the brief, when one was given, the plan accepted, each test kept, in the order of the plan, with the scenario it carries out and each of its runs, with its verdict and, for one that failed, its class and its step, a test whose scenario the harness closed after five refusals giving the code refused in `closedBy`, and in `unwritten` each scenario the harness closed without a test, with the code it was closed on: the one that refused it five times, or `TEST-STOP` when none of its runs gave a verdict. The application, the domain and the reason of a test are those of its scenario:

```json
{
  "formatVersion": 2,
  "producedAt": "2026-11-13T10:00:00.000Z",
  "environment": "local",
  "brief": "Test the search of an order by customer.",
  "plan": {
    "scenarios": [
      {
        "id": "search-order-by-customer",
        "title": "Search an order by customer name",
        "intent": "Verifies that a search by last name finds the orders of the customer.",
        "kind": "functional",
        "case": "nominal",
        "application": "shop",
        "domain": "orders",
        "sources": [{ "source": "shop-db", "item": "public.orders" }],
        "data": [{ "value": "Veldane", "from": "shop-db" }],
        "steps": [{ "action": "Search the orders of Veldane", "expects": [{ "result": "The table lists the order of Mira Veldane only", "shows": ["ORD-1042"], "absent": ["ORD-1057"] }] }]
      }
    ]
  },
  "branch": "oqas/design-20261113T100000Z",
  "base": "<commit the branch was created from>",
  "model": { "provider": "openai", "baseUrl": "http://localhost:1234/v1", "model": "<model>" },
  "run": { "iterations": 6, "actions": 3, "durationMs": 81234 },
  "tests": [
    { "path": "apps/shop/search-order-by-customer.spec.ts", "scenario": "search-order-by-customer", "verdict": "passed", "runs": [{ "verdict": "failed", "errorClass": "strict", "failedStep": "1. Search the orders of Veldane" }, { "verdict": "passed" }] },
    {
      "path": "apps/shop/order-total.spec.ts",
      "scenario": "order-total",
      "verdict": "failed",
      "runs": [{ "verdict": "failed", "errorClass": "assertion", "failedStep": "2. Open the order" }],
      "quarantine": { "cause": "application", "evidence": "The total stays empty although the order has two lines.", "failedStep": "2. Open the order", "errorClass": "assertion" }
    },
    { "path": "apps/shop/orders-look.spec.ts", "scenario": "orders-look", "verdict": "passed", "runs": [{ "verdict": "passed" }], "references": ["apps/shop/orders-look.spec.ts-snapshots/orders-look-1-shop.png"] }
  ],
  "unwritten": [{ "scenario": "search-nothing", "code": "TEST-VALUE" }]
}
```

## Outcome

The session is traced in `<stateDir>/traces/design-<environment>-<date>.jsonl`, in the format of the [trace of a cartography](./cartographer.md), with one phase, `design`: the request and each reminder, every reasoning, text and tool call of the agent with its result, each entry of the journal, and how the design ended — `done`, `truncated` when a limit cut a design that gave its tests, `failed` otherwise. Each line is handed to `observe` as it is written. A design stopped before its session writes no trace.

`run()` returns `ok`, true when at least three tests were written that passed or fail because of the application; the path of the trace, when a session started; the branch, when tests were written, and the path of the state, when it was written; the tests; `stoppedBy`, the limit that cut the design short, when one stopped it before every scenario of its plan was closed; and the journal, as `{ level, message }` entries.

- With fewer than three such tests, those kept are written and committed all the same, and the journal gives their number.
- With none, nothing is written and no branch is created, unless a limit stopped the design after its plan was accepted: the state is then written, with the plan, and nothing is committed.
- When the plan is refused, by the review or six times by the gates, nothing is written and no branch is created; the journal gives the reason.
- When a limit of the autonomy stops the task, the journal names the limit. The tests of the scenarios closed before it are written; the scenario under way is not.

## Resuming a design

`resume` names a design a limit stopped: the path of its state, relative to the test repository, and its branch once it holds a test. The working tree must be clean, as for a new design, and the branch, when it exists, is checked out. The state must be readable, with a scenario of its plan not closed; otherwise nothing starts. The session gets the plan, which stays as it is, the tests kept with their text, the scenarios closed without a test, and the sheet of the first scenario not closed; it is offered no `propose_plan`, and is not reminded to plan. Its limits are those of the configuration, counted afresh. Once the session is over, the new tests and the state, which then lists the tests of every session and adds up what they used, are committed on the same branch, created if the design held no test yet. A plan, a test kept or a scenario closed is never done again.

The designer runs each test with `runner`, which gives the verdict; the review of the branch judges them.
