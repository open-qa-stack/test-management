# Cartographer

`new Cartographer(options).run()` maps an application in one environment and writes its [domain index](../../shared/docs/domain-index.md) in the test repository. It needs the resolved configuration, the name of the environment, the path of the test repository, the environment variables the configuration names, and an `AgentRuntime`.

It works in two steps: each source is first mapped on its own into a [source card](../../shared/docs/source-card.md), then the cards are consolidated into the index. A card economises the context of the agents that read the source; the consolidation, which reads only the cards, gives the domains of the whole application.

## A run

1. **Sources.** The run reads the knowledge sources attached to the environment, or to no environment, and the user interface of each application that has one in it. Logs are left out: they tell what a service did, not what an application holds. It discovers nothing else.
2. **Check.** Every source must answer before any exploration: its inventory must be readable, and the address of a user interface must not answer with a server error. If one does not, the journal names it and its cause, no session starts, and no index is written. The inventory a knowledge source gives here is the one its card is made of: no knowledge source is read twice.
3. **Cards.** Each source without an up-to-date card is mapped by `SourceCartographer`, in a task of its own, under the limits of the configured autonomy (`mapSources`, one source at a time unless `concurrency` says otherwise). A card whose fingerprint is the source's is kept without the model, unless `force` is set: a cartography run again after a limit stopped it maps only the sources without an up-to-date, complete card.
4. **Consolidation.** The index records the fingerprint of each card it is made of. When the index already written is complete, of this environment, of exactly these sources, and its fingerprints are those of the cards the sources have now, it is kept as it is, without the model, unless `force` is set: the journal says so in an `index` phase that ends as `kept`, and the trace has no `consolidation`. A card made again, added or removed changes the fingerprints, and the journal says why the index is made; an index an earlier version wrote without fingerprints is made again too, the journal saying it records none rather than naming a card that changed. Otherwise a last task gets the cards, element by element, and the notes the agents kept, but none of the tools of the sources. Each element of the request is followed by the domains of the other cards that hold an element sharing a word with its name, as `shares words with shop-db › ordering`, found without the model (see [Shared words](#shared-words)). It hands the index in with `submit_index`. A submission is refused when it breaks the schema, repeats a domain, forgets or invents an element of a card, refers to a source without a card, puts an element both in a domain and in `unassigned`, or has a domain that is no functional area: one whose elements are all of one type of source (all screens, all tables) while another domain holds an element of another source that shares a word with them, or one made only of sections of the structure of documents — its purpose, scope, goals, acceptance criteria, open points, glossary and the like — even when no other domain shares a word with it. The journal records why, naming the domain or the element, and the agent is told so it can submit again while its limits allow. An item that is no element of its source is read without the name of the source in front of it, such as `shop-db/public.orders`, and, when it is the id or the label of a domain of the card of its source, such as `ordering`, as the elements of that domain the submission names nowhere else for that source: a model often takes the domain of a card for an element. The first accepted submission is kept. Each element it leaves in `unassigned` that a domain of its card holds whose id or label is, case aside, that of a domain of the index goes to that domain, unless it is a section of the structure of a document or the index would then break the rules above; the journal names each, such as `The harness put in the domain of the index named as a domain of their card these elements left in unassigned: shop: /customers in customers.` When it leaves elements in `unassigned`, the journal counts them, and the agent is asked, in the same task and under the same limits, a second submission limited to them, after the domains of the index, each with their id, label and description, then each element with the domain of its card that holds it, what its card says it holds, and the domains of the index that share a word with it: it puts them in domains of the index, repeating their id, label and description, or in new domains, and keeps in `unassigned` those that belong to none. A second submission accepted is merged into the first, the domains it extends or adds checked by the same rules; one refused is explained like the first, and the agent may also answer instead: the first submission is then kept as it is. A limit reached while the second submission is asked ends only that second submission: the journal names the limit, the first submission stays as it was accepted, and the consolidation ends as `done`.
5. **Index.** The index is written only if a submission was accepted and the whole index passes its schema. A source is `read` when it has a card, and records the fingerprint of that card: `sha256:` and a digest of its JSON content. The index is `truncated` when a limit stopped the consolidation other than while the second submission was asked, a card is truncated or a source has no card, and `complete` otherwise. Its `run` adds the cards made in this run to the consolidation. Nothing is committed nor pushed.

## The card of a source

`new SourceCartographer(options).run()` writes the card of one source in `<indexDir>/sources/<id>.json`.

| Source | Elements | Facts read by the harness | Also in the request |
|---|---|---|---|
| Contract | Its tags, and the first path segment of each operation without tag | The operations of each, as `METHOD /path` | |
| Base | Its tables, then its views, materialized or not, each as `schema.name`, read from the catalog only | Its kind, `table` or `view`, and its number of columns; for a table, primary key and foreign keys; for a view, the tables and views it reads; for either, the names of its triggers when it has some | |
| Document | Its sections of the two highest levels; a repeated title is followed by its number, as `Overview (§7)` | Number and level | The start of its text, up to 300 characters |
| Source code | The folders that hold files a grammar reads; past forty, the deepest are merged into their parent | Number of files, routes their outlines declare | |
| User interface | The screens the agent visited, by path, with the route after `#/` and without the query | Latest title, links to other screens its snapshots showed | |

A base is not mapped with `submit_card`: see [The workflow of a base](#the-workflow-of-a-base). For any other source, the request gives the agent each element with its facts and, on an indented line, what else the harness read of it, so that it calls a tool only for what the request does not show; those are not kept in the card. The agent gets the tools of this source only, and the notes. It hands the card in with `submit_card`, which must place every element and invent none; the facts are joined to the card afterwards. The fingerprint of a contract or a document covers its text, that of a base the definition of each of its exported elements, routines and triggers included, that of source code the content of the files counted, and that of a user interface its address, so that its card is made again on demand only.

## The workflow of a base

A base has too many elements for one answer. Its card is derived from a workflow the harness drives, in the folder `<indexDir>/sources/<id>/`, beside the card:

1. **Export.** The harness writes `export/`, in place of the one written before: `export/summary.txt` sums up every element in a few lines, and the definition of each is in a file of its own, such as `export/tables/public.orders.sql`, `export/views/public.open_orders.sql` or a file of `export/routines/` (see [Export of a database](../../tools/docs/knowledge-tools.md#export-of-a-database)). The connection strings and the key of the model are masked in every file; a definition is otherwise written as the database gives it, so a password or a key someone wrote in the body of a routine or in the query of a view is exported with it. It then writes `manifest.json`, the [source manifest](../../shared/docs/source-manifest.md), `in_progress`.
2. **Grouping.** The elements are cut into batches, in the order of the export: 30 elements at most, and 20,000 characters of summaries at most, a summary longer than 1,500 characters cut with the file where the rest is. Each batch gets a session of its own, under the limits of the configured autonomy, with one tool, `place_elements`, and neither the tools of the base nor the notes. Its request gives the number of the batch, the domains made so far — id, label, description, number of elements, three of them, and whether it is full, at 40 elements — then each element with its summary and the domain of the elements it is linked to. The model answers with one call: the new domains, and for each element a domain and a one-line role, or a reason to set it aside.
3. **Domain files.** Each domain gets a session of its own, without any tool. Its request gives the domain, its elements with their role and summary, and the other domains of the source; the model answers with the markdown body alone, in English. The harness takes away a code fence put around the whole answer, writes the header — label, identifier, description — and writes the file to `domains/<id>.md`.
4. **Control.** A body is checked by program before it is kept: see [What the control of a domain file answers](#what-the-control-of-a-domain-file-answers). Once every file is written, the harness reads them back and checks that no element is lost: each exported element is named in the file of its domain, or set aside with its reason in the manifest.
5. **Manifest and card.** The manifest is written again with the domains, the file of each, and where each element was left: `complete` only when every element is set aside or in a domain whose file, written by the model, names it; `truncated` otherwise. The card is derived from it: the tables and the views by domain, the role of each as its summary, with the facts the harness read; those set aside or left unplaced in `unassigned`. The routines are in the manifest only. When no element at all was placed, no card is written.

A card that is kept writes neither export nor manifest.

### What `place_elements` answers

Every element a call places validly is kept at once, and the answer names only what is wrong and what is still to place. The harness reacts in three ways:

| Reaction | When | Message |
|---|---|---|
| Proposal | A domain id that is no slug | `The domain id "Order Returns" is not a slug. Proposed: "order-returns". If it suits you, declare the domain and place its elements again with that id.` |
| Proposal | A label, or an id in another case, given for the id of a domain | `public.orders: "Orders" is not a domain id. Proposed: "orders". If it suits you, place public.orders again with that id.` |
| Proposal | A new domain with the label of another | `The domain ordering has the label of the domain orders. Proposed: place its elements in orders. If it is another area, give it another label.` |
| Warning, once per batch | Elements set aside | `You set aside public.audit. An element set aside is in no domain, and no agent will find it by domain. If that is what you mean, give them again the same way; otherwise place them.` |
| Error | A call that breaks the schema | The field in fault, such as `/items must NOT have fewer than 1 items.` |
| Error | A name that is no element of the batch | `public.invoices is not an element of this batch. Use the names of the ### lines only.` |
| Error | An element given twice | `public.orders is given twice; the first was read. Give each element once.` |
| Error | Neither a domain and a role, nor a reason alone | `public.orders needs either a domain and a role, or a reason alone.` |
| Error | A domain that does not exist | `public.orders: the domain "sales" does not exist. Declare it in domains with an id, a label and a description, or use one of orders, customers.` |
| Error | A domain the same call failed to declare | `public.orders: its domain "Order Returns" was not created, for the reason given above.` |
| Error | A full domain | `public.orders: the domain orders is full, with 40 elements. Place it in another domain, or declare a narrower one, such as "orders-history".` |
| Error | A domain id no slug can be made of | `The domain id "§" is not a slug. Write lower case letters and digits separated by hyphens, such as "order-returns".` |
| Error | A role, a reason, a label or a description that is empty, longer than 200 characters, or holds a secret | `The role of public.orders is empty. Write one line.`, `… has 240 characters. Keep it under 200, such as "Orders placed by customers, one row each."`, `… holds a secret of the configuration. Write it without the secret.` |

The harness never applies a proposal itself. It changes without saying so only what leaves the meaning as it is: a name written after the source and a slash or a colon is read without them, a role on several lines is put on one, and a known domain declared again is left as it was. Every answer that names a problem ends with the elements still to place and an example of a call.

### What the control of a domain file answers

| Reaction | When | Message |
|---|---|---|
| Proposal | An element named without backticks | ``public.orders is named, but not between backticks. Proposed: `public.orders`, where you name it.`` |
| Error | An empty answer | `The answer is empty. Write the markdown body of the file.` |
| Error | A body longer than 12,000 characters | `The body has 12480 characters. Keep it under 12000: one line per element, and shorter hints.` |
| Error | An element of the domain the body does not name | ``These elements of the domain are not named: public.order_lines. Name each exactly as written, between backticks, such as `public.order_lines`.`` |
| Error | A secret of the configuration, never repeated | `The body holds a secret of the configuration. Write it without the secret.` |

A refused body is answered with `The file was not kept. Fix what follows and answer again with the whole body.` and what is wrong, three times at most. After that, or when the session fails or reaches a limit, the harness writes the file itself: a table of the elements of the domain with their kind and role. The manifest marks the domain `writtenBy: "harness"` with the reason in `refused`, the last body of the model the control refused is kept beside the file as `domains/<id>.refused.md`, and the source ends `truncated`, so that a later run asks the model again. A file the model wrote is marked `writtenBy: "model"`.

A batch gets three calls. After the third that leaves elements to place, or when its session ends, fails or reaches a limit, the batch is closed: the elements left are recorded in the manifest as `unplaced`, each with what was last said of it, the journal names them, and the next batch runs. A model that stops before the batch is over is reminded of what is left, three times at most. A session that fails ends the grouping; the elements of the batches after it are `unplaced` too. Nothing is lost: a later run of the cartography finds the card truncated and maps the base again.

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
