# Campaigns

A campaign is a set of tests of the repository, run against one environment, from the moment they are fixed until the
campaign is closed. The tests are chosen by their tags, which live with each test in the test repository; the campaign
itself — its state, its tests once fixed, its executions — lives in the database of the instance. What came of a test
in a campaign is not kept apart: it is read from the executions of the campaign.

| Route | Answer |
|---|---|
| `GET /api/campaigns` | Every campaign, the latest planned first. |
| `POST /api/campaigns` | Plans a campaign; `201` with it. |
| `GET /api/campaigns/<id>` | The campaign, with what came of each of its tests. |
| `POST /api/campaigns/<id>/readiness` | Fixes its tests: it becomes `ready`. |
| `POST /api/campaigns/<id>/launches` | Launches its tests; `202` with the launch. Its first launch puts it `in_progress`. |
| `POST /api/campaigns/<id>/closure` | Closes it, for good. |

Every reading is given with `cache-control: no-store`; every answer that is not a success is a [problem](sessions.md#problems).
The shapes of the bodies are the types `CampaignList`, `Campaign`, `CampaignProgress` and `TestLaunch` of
`@open-qa-stack/domain/sessions`.

## The life of a campaign

```
planned ──readiness──▶ ready ──first launch──▶ in_progress ──closure──▶ closed
```

- **planned**: the scope may still take other tests. `GET /api/campaigns/<id>` lists the tests it takes now, none run.
- **ready**: its tests are fixed. A test added to the repository afterwards does not enter it; one removed stays in it.
  A scope that takes no test of the repository is refused.
- **in_progress**: from its first launch. It is launched again as many times as wanted.
- **closed**: final. A campaign is never reopened: plan another.

Any other change is refused with `campaign_refused`, whose detail names both states.

## Planning a campaign

```http
POST /api/campaigns
content-type: application/json

{ "name": "Recette 4.2", "environment": "local", "tags": ["@p0", "@p1"] }
```

| Field | |
|---|---|
| `name` | What a person calls it; at most 200 characters, spaces around it left out. |
| `environment` | The environment its tests run against. It is checked when its tests are launched. |
| `tags` | The tags of its scope: a test that bears at least one of them is taken. Each is `@` then no space, at most 50. Every test of the repository when left out or empty. |

## What came of each test

```http
GET /api/campaigns/5b0c8f2e-6a51-4d1e-9a3f-2c7d1e0b9a44
```

| Field | |
|---|---|
| `campaign` | The campaign: `id`, `name`, `environment`, `scope.tags`, `status`, `createdAt`, `readyAt`, `closedAt`, and its `tests` once fixed. |
| `results[]` | Each test, by `path` and `title`, with its `verdict` in the latest execution of the campaign that ran its file — `passed`, `failed`, `flaky` or `skipped` — and that execution and its date, or `not_run` when none ran it. |

A launch runs the files of the tests of the campaign, as [launching tests](executions.md#launching-tests) does, in the turn
of the sessions; its execution has the origin `campaign` and names the campaign. A test is found in an execution by the
path of its file: the tests of the repository are listed one per file.

## Problems

| `code` | Status | When |
|---|---|---|
| `invalid_request` | `400` | The plan is not valid: the detail names the field at fault. |
| `unknown_campaign` | `404` | The instance keeps no campaign under the identifier. |
| `campaign_refused` | `409` | A change its state does not allow, or a scope that takes no test of the repository. |
| `launch_refused` | `409` | Its tests cannot be launched now: a session or another launch runs, or its environment is not declared. |
