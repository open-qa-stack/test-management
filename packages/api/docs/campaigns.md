# Campaigns

A campaign is a set of tests of the repository, chosen one by one, run against one environment from the moment they are
fixed until the campaign is closed. The tests and their tags live in the test repository, where the console narrows them
to choose; the campaign itself — its state, its tests, its executions — lives in the database of the instance. What came of a test
in a campaign is not kept apart: it is read from the executions of the campaign.

| Route | Answer |
|---|---|
| `GET /api/campaigns` | Every campaign, the latest planned first, with how many of its tests came to each verdict. |
| `POST /api/campaigns` | Plans a campaign; `201` with it. |
| `GET /api/campaigns/<id>` | The campaign, with what came of each of its tests. |
| `PUT /api/campaigns/<id>/tests` | Chooses its tests, in place of those chosen before, while it is planned. |
| `POST /api/campaigns/<id>/readiness` | Fixes its tests: it becomes `ready`. |
| `POST /api/campaigns/<id>/launches` | Launches its tests — every one, or only those that failed or were not run; `202` with the launch. Its first launch puts it `in_progress`. |
| `POST /api/campaigns/<id>/closure` | Closes it, for good. |

Every reading is given with `cache-control: no-store`; every answer that is not a success is a [problem](sessions.md#problems).
The shapes of the bodies are the types `CampaignList`, `Campaign`, `CampaignProgress` and `TestLaunch` of
`@open-qa-stack/domain/sessions`.

## The life of a campaign

```
planned ──readiness──▶ ready ──first launch──▶ in_progress ──closure──▶ closed
```

- **planned**: its tests are chosen, and may be chosen again. `GET /api/campaigns/<id>` lists them, none run.
- **ready**: its tests are fixed; one removed from the repository afterwards stays in it. A campaign with no test chosen
  is refused.
- **in_progress**: from its first launch. It is launched again as many times as wanted.
- **closed**: final. A campaign is never reopened: plan another. It is closed once no launch of it runs, so that its results are fixed: a closure asked while one runs is refused, and so is the second of two closures at once.

Any other change is refused with `campaign_refused`, whose detail names both states.

## Planning a campaign

```http
POST /api/campaigns
content-type: application/json

{ "name": "Recette 4.2", "environment": "local" }
```

| Field | |
|---|---|
| `name` | What a person calls it; at most 200 characters, spaces around it left out. |
| `environment` | The environment its tests run against. It is checked when its tests are launched. |

The campaign is planned with no test: they are chosen next.

## Choosing its tests

```http
PUT /api/campaigns/5b0c8f2e-6a51-4d1e-9a3f-2c7d1e0b9a44/tests
content-type: application/json

{ "tests": [{ "path": "apps/policy-management/tests/policies/policy-view.spec.ts", "title": "View an existing policy" }] }
```

`tests` lists the tests of the campaign, at most 2000, each by the path of its file and its title as
[the tests of the repository](tests.md) list them. They replace those chosen before; the answer is the campaign, its
tests in the order of their paths then their titles, each once. A campaign no longer planned, or a test the repository
does not hold, is refused with `campaign_refused`, whose detail names the test.

## What came of each test

```http
GET /api/campaigns/5b0c8f2e-6a51-4d1e-9a3f-2c7d1e0b9a44
```

| Field | |
|---|---|
| `campaign` | The campaign: `id`, `name`, `environment`, `status`, `createdAt`, `readyAt`, `closedAt`, and its `tests`. |
| `results[]` | Each test, by `path` and `title`, with its `verdict` in the latest execution of the campaign that ran it — `passed`, `failed`, `flaky` or `skipped` — and that execution and its date, or `not_run` when none ran it. |

A launch runs the files of the tests of the campaign, as [launching tests](executions.md#launching-tests) does, in the turn
of the sessions; its execution has the origin `campaign` and names the campaign. A test is found in an execution by the path of its file and its titles, as the runner reports them: a launch runs the files of the tests, and what it ran of a file beside them does not count.

## Launching its tests

```http
POST /api/campaigns/5b0c8f2e-6a51-4d1e-9a3f-2c7d1e0b9a44/launches
content-type: application/json

{ "only": "failed" }
```

Without a body, or with `{}`, every test of the campaign runs. `only` limits the launch to the tests whose verdict in the
campaign is `failed`, or `not_run`; a launch that would run none is refused with `campaign_refused`. While it runs,
[`GET /api/launches`](executions.md#launching-tests) tells how far it went, test by test.

## Whether a campaign passes

A campaign has no criterion of its own: it passes when every test it is made of passed in its latest execution, at once
or on a retry — a launch runs again once a test that failed, and one that passes then is `flaky` — and does not pass as
soon as one failed, was skipped, or was not run. The verdict is not kept apart: it is read from what came of its tests,
by `campaignVerdict` of `@open-qa-stack/domain/sessions`, and a closed campaign, which is never launched again, keeps it.

## The list of the campaigns

Each item of `GET /api/campaigns` is a campaign with `counts`: how many of its tests are `passed`, `failed`, `flaky`,
`skipped` or `not_run` — for a campaign still planned, the tests chosen, none run.

## Problems

| `code` | Status | When |
|---|---|---|
| `invalid_request` | `400` | The plan is not valid: the detail names the field at fault. |
| `unknown_campaign` | `404` | The instance keeps no campaign under the identifier. |
| `campaign_refused` | `409` | A change its state does not allow, a test the repository does not hold, or no test chosen when it becomes ready. |
| `launch_refused` | `409` | Its tests cannot be launched now: a session or another launch runs, or its environment is not declared. |
