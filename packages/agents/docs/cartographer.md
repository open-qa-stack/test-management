# Cartographer

`new Cartographer(options).run()` maps an application in one environment and writes its [domain index](../../shared/docs/domain-index.md) in the test repository. It needs the resolved configuration, the name of the environment, the path of the test repository, the environment variables the configuration names, and an `AgentRuntime`.

It works in two steps: each source is first mapped on its own into a [source card](../../shared/docs/source-card.md), then the cards are consolidated into the index. A card economises the context of the agents that read the source; the consolidation, which reads only the cards, gives the domains of the whole application.

## A run

1. **Sources.** The run reads the knowledge sources attached to the environment, or to no environment, and the user interface of each application that has one in it. Logs are left out: they tell what a service did, not what an application holds. It discovers nothing else.
2. **Check.** Every source must answer before any exploration: its inventory must be readable, and the address of a user interface must not answer with a server error. If one does not, the journal names it and its cause, no session starts, and no index is written. The inventory a knowledge source gives here is the one its card is made of: no knowledge source is read twice.
3. **Cards.** Each source without an up-to-date card is mapped by `SourceCartographer`, in a task of its own, under the limits of the configured autonomy (`mapSources`, one source at a time unless `concurrency` says otherwise). A card whose fingerprint is the source's is kept without the model, unless `force` is set: a cartography run again after a limit stopped it maps only the sources without an up-to-date, complete card.
4. **Consolidation.** The index records the fingerprint of each card it is made of. When the index already written is complete, of this environment, of exactly these sources, and its fingerprints are those of the cards the sources have now, it is kept as it is, without the model, unless `force` is set: the journal says so in an `index` phase that ends as `kept`, and the trace has no `consolidation`. A card made again, added or removed changes the fingerprints, and the journal says why the index is made; an index an earlier version wrote without fingerprints is made again too, the journal saying it records none rather than naming a card that changed. Otherwise a last task gets the cards, element by element, and the notes the agents kept, but none of the tools of the sources. Each element of the request is followed by the domains of the other cards that hold an element sharing a word with its name, as `shares words with shop-db › ordering`, found without the model (see [Shared words](#shared-words)). It hands the index in with `submit_index`. A submission is refused when it breaks the schema, repeats a domain, forgets or invents an element of a card, refers to a source without a card, puts an element both in a domain and in `unassigned`, or has a domain that is no functional area: one whose elements are all of one type of source (all screens, all tables) while another domain holds an element of another source that shares a word with them, or one made only of sections of the structure of documents — its purpose, scope, goals, acceptance criteria, open points, glossary and the like — even when no other domain shares a word with it. The journal records why, naming the domain or the element, and the agent is told so it can submit again while its limits allow. The first accepted submission is kept. When it leaves elements in `unassigned`, the journal counts them, and the agent is asked, in the same task and under the same limits, a second submission limited to them, each with the domains of the index that share a word with it: it puts them in domains of the index, repeating their id, label and description, or in new domains, and keeps in `unassigned` those that belong to none. A second submission accepted is merged into the first, the domains it extends or adds checked by the same rules; one refused is explained like the first, and the agent may also answer instead: the first submission is then kept as it is. A limit reached while the second submission is asked ends only that second submission: the journal names the limit, the first submission stays as it was accepted, and the consolidation ends as `done`.
5. **Index.** The index is written only if a submission was accepted and the whole index passes its schema. A source is `read` when it has a card, and records the fingerprint of that card: `sha256:` and a digest of its JSON content. The index is `truncated` when a limit stopped the consolidation other than while the second submission was asked, a card is truncated or a source has no card, and `complete` otherwise. Its `run` adds the cards made in this run to the consolidation. Nothing is committed nor pushed.

## The card of a source

`new SourceCartographer(options).run()` writes the card of one source in `<indexDir>/sources/<id>.json`.

| Source | Elements | Facts read by the harness | Also in the request |
|---|---|---|---|
| Contract | Its tags, and the first path segment of each operation without tag | The operations of each, as `METHOD /path` | |
| Base | Its tables, as `schema.table`, read from the catalog only | Number of columns, primary key, foreign keys | Its columns, each with its type and whether it may be null |
| Document | Its sections of the two highest levels; a repeated title is followed by its number, as `Overview (§7)` | Number and level | The start of its text, up to 300 characters |
| Source code | The folders that hold files a grammar reads; past forty, the deepest are merged into their parent | Number of files, routes their outlines declare | |
| User interface | The screens the agent visited, by path, with the route after `#/` and without the query | Latest title, links to other screens its snapshots showed | |

The request gives the agent each element with its facts and, on an indented line, what else the harness read of it, so that it calls a tool only for what the request does not show; those are not kept in the card. The agent gets the tools of this source only — the catalog of a base, never its rows — and the notes. It hands the card in with `submit_card`, which must place every element and invent none; the facts are joined to the card afterwards. The fingerprint of a contract or a document covers its text, that of a base its structure, that of source code the content of the files counted, and that of a user interface its address, so that its card is made again on demand only.

## Shared words

The words of the name of an element are those of three letters or more, without digits, in lower case and without accents, each plural read as its singular (`policies` as `policy`, `addresses` as `address`, `orders` as `order`), a few words such as `the` or `and` left out. In the card of a base or of source code with two elements or more, the leading words every element begins with, such as the schema of its tables or the root of its folders, are left out too, as long as each element keeps one; one of them is kept when an element of another card has it, that card's own leading words left out the same way. The words of screens, operations and sections are all kept: a single screen `/orders/new`, or sections that all begin with `Order`, share `order` with `public.orders`. Two elements share a word only when they are of different sources: `/policies/:id`, `public.policy` and `src/main/java/com/example/policy` share `policy`.

## Notes

Every agent can keep tagged notes with `remember` and find them with `recall`, in `<stateDir>/memory/notes.jsonl`. A note, a card or an index that holds a connection string or the key of the model is refused. A password alone is not checked: the tools never give it to the agent, and one read in a source is often a word of the application's names.

## Trace

Every cartography writes a trace to `<stateDir>/traces/cartography-<environment>-<date>.jsonl`, one JSON line as each thing happens, so that a run stopped short leaves its trace up to the stop. `observe`, when given, receives each line at the moment it is written, to follow the cartography while it runs.

A line holds its date (`at`), its phase, the source when there is one, its actor and its event:

| Phase | What it covers |
|---|---|
| `survey` | Checking that every source answers, and what each inventory counts. |
| `card` | The card of each source: its inventory, the card kept or made, the session of its agent. |
| `consolidation` | The search for the domains, from the cards. |
| `index` | Writing the index. |

Each phase has a `started` and a `finished` line from the `harness`, once for the whole run and once per source in `card`; `finished` gives its outcome, `done`, `kept`, `truncated` or `failed`, even when the run throws. In between, the harness writes `survey`, `inventory`, `journal` and `message` lines (each message sent to an agent: the request, then the reminders), and, just before each `finished` unless the run throws, a `usage` line: the `requests` the phase, or the card of the source, sent to the model, the `inputTokens` and `outputTokens` when the model reported them, and the `imageTokens` of the screenshots it was shown, as the harness counts them, once one was; the line of the `card` phase as a whole adds up those of the sources. Each agent its session as it reported it: `reasoning` when the model gives it, `text`, `tool-call` with its arguments, `tool-result`, `tool-error`, then `end`, `stopped` or `error`.

The connection strings and the key of the model are masked in every line, in every form a tool could give them, and a string longer than 10 000 characters is cut, with the number of characters left out.

## Outcome

`run()` returns the path and content of the index when it was written, the path of the trace, `stoppedBy`, the first limit that stopped one of its tasks when no index was written, and the journal: `{ level, message, source? }` entries for every check, refusal, tool error and write, those of each card first. Neither the index, the cards nor the journal holds a connection string or a key; the passwords of the accounts never reach the agent through the tools.
