# Cartographer

`new Cartographer(options).run()` maps an application in one environment and writes its [domain index](../../shared/docs/domain-index.md) in the test repository. It needs the resolved configuration, the name of the environment, the path of the test repository, the environment variables the configuration names, and an `AgentRuntime`.

It works in two steps: each source is first mapped on its own into a [source card](../../shared/docs/source-card.md), then the cards are consolidated into the index. A card economises the context of the agents that read the source; the consolidation, which reads only the cards, gives the domains of the whole application.

## A run

1. **Sources.** The run reads the knowledge sources attached to the environment, or to no environment, and the user interface of each application that has one in it. Logs are left out: they tell what a service did, not what an application holds. It discovers nothing else.
2. **Check.** Every source must answer before any exploration: its inventory must be readable, and the address of a user interface must not answer with a server error. If one does not, the journal names it and its cause, no session starts, and no index is written. The inventory read here is the one the card of the source is made of: no source is read twice.
3. **Cards.** Each source without an up-to-date card is mapped by `SourceCartographer`, in a task of its own, under the limits of the configured autonomy (`mapSources`, one source at a time unless `concurrency` says otherwise). A card whose fingerprint is the source's is kept without the model, unless `force` is set.
4. **Consolidation.** A last task gets the cards, element by element, and the notes the agents kept, but none of the tools of the sources. It hands the index in with `submit_index`. A submission that breaks the schema, repeats a domain, forgets or invents an element of a card, or refers to a source without a card is refused: the journal records why, and the agent is told so it can submit again while its limits allow. The first accepted submission is kept.
5. **Index.** The index is written only if a submission was accepted and the whole index passes its schema. A source is `read` when it has a card. The index is `truncated` when a limit stopped the consolidation, a card is truncated or a source has no card, and `complete` otherwise. Its `run` adds the cards made in this run to the consolidation. Nothing is committed nor pushed.

## The card of a source

`new SourceCartographer(options).run()` writes the card of one source in `<indexDir>/sources/<id>.json`.

| Source | Elements | Facts read by the harness |
|---|---|---|
| Contract | Its tags, and the first path segment of each operation without tag | The operations of each, as `METHOD /path` |
| Base | Its tables, as `schema.table`, read from the catalog only | Number of columns, primary key, foreign keys |
| Document | Its sections of the two highest levels; a repeated title is followed by its number, as `Overview (§7)` | Number and level |
| Source code | The folders that hold files a grammar reads; past forty, the deepest are merged into their parent | Number of files, routes their outlines declare |
| User interface | The screens the agent visited, by path, with the route after `#/` and without the query | Latest title, links to other screens its snapshots showed |

The agent gets the tools of this source only — the catalog of a base, never its rows — and the notes. It hands the card in with `submit_card`, which must place every element and invent none; the facts are joined to the card afterwards. The fingerprint of a contract or a document covers its text, that of a base its structure, that of source code the content of the files counted, and that of a user interface its address, so that its card is made again on demand only.

## Notes

Every agent can keep tagged notes with `remember` and find them with `recall`, in `<stateDir>/memory/notes.jsonl`. A note, a card or an index that holds a connection string or the key of the model is refused. A password alone is not checked: the tools never give it to the agent, and one read in a source is often a word of the application's names.

## Outcome

`run()` returns the path and content of the index when it was written, and the journal: `{ level, message, source? }` entries for every check, refusal, tool error and write, those of each card first. Neither the index, the cards nor the journal holds a connection string or a key; the passwords of the accounts never reach the agent through the tools.
