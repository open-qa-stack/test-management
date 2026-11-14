# The solo command

`oqas` runs Open QA Stack on a development machine, without an instance. In a test repository that holds `oqas.json`, it maps the target application, designs Playwright tests on a new local branch, runs them, and gives a verdict per test. Nothing is pushed.

```sh
oqas --environment local --brief "Test the search of a customer and their profile."
```

## Options

| Option | Default | What it does |
|---|---|---|
| `--repository <folder>` | the current folder | The test repository, which holds `oqas.json`. |
| `--environment <name>` | the only environment declared | The environment to run against. With several declared, it must be given. |
| `--brief <text>` | the whole domain index | What to test, in your words: a domain, a ticket, a rule, a journey. The designer looks up what echoes it in the index, explores, and plans its tests from it. |
| `--force-cartography` | off | Maps every source again, even those whose card is up to date. |
| `--follow` | off | Prints what the agents do while they do it, on the error output, besides the journal: see [Following a run](#following-a-run). |
| `--resume <run>` | | Resumes a run a limit stopped, such as `oqas-2026-11-13T12-00-00-000Z`; see [Resuming a run](#resuming-a-run). It takes no `--environment`, `--brief` nor `--force-cartography`. |
| `--help` | | Prints the usage. |

## Following a run

With `--follow`, each line of the trace of the agents is printed as it is written: the time, the phase and its source, then what happened.

```text
14:07:20 plan -> shop_fill({"target":{"role":"textbox","name":"Search"},"value":"Mira"})
14:07:20 plan <- {"url":"http://localhost:3010/orders","code":"await page.getByRole(\"textbox\", …
14:07:22 plan !! shop_click (invalid-arguments): The arguments do not match the schema of shop_click…
14:07:58 plan <- The plan was accepted. Next: answer with one sentence. Call no more tools.
14:07:59 plan 18 model requests, 266128 tokens read, 228608 of them from the cache, 2221 written
14:07:59 write harness: Write the test of this scenario for the environment local. …
```

`->` is a call of a tool with its arguments, `<-` its result, `!!` a call that gave none or an error of the session, `agent:` what the model wrote, `agent thinks:` what it thought when the model gives it, `harness:` a message the harness sent it. Each is on one line, cut to 160 characters; the trace in `<stateDir>/traces/` keeps them whole. The entries of the journal are printed by the journal, once. The secrets of the configuration are masked, as in the trace.

## Steps

Each step starts only when the one before succeeded; once the prerequisites passed, the summary runs whatever the end of the others.

1. **Configuration.** `oqas.json` is read and validated, the environment is chosen, and the test charter is resolved. A missing or invalid configuration stops the command before anything else: no model is called and no file of the repository is written.
2. **Prerequisites.** The folder is the root of a git repository with a commit, the model server of the configuration answers, and `npm` can be run.
3. **Cartography.** The sources without an up-to-date card are mapped, `cartography.concurrency` of them at once, then the cards are consolidated into the domain index (see the cartographer of `@open-qa-stack/agents`).
4. **Design.** The dependencies of the test repository and the browsers of its locked version of `@playwright/test` are installed, once for the design and the execution, then the designer, from the brief, plans then writes the tests the brief needs, four at most, on a new local branch `oqas/design-<date>`, each run against the application before it is kept. It plans in one session, then writes each test in a session of its own, each under the limits of a task. Its plan is accepted as it is. A scenario whose session ends before its test is made to end keeps its last file, classed as unfinished in the design state.
5. **Execution.** The tests designed run together, on the machine, with the real runner, except those classed as unfinished, which the journal names and which stay in the test repository for a person to decide, and the harness pronounces a verdict per test from the JSON of the reporter (see `docs/pinned-run.md` of `@open-qa-stack/harness`).
6. **Summary.** The runtime of the agents is closed, the state of the run is written, and the verdicts are printed. When the plan says that the brief asks what the application does not allow, the summary says it after the verdicts, a line each — `Not covered: Change the address of a customer. No screen offers to edit an address.` — and the state of the run keeps it in `uncovered`: tests that pass do not mean the brief is covered.

The limits of the autonomy level of the configuration apply to every task. Its guardrail, counted from the start of the run, stops every task of the agents still running when it is reached, at its next call to the model or to a tool, by its duration limit; it bounds neither the installation of the dependencies nor the execution of the tests. A task stopped by a limit is journaled with the limit reached, and none of its tests is `passed`.

## Resuming a run

A run whose cartography wrote no index, or whose design was cut short, because a limit stopped one of their tasks, keeps what it produced: the cards made, the plan accepted and the tests kept, on the branch of the design. Its state names the step and the limit in `stoppedBy`, and the summary says how to resume it:

```text
The design was stopped by its iterations limit; resume the run with: oqas --resume oqas-2026-11-13T12-00-00-000Z
```

`oqas --resume <run>` reads the configuration as it is now, so that its limits may be raised, then takes the environment and the brief of the run, and starts again from the step that was stopped, each task with fresh limits. A cartography resumed maps only the sources without an up-to-date card, then the design starts. A design resumed skips the cartography: it goes on from the plan accepted and the tests kept, on the same branch, with neither another plan nor a kept test made again; with no plan accepted yet, it starts anew. The chain then goes on as usual. A design cut short keeps the tests it gave on its branch, and runs none: its tests run once the resumed design gave one for each scenario of the plan. A run is resumed once: once another run resumed it, that run is the one to resume, if a limit stopped it. A run no limit stopped, a run resumed already, or one whose state cannot be read, is not resumed: the command says so and exits with `3`. The resumed run is a run of its own, with its own journal and state, which names the run it resumes in `resumes`.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | The whole chain ran, and every test passed. |
| `1` | The whole chain ran, and a test failed. |
| `2` | The whole chain ran without a failure, but a test was `blocked`, `indeterminate`, `skipped` or `not_run`. |
| `3` | The configuration is missing or invalid, the environment is not declared, an option is wrong, or the run to resume was not stopped by a limit, was resumed already, or cannot be read. |
| `4` | A prerequisite of the machine is missing. |
| `5` | The chain did not go to its end: no index was written, the dependencies could not be installed, the design did not give a test that counts for each scenario of its plan, a step stopped on an unexpected error, which the journal tells, or the state could not be written. |

## Journal

The journal goes to the error output, a line per entry, such as `[cartography] finished: The cartography succeeded. (95.2 s, 81 model requests)`. Once the prerequisites pass, it is also written to `<stateDir>/runs/oqas-<date>.jsonl`, a JSON object per line, from the first entry of the configuration on; a run stopped by the configuration or the prerequisites writes no file:

| Key | What it holds |
|---|---|
| `at` | When, as an ISO 8601 date. |
| `step` | `configuration`, `prerequisites`, `cartography`, `design`, `execution` or `summary`. |
| `event` | `started` and `finished` frame each step; `info` and `error` tell what happened in it. |
| `message` | What happened, in a sentence. |
| `durationMs`, `modelRequests` | For `finished`: how long the step took, and how many requests it sent to the model, whether it succeeded or not; a turn of an agent cut short before its end is not counted. |

The standard output holds only the summary. Every value of the variables the configuration names is masked, in the journal and on both outputs.

## State

The state of a run is written to `<stateDir>/runs/oqas-<date>.json`:

```json
{
  "formatVersion": 1,
  "runId": "oqas-2026-11-13T12-00-00-000Z",
  "environment": "local",
  "brief": "Test the orders.",
  "startedAt": "2026-11-13T12:00:00.000Z",
  "durationMs": 512345,
  "exitCode": 0,
  "steps": [{ "step": "configuration", "durationMs": 12, "modelRequests": 0 }, { "step": "cartography", "durationMs": 95234, "modelRequests": 81 }],
  "index": ".oqas/index/domain-index.json",
  "branch": "oqas/design-20261113T120130Z",
  "designed": ["apps/shop/list-orders.spec.ts"],
  "designState": ".oqas/designs/design-20261113T120130Z.json",
  "run": ".oqas/runs/run-2026-11-13T12-08-00-000Z.json",
  "report": ".oqas/runs/run-2026-11-13T12-08-00-000Z/report.json",
  "tests": [{ "id": "shop › shop/list-orders.spec.ts:3 › lists the orders", "verdict": "passed", "reason": "Every attempt passed." }],
  "journal": ".oqas/runs/oqas-2026-11-13T12-00-00-000Z.jsonl"
}
```

`brief` is the brief of the run, when one was given; `designState` the state the design wrote, when it wrote one, which names the file of its plan, `<design>.plan.md` beside it; `stoppedBy`, such as `{ "step": "design", "limit": "iterations" }`, the step a limit stopped and the limit, when one stopped the run; `resumes` the run it resumes, when it resumes one. `steps` lists the steps that ran before the summary, which writes the state; a step that did not succeed is listed too, with the requests it sent to the model. `index`, `branch`, `run` and `report` are present once their step produced them, as paths relative to the test repository with forward slashes. The reason of each verdict has every declared secret masked.

## What it never does

It pushes nothing, changes no remote nor the git configuration of the repository, and leaves an uncommitted change as it is: the designer refuses to start on a repository with one. It uses no container: the tests run on the machine, at the locked version of `@playwright/test`.
