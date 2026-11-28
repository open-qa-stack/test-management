# Cartographer

`new Cartographer(options).run()` maps an application in one environment and writes its [knowledge base](../../domain/docs/knowledge-base.md) in the test repository. It needs the resolved configuration, the name of the environment, the path of the test repository, the environment variables the configuration names, and an `AgentRuntime`.

It works in two steps: each source is first mapped on its own, by its own agent, into a [source card](../../domain/docs/source-card.md) whose elements are grouped into the domains of that source; then an orchestrator consolidates the domains of the sources into those of the application. The agent of a source knows that source only; the orchestrator, tied to no source, has access to all of them and to every map made.

The instructions of every agent of the cartography end with the language of the knowledge, by `knowledgeLanguageRule`: the labels and descriptions of the domains, the roles and summaries of the elements and the files of the domains are written in the language of the person, `language` of the configuration, English by default. The identifiers stay English slugs, and a name a source gives is quoted as the source writes it.

## A run

1. **Sources.** The run reads the knowledge sources of the whole project and those attached to the environment, or to no environment, and the user interface of each application that has one in it. Logs are left out: they tell what a service did, not what an application holds. It discovers nothing else.
2. **Check.** Every source must answer before any exploration: its inventory must be readable, and the address of a user interface must not answer with a server error. If one does not, the journal names it and its cause, no session starts, and no knowledge base is written. The inventory a knowledge source gives here is the one its card is made of: no knowledge source is read twice.
3. **Cards.** Each source without an up-to-date card is mapped by `SourceCartographer`, in a task of its own, under the limits of the configured autonomy (`mapSources`, one source at a time unless `concurrency` says otherwise). A card whose fingerprint is the source's is kept without the model: a cartography run again after a limit stopped it maps only the sources without an up-to-date, complete card.
4. **Consolidation.** The knowledge base records the fingerprint of each card it is made of. When the knowledge base already written is complete, of this environment, of exactly these sources, and its fingerprints are those of the cards the sources have now, it is kept as it is, without the model: the journal says so in a `knowledge-base` phase that ends as `kept`, and the trace has no `consolidation`. A card made again, added or removed changes the fingerprints, and the journal says why the knowledge base is made; a knowledge base an earlier version wrote without fingerprints is made again too, the journal saying it records none rather than naming a card that changed. Otherwise the consolidation runs: see [The consolidation](#the-consolidation). When no source has a card, or the sources were mapped into no domain, no knowledge base is written and the journal says which.
5. **Knowledge base.** The knowledge base is written only if a submission was accepted and the whole knowledge base passes its schema. A source is `read` when it has a card, and records the fingerprint of that card: `sha256:` and a digest of its JSON content. The knowledge base is `truncated` when a limit stopped the consolidation, a card is truncated or a source has no card, and `complete` otherwise. Its `run` adds the cards made in this run to the consolidation. Nothing is committed nor pushed.

## The card of a source

`new SourceCartographer(options).run()` writes the card of one source in `<knowledgeDir>/sources/<id>.json`.

| Source | Elements | Facts read by the harness | Also in the request |
|---|---|---|---|
| Contract | Its operations, each as `METHOD /path`; its named schemas are elements of its export only | Its kind, `operation`, its identifier and its tags when it has some | |
| Base | Its tables, then its views, materialized or not, each as `schema.name`, read from the catalog only | Its kind, `table` or `view`, and its number of columns; for a table, primary key and foreign keys; for a view, the tables and views it reads; for either, the names of its triggers when it has some | |
| Document | What the agent that reads the documents chooses: a whole document, by its path, or one of its sections, as `path § Title` | Its kind, `document` or `section` | |
| Source code | The folders that hold files a grammar reads; past forty, the deepest are merged into their parent | Number of files, routes their outlines declare | |
| User interface | What the agent that explores it chooses: a screen, by its route, or one thing a user does on it, as `/customers § Search a customer` | Its kind, `screen` or `feature` | |

A base and a contract are not mapped with `submit_card`: see [The workflow of a base](#the-workflow-of-a-base), which a contract follows too. Nor are documents, see [The cartography of documents](#the-cartography-of-documents), nor a user interface, see [The exploration of an application](#the-exploration-of-an-application). For source code, the request gives the agent each element with its facts, so that it calls a tool only for what the request does not show. The agent gets the tools of this source only, and the [memory](#memory). It hands the card in with `submit_card`, which must place every element and invent none; the facts are joined to the card afterwards. The fingerprint of a contract or a document covers its text, that of a base the definition of each of its exported elements, routines and triggers included, that of source code the content of the files counted, and that of a user interface its address, so that its card is made again on demand only.

## The workflow of a base

A base has too many elements for one answer. Its card is derived from a workflow the harness drives, in the folder `<knowledgeDir>/sources/<id>/`, beside the card.

A contract follows the same workflow, from its own export: one element per operation, in `export/operations/`, then one per named schema, in `export/schemas/`, each defined by what the contract writes of it, as JSON, its references kept. The instructions of its sessions speak of operations and schemas where those of a base speak of tables, views and routines; its card holds its operations.

The steps:

1. **Export.** The harness writes `export/`, in place of the one written before: `export/summary.txt` sums up every element in a few lines, and the definition of each is in a file of its own, such as `export/tables/public.orders.sql`, `export/views/public.open_orders.sql` or a file of `export/routines/` (see [Export of a database](../../tools/docs/knowledge-tools.md#export-of-a-database)). The connection strings and the key of the model are masked in every file; a definition is otherwise written as the database gives it, so a password or a key someone wrote in the body of a routine or in the query of a view is exported with it. It then writes `manifest.json`, the [source manifest](../../domain/docs/source-manifest.md), `in_progress`.
2. **Grouping.** The elements are cut into batches, in the order of the export: 30 elements at most, and 20,000 characters of summaries at most, a summary longer than 1,500 characters cut with the file where the rest is. Each batch gets a session of its own, under the limits of the configured autonomy, with `place_elements` and `remember`, and no tool of the base. Its request gives the number of the batch, the domains made so far — id, label, description, number of elements, three of them, and whether it is full, at 40 elements — then each element with its summary and the domain of the elements it is linked to. The model answers with one call: the new domains, and for each element a domain and a one-line role, or a reason to set it aside.
3. **Domain files.** Each domain gets a session of its own, without any tool. Its request gives the domain, its elements with their role and summary, and the other domains of the source; the model answers with the markdown body alone, in the language of the person (`language` of the configuration). The harness takes away a code fence put around the whole answer, writes the header — label, identifier, description — and writes the file to `domains/<id>.md`.
4. **Control.** A body is checked by program before it is kept: see [What the control of a domain file answers](#what-the-control-of-a-domain-file-answers). Once every file is written, the harness reads them back and checks that no element is lost: each exported element is named in the file of its domain, or set aside with its reason in the manifest.
5. **Manifest and card.** The manifest is written again with the domains, the file of each, and where each element was left: `complete` only when every element is set aside or in a domain whose file, written by the model, names it; `truncated` otherwise. The card is derived from it: the tables and the views by domain, the role of each as its summary, with the facts the harness read; those set aside or left unplaced in `unassigned`. The routines are in the manifest only. When no element at all was placed, no card is written.

A card that is kept writes neither export nor manifest.

A source that changed is not mapped from nothing. The workflow goes on from the manifest the run before left, when it can be read: an element whose fingerprint did not change keeps its domain and its role, or stays set aside; an element that changed, is new or was left unplaced is placed again, in batches, each told the domain it was in (`It changed since it was placed in orders.`); one that left the source is forgotten. The domains of the manifest stay known, so that an element may go back to one. The file of a domain is kept when the model wrote it, it still names every element of the domain, and the domain neither gained, lost nor holds an element placed in this run; any other is written again, and a domain left without any element loses its file. The manifest is written after each batch and after each file, so that the run after one a limit stopped goes on from there. One table that changed costs one request to place it and one to write the file of its domain again.

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
| Error | In code, a name that begins with a schema of the source and that its export writes nowhere | ``public.payments is not an element of shop-db, and nothing in its export has this name. Remove it, or use a name the request shows.`` — or ``Proposed: `archive.orders`.`` when one element has this name in another schema |
| Error | In code, a column after such a name that its relation does not have | `public.orders.total: public.orders has no column total. Its columns: id, customer_id, status.` |
| Warning | In code, a column after the name of a relation written without its schema, which may be an alias | `orders.total: orders has no column total. Its columns: … If orders is not that relation here, answer again with the same body to confirm.` |
| Warning | A lone name of several words joined by underscores that the export writes nowhere, which may be a value | ``The export of shop-db writes these names nowhere: `order_status`. If they are columns or elements, use the names the request shows. If they are something else, answer again with the same body to confirm.`` |

The names are compared with everything the export of the source writes — the names of its elements, their summaries and their definitions — without their case nor their double quotes, so that a type or a sequence a definition names is no invention. An element with arguments, such as a routine, may be cited without them: `` `public.order_total` `` or `` `public.order_total()` ``. A warning is told once, with `The file is not kept yet. Check what follows, then answer again with the whole body.`: the same body answered again is kept.

A refused body is answered with `The file was not kept. Fix what follows and answer again with the whole body.` and what is wrong, three times at most. After that, or when the session fails or reaches a limit, the harness writes the file itself: a table of the elements of the domain with their kind and role. The manifest marks the domain `writtenBy: "harness"` with the reason in `refused`, the last body of the model the control refused is kept beside the file as `domains/<id>.refused.md`, and the source ends `truncated`, so that a later run asks the model again. A file the model wrote is marked `writtenBy: "model"`.

A batch gets three calls. After the third that leaves elements to place, or when its session ends, fails or reaches a limit, the batch is closed: the elements left are recorded in the manifest as `unplaced`, each with what was last said of it, the journal names them, and the next batch runs. A model that stops before the batch is over is reminded of what is left, three times at most. A session that fails ends the grouping; the elements of the batches after it are `unplaced` too. Nothing is lost: a later run of the cartography finds the card truncated and maps the base again.

## The cartography of documents

Every team writes its documents its own way: one long specification, a file per feature, a folder per module. The harness therefore cuts nothing beforehand. An agent of its own reads the documents of the source — one file, or a folder of them — in one session, under the limits of the configured autonomy, and chooses its elements itself.

It gets the [tools of the documents](../../tools/docs/knowledge-tools.md#documents) of this source and of no other, the [memory](#memory), and the two tools of its map. Its instructions give it a method — walk the tree, get an idea of each document, name the domains, hand each in — and the grain of an element: something a test can aim at, such as a use case, a screen, a business rule or a small group of rules; neither a chapter that holds everything nor a single sentence. Its request lists what the root holds.

| Tool | What it hands in |
|---|---|
| `write_domain` | One domain: its `id`, `label` and `description`, its `elements` — each a `file`, with a `section` number for one of its sections, and a `role` — and the `body` of its file. A domain handed in again replaces what was kept of it. |
| `set_aside` | The `elements` that serve no functional area — whole documents, or sections of a document, given as for `write_domain` — with a `reason`. |

The harness holds what is handed in to the source and to what the agent looked at, which it watches call by call: a listing shows the title of a document, its sections show its outline, a read shows its text.

| Answer | When |
|---|---|
| Refusal | An identifier that is no slug; a label, a description, a role or a reason that is empty or longer than 200 characters; a document or a section the source does not have; an element given twice, or already in another domain; a document or a section set aside and placed; a document placed whose sections the agent neither listed nor read; a document set aside whose title it never saw, or a section set aside of a document whose sections it never listed; a body that does not name every element between backticks, is longer than 12,000 characters or holds a secret. A domain is kept whole or not at all. |
| Warning, once per domain | The agent read the text of less than a third of the documents of a domain of three or more: the same call again confirms that their titles told enough. |

The map is over once the whole source is covered, and not before. A document is covered when it is placed or set aside whole. One the agent cut into sections is covered section by section: a section is covered by itself or by one that holds it, and each result names the sections still in no domain, the largest first, with their numbers. What comes before the first heading of a document, and the lines of a section before its first covered sub-section, are not counted.

Every refusal has an exit. The third body refused for one domain is replaced by a table the harness writes, and the domain is kept. After ten calls refused the map is closed: what is placed stays. An agent that stops while documents are in no domain is reminded of them, three times at most.

Once the session is over, the harness writes the folder of the source in the same shape as for a base: `export/`, with the text of each element — a document in `export/documents/`, a section in `export/sections/` — the file of each domain, and the manifest. A document or a section in no domain and not set aside is never lost: it is an element of the manifest, left unplaced with why, and the manifest is then `truncated`. The card is derived from the manifest and bears the fingerprint of the documents: it is kept while none changes, and the documents are mapped again, all of them, when one does.

## The exploration of an application

Nothing of a user interface can be read without opening it. An agent of its own explores it with the browser, in one session, under the limits of the configured autonomy: given the address of the interface in the environment, it opens the home, follows the menus and the links, tries what a user does on each screen, and maps what the application does into domains.

It gets the browser tools of this application, the [memory](#memory), and the two tools of its map. Each tool that acts on the page gives back what the page then shows, so that the agent sees where each step leads. A screen is named by its route: its path, with the route after `#/` of an application that routes in the fragment, without its query, and with `:id` in place of a segment that names one record — a number, a UUID, six characters or more with a digit. The screens of every record are one screen: `/customers/:id`, whatever name the agent gives the record, such as `:customerId`. A page that says it does not exist — its title or a heading reads 404, not found, introuvable, does not exist… — is the screen of an error, `/:error`, one for the whole application whatever address was tried; the address tried is no screen left to open.

**What it may do.** An exploration never removes data: a click on an element whose name says it removes some is refused. The key `exploration` of the environment says the rest: with `read-only`, the default, a click on an element whose name says it creates or changes data is refused too, and the agent reads the form instead; with `read-write`, it may submit such forms to see what the application answers. Both are guesses from the words of a name.

**What it hands in.** `write_domain` takes a domain, its `elements` — each a `screen`, with a `feature` for one thing a user does on it — its `observations` and the `body` of its file. `set_aside` takes the screens that serve no functional area. The harness holds the map to what the agent opened: an element of a screen never opened is refused, while a screen a link led to may be set aside without being opened, such as a way out of the application.

**What it observed.** An observation says what the application does when a user does something, or what it enforces: a search that matches nothing and what the screen then shows, an address that does not exist and its message, a field that is required. What a screen merely holds belongs to the file of the domain. It names the screen it was made on, says it in one sentence and may quote in `shows` the exact texts the screen displayed. It is what was seen, not what is specified. The harness refuses one made on a screen never opened and a text its screen never showed, and writes those it keeps at the end of the file of the domain, under the heading `Observed on the screens`. A domain handed in without any observation is asked about once: the same call again confirms that the agent saw nothing there a test can verify.

**When it is over.** The map is over once every screen opened is in a domain or set aside, by itself or by one thing done on it, and every screen a link led to was opened or set aside. Each result names the screens left, those never opened marked so. Before anything is opened, the home is still to explore.

The refusals, their exits and what is written once the session is over are those of the cartography of documents: both maps share them. The card bears the fingerprint of the address of the interface: it is made again on demand only.

## The consolidation

The orchestrator is an agent of its own, in one session, under the limits of the configured autonomy. It places no element again: it says which domains of the sources are one functional area of the application, and their elements follow.

Its request lists, source by source, the domains its agent made — id, label, description, number of elements and three of them — and how many elements that agent set aside. It gives no list of elements. A source without a card is marked as not mapped.

| Tool | What it is for |
|---|---|
| `read_source_domain` | What the agent of a source wrote of one of its domains: the file of the domain when the source has one, cut past 8,000 characters, and otherwise its elements with their summary. |
| The tools of the sources | Those of every knowledge source of the run — its tables, its contract, its documents, its code — to check in a source what its map leaves in doubt. |
| The browser of each application | Guarded as an exploration is: nothing that removes data is clicked, and nothing that creates or changes some unless the environment is `read-write`. |
| `remember`, `recall` | The [memory](#memory): what the agents of the sources kept, and what the orchestrator keeps about the application as a whole. |
| `submit_knowledge_base` | The domains of the application, each with its `id`, `label`, `description` and, in `from`, the domains of the sources it gathers: a `source`, a `domain` and, to cut a domain between two areas, the `items` this one takes. |

`submit_knowledge_base` answers in three ways:

| Answer | When |
|---|---|
| Refusal | A call that breaks the schema; an id that is no slug or given to two domains; a label or a description that is empty or longer than 200 characters; a domain that gathers nothing; a source without a card; a domain its source does not have, the refusal naming those it has; an element that is not of the domain it is cut from; an element, or a whole domain of a source, taken by two domains; a secret of the configuration. |
| Refusal, once | Domains of the sources, or what is left of one cut, that no domain of the application takes: the refusal names each. |
| Accepted | Everything else. The first accepted submission is kept. |

Every refusal has an exit. Domains of the sources left aside in two submissions in a row, with nothing else wrong, are kept by the harness as domains of the application of their own, under the id, the label and the description their source gave them, and the journal names each. An agent that stops without an accepted knowledge base is reminded to hand one in, with the latest refusal, three times at most.

The knowledge base is derived from the accepted submission: each domain refers, by source, to the elements of the domains it gathers; two domains handed in under one id are joined; what the agent of a source set aside stays in `unassigned`, and the orchestrator is not asked about it.

## Memory

Every agent can keep what it learned for the agents that come after it with `remember`, and find what they kept with `recall`. The memories are kept in [the database of the instance](../../store/docs/database.md#the-memories-of-the-agents), with the rest of its state; nothing is written to the test repository. The sessions that place a batch of elements and that write the file of a domain keep memories without reading any: their request holds what they need. Each is told to keep what the agents after it should know and no element says by itself, not everything.

A memory is filed under a domain and a kind:

- **The domain** is the identifier of a domain of the knowledge it is about, or `general` for what holds across the domains.
- **The kind** is one of six, each the answer to a question an agent asks before it acts:

| Kind | What it is |
| --- | --- |
| `business_rule` | A rule the application applies: what a test checks. |
| `pitfall` | What misleads an agent or breaks a test, such as a delay, a field that empties itself or a label that says something else. |
| `test_data` | A record, an account by role or a value a test can rely on; never a password. |
| `locator` | How to target an element of a screen reliably. |
| `navigation` | How to reach a screen or a state. |
| `vocabulary` | Two sources or two screens that name the same thing differently. |

What a domain holds is no kind: that is the knowledge, which the cards and the knowledge base already say.

A memory also holds its text, 600 characters at most, tags that file it, eight at most and kept in lower case, the source or the application it is about, who wrote it — the role of the agent and its task — and when, and who corrected it last.

`recall` keeps exactly to the domain, the kind and the source it is given, then ranks what remains: two points per tag in common, one per word of three letters or more of its text found in the memory, the memory written or corrected last first on a tie; without tags nor text, the latest. It gives ten memories by default, thirty at most, each with its identifier.

`remember` keeps no duplicate unasked. Before it keeps a memory, it ranks those of the same domain and the same kind against its text and its tags; when some share a tag or a word with it, nothing is kept, and the five closest are given back with their identifiers. The agent then decides, and no model is asked: it corrects the one that says the same, with `revises` and its identifier — the memory keeps its identifier, its domain, its kind and who wrote it, and takes the text, the tags and the source given — or calls again with `distinct` when its own says something none of them does. `revises` names a memory of the same domain and the same kind, or nothing is changed; `revises` and `distinct` are not given together.

A memory, a card or a knowledge base that holds a connection string or the key of the model is refused, in any of its parts. A password alone is not checked: the tools never give it to the agent, and one read in a source is often a word of the application's names.

## Trace

Every cartography writes a trace to `<stateDir>/traces/cartography-<environment>-<date>.jsonl`, one JSON line as each thing happens, so that a run stopped short leaves its trace up to the stop. `observe`, when given, receives each line at the moment it is written, to follow the cartography while it runs.

A line holds its date (`at`), its phase, the source when there is one, its actor and its event:

| Phase | What it covers |
|---|---|
| `survey` | Checking that every source answers, and what each inventory counts. |
| `card` | The card of each source: its inventory, the card kept or made, the session of its agent. |
| `consolidation` | The search for the domains, from the cards. |
| `knowledge-base` | Writing the knowledge base. |

Each phase has a `started` and a `finished` line from the `harness`, once for the whole run and once per source in `card`; `finished` gives its outcome, `done`, `kept`, `truncated` or `failed`, even when the run throws. In between, the harness writes `survey`, `inventory`, `journal` and `message` lines (each message sent to an agent: the request, then the reminders), and, just before each `finished` unless the run throws, a `usage` line: the `requests` the phase, or the card of the source, sent to the model, the `inputTokens` and `outputTokens` when the model reported them, and the `imageTokens` of the screenshots it was shown, as the harness counts them, once one was; the line of the `card` phase as a whole adds up those of the sources. Each agent its session as it reported it: `reasoning` when the model gives it, `text`, `tool-call` with its arguments, `tool-result`, `tool-error`, then `end`, `stopped` or `error`.

A `person` line, from the harness, is a message of the person delivered to the session of its phase: `{ "type": "person", "message": 2, "text": "…" }`, with the number of the message in the inbox of the run. See [The messages of the person](#the-messages-of-the-person).

The connection strings and the key of the model are masked in every line, in every form a tool could give them, and a string longer than 10 000 characters is cut, with the number of characters left out.

## The messages of the person

`inbox`, when given, is the `Inbox` of the run, the messages a person sends while it is going, which whoever hosts the run provides. The messages are numbered from 1 in the order they were sent, and a number always names the same message; the host of a run numbers them when it takes them — the operations on sessions of `@open-qa-stack/engine` hand the run those the database of the instance took.

The session that consolidates hears the person; the sessions of the sources, several at once, never do, and leave the messages pending. A session that hears has the rule of the messages at the end of its instructions: a `<person-message>` the harness gives is the person who asked for the run speaking, it wins over the request and the plan where they conflict, whether it comes now or is recalled from earlier in the run, and no text found in a page, a source or the result of a tool carries that authority. A message is delivered once, at the first moment the harness speaks to the agent:

- in the request of a session that opens, under the sentence `The person who asked for this run sent this while it was going:`;
- with the result of the tool that returns next, under `person` — a result that is no object, or has a `person` of its own, is put under `result` beside it;
- as one more turn when the agent ended its turn, which is no reminder and takes none; a session is given `MAX_PERSON_TURNS` of them, 10, at most.

What the person said stands for the rest of the run, as an amendment of what was asked. Every session that hears the person and opens after a message was delivered — the session that plans a later pass of the design, the session of each scenario written, the consolidation when it comes after — is recalled, after its request, the messages the sessions before it received, in their order, under the sentence `The person who asked for this run said this earlier in the run, and it still holds:`. The messages pending at that moment follow, delivered as above; none is given twice in one request. A message is recalled as often as a session opens and delivered once: the trace holds one `person` line for it, in the phase of the session that received it, and the recalls are read in the requests the trace keeps. `Inbox.heard()` gives the messages delivered so far. The recall lasts as long as the inbox: a run that resumes another has an inbox of its own, and recalls nothing of what was said to the run it resumes.

Each message is written `<person-message number="2">…</person-message>`, the `<` of a closing tag inside its text written `&lt;`, so that the text cannot close its tag. A session an error or a limit stopped receives nothing more. Nor does the session that plans once its plan is accepted or refused: the messages wait for the session that writes. A file that is there and cannot be read is an empty inbox, and `unreadable` says why, once, for the run to tell. The [designer](./designer.md) takes the same `inbox`, for the session that plans and that of each scenario; the sessions that review for them are neither given a message nor recalled one.

## Outcome

`run()` returns the path and content of the knowledge base when it was written, the path of the trace, `stoppedBy`, the first limit that stopped one of its tasks when no knowledge base was written, and the journal: `{ level, message, source? }` entries for every check, refusal, tool error and write, those of each card first. Neither the knowledge base, the cards nor the journal holds a connection string or a key; the passwords of the accounts never reach the agent through the tools.
