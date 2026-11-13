# Designer

`new Designer(options).run()` writes three or four Playwright tests, from the [domain index](../../shared/docs/domain-index.md) of the test repository, on a new local branch. It needs the resolved configuration, the path of the test repository, the environment variables the configuration names, an `AgentRuntime`, and the system instructions of the designer, which the caller composes from the test charter:

```ts
const charter = resolveCharter(config.charter);
const instructions = designerInstructions(charter.rules, config.repository);
const outcome = await new Designer({ config, repositoryRoot, env, runtime, instructions }).run();
```

## A run

1. **Test repository.** The path must be the root of a git repository with a commit. No tracked file may be changed, no untracked file may lie outside the state folder (`repository.stateDir`) and the index folder (`repository.indexDir`), and the branch to create must not exist. Otherwise the journal names each problem, no session starts, and nothing is written. The untracked index the cartographer leaves does not stop the run.
2. **Index.** `<indexDir>/domain-index.json` must match its schema. The designer reads no contract and no base itself: the request gives the agent every domain of the index, each element with the summary its card gives, when the card is readable.
3. **Session.** The agent gets the browser tools of the applications of the environment of the index, to check a screen or a label; the tools of the documents, the source code and the logs attached to that environment or to none, the logs masking the value of every variable the configuration names; and the notes. It gets no tool of a contract or a base. It proposes each test with `propose_test`, under the limits of the configured autonomy. While fewer than three tests are accepted, an agent that stops is reminded up to three times.
4. **Branch.** Once the session is over, a branch is created from the revision checked out, and stays checked out. The accepted tests and the design state are committed on it with the identity and the hooks of the repository. The message is `test: add <n> generated Playwright tests`, with one line per test. Nothing contacts a remote, and no existing branch nor the git configuration is changed.

The branch is `oqas/design-<date>` by default, such as `oqas/design-20261113T100000Z`; `branch` gives another name.

## Writing rules

A proposal names one application of the environment, a domain of the index, a file name in lower-case words separated by hyphens and ending with `.spec.ts`, the reason for the test in one sentence, and the text of the file. The file is placed in `<appsDir>/<application>/`; nothing is written in the blocks nor the journeys folders.

A proposal is refused, the journal says why, and the agent is told so that it can fix the test and propose it again, when:

| Refusal | Cause |
|---|---|
| `… is already taken` | A test of the design, or a file of the repository, already has this path. |
| `The test does not parse as TypeScript: line L, column C: …` | The first syntax error of the file. |
| `Line N imports <module>; import only @playwright/test or a relative path…` | The file imports any package but `@playwright/test`, a platform package included. |
| `Line N imports a module whose name is computed` | An `import(…)` or `require(…)` of anything but a string. |
| `Line N imports <path>, outside the test repository.` | A relative path that leaves the repository. |
| `Line N imports <path>, another test file` | A relative path to a `.spec` or `.test` file: a test never imports another. |
| `The test holds <address>, an address of the configuration` | A user interface, an API or a contract URL the configuration declares, written in full or by its host. Tests reach an application by paths relative to the base URL that the Playwright configuration gives. |
| `The proposal holds the value of <VARIABLE>` | The value of a variable the configuration names — a test account, a connection string, the key of the model — in the reason or the text of the test. A test that signs in reads its account with `process.env`. |
| A finding of the check | The `check` option, when given, is run on a test the rules above accept; each finding it returns refuses the test. |

Every value of the variables the configuration names is masked in the journal and in what the agent is told. Once four tests are accepted, any further proposal is set aside, and the journal names it.

## Design state

The state is written to `<stateDir>/designs/design-<date>.json`, and committed with the tests unless git ignores it:

```json
{
  "formatVersion": 1,
  "producedAt": "2026-11-13T10:00:00.000Z",
  "environment": "local",
  "branch": "oqas/design-20261113T100000Z",
  "base": "<commit the branch was created from>",
  "model": { "provider": "openai", "baseUrl": "http://localhost:1234/v1", "model": "<model>" },
  "run": { "iterations": 6, "actions": 3, "durationMs": 81234 },
  "tests": [
    { "path": "apps/policy-management/list-policies.spec.ts", "application": "policy-management", "domain": "policies", "reason": "Checks that the policies of a customer are listed." }
  ]
}
```

## Outcome

`run()` returns `ok`, true when at least three tests were written; the branch and the path of the state, when tests were written; the tests; and the journal, as `{ level, message }` entries.

- With one or two tests, they are written and committed all the same, and the journal gives their number.
- With none, nothing is written and no branch is created.
- When a limit of the autonomy stops the task, the journal names the limit. The tests accepted before it are written; the proposal under way is not.

The designer neither runs the tests nor judges them.
