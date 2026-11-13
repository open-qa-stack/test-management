# Cartographer

`new Cartographer(options).run()` maps an application in one environment and writes its [domain index](../../shared/docs/domain-index.md) in the test repository. It needs the resolved configuration, the name of the environment, the path of the test repository, the environment variables the configuration names, and an `AgentRuntime`.

## A run

1. **Sources.** The run reads the knowledge sources attached to the environment, or to no environment, and the user interface of each application that has one in it. It discovers nothing else.
2. **Check.** Every source must answer before any exploration: the list of operations of a contract, of tables of a base, of sections of a document, of files of source code, and the address of a user interface, which must not answer with a server error. If one does not, the journal names it and its cause, no session starts, and no index is written.
3. **Inventory.** The harness reads, without the model, the tags of each contract — the first path segment of an operation without tag — and the tables of each base. The agent is given these items, every one of which its index must place.
4. **Exploration.** The agent explores with the tools of the sources and of the user interfaces: the catalog of a base, never its rows; the pages of the interfaces, on their own origins only, signing in with the declared test accounts when needed. The task runs under the limits of the configured autonomy.
5. **Submission.** The agent hands its index in with `submit_index`. A submission that breaks the schema, repeats a domain, forgets or invents a tag or a table is refused: the journal records why, and the agent is told so it can submit again while its limits allow. The first accepted submission is kept.
6. **Index.** Once the session ends, the index is written only if a submission was accepted and the whole index passes its schema. It is `truncated` when a limit stopped the task or a source was not read — a document, source code or interface whose tools the agent never used — and `complete` otherwise. Nothing is committed nor pushed.

## Outcome

`run()` returns the path and content of the index when it was written, and the journal: `{ level, message, source? }` entries for every check, refusal, tool error and write. Neither the index nor the journal holds a connection string, a key or a password.
