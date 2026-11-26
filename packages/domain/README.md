# @open-qa-stack/domain

The rules and the formats of the product in plain TypeScript, with no framework, which every other package builds on:

- the `AgentRuntime` port that agents run on, the tests an agent proposes and how they are checked and run, and the verdicts drawn from a run;
- the formats every package reads and writes, each with its JSON Schema, its types and its validation: the configuration file `oqas.json` ([docs/configuration.md](docs/configuration.md)), the knowledge base ([docs/knowledge-base.md](docs/knowledge-base.md)), the source cards ([docs/source-card.md](docs/source-card.md)) and the source manifests ([docs/source-manifest.md](docs/source-manifest.md));
- the names and the folders of a test repository;
- what a run says: its journal, its traces, its state, and how they read as the thread of a session;
- the contract of sessions between the API and its clients, and the life of a session, with the port of what keeps the sessions.

## Folders

| Folder                 | Holds                                                                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agent/`           | The `AgentRuntime` port, its sessions, their events and their errors, the limits of a task and the definition of a tool.                                                                                                                                                                             |
| `src/config/`          | The configuration file `oqas.json`: its schema, its types, its validation, and the names of the file and of the state folder.                                                                                                                                                                        |
| `src/knowledge-base/`    | The knowledge base: its schema, its types, its validation and the placement of what the sources hold.                                                                                                                                                                                                  |
| `src/source-card/`     | The source cards: their schema, their types and their validation.                                                                                                                                                                                                                                    |
| `src/source-manifest/` | The source manifests: their schema, their types and their validation.                                                                                                                                                                                                                                |
| `src/image/`           | What an image costs a model, and the result of a tool that returns one.                                                                                                                                                                                                                              |
| `src/test/`            | The tests an agent proposes, the plan they come from, the ports that check and run them, and the verdicts drawn from a run.                                                                                                                                                                          |
| `src/report/` | The JSON of the Playwright reporter: `reportEntries`, which walks its suites and names each test as the harness does, and `qaViews`, which reads each test in steps as a person checks it — the `test.step` it calls, numbered, their states, durations and captures, the step that failed, what the failed assertion expected and received — from the report alone. |
| `src/repository-tests/` | A test of the test repository as its file tells it, `RepositoryTest`, and `testFacets`, which reads what its tags say of it. |
| `src/test-repository/` | The names and the folders of the tests, the pages and the fixtures in a test repository.                                                                                                                                                                                                             |
| `src/json.ts` | What reads a value no type vouches for — a line of a file, the body of a request: `parseJson`, `isRecord`, `textOf`. |
| `src/run/`             | The vocabulary of a run, as every package that writes or reads one shares it: an entry of the journal and the steps, a line of a trace with its phases and its events, the state of a run and its exit codes, the folders of the state folder the agents and the tests write to, and the tag of a message of the person. |
| `src/run-thread/`      | The translation of what a run says into the events of a session: the lines of a journal and of traces as they are read, `RunThread`, which tells them as events without their ranks, and the result of a session read from the state of its run. No file and no framework: whoever receives the lines calls it. |
| `src/sessions/`        | The contract of sessions: the project, a session, its events, the problems of the API. Types only.                                                                                                                                                                                                   |
| `src/session-life/`    | The life of a session, stated once: `SESSION_LIFE`, the states each command is for and the state it leaves, with what follows from it — `isTerminal`, `accepts`, `nextState`, `refusalOf` — the errors a refused command raises, and `SessionStorePort`, the commands and the queries of what keeps the sessions, those by which several processes meet there included. |

## Entries

| Entry                                      | Holds                                                                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `@open-qa-stack/domain`                    | Everything but the contract of sessions, the rules of the life of a session included, for the packages that run on Node.js.        |
| `@open-qa-stack/domain/sessions`           | The contract of sessions, `src/sessions/`: types only, which import no module of Node.js, so that the web console reads them with browser types. |
| `@open-qa-stack/domain/<name>.schema.json` | The JSON Schema of a format: `oqas`, `oqas-knowledge-base`, `oqas-source-card` and `oqas-source-manifest`, written by `pnpm schema`. |
