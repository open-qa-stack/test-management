# Source card

The card of a source groups its elements by functional domain, so that agents find their way in it without reading the source again. The cartographer of a source writes it at `<indexDir>/sources/<id>.json` (`.oqas/index/sources/<id>.json` by default); the cartographer of the application consolidates the cards into the [domain index](domain-index.md). Its JSON Schema is `schema/oqas-source-card.schema.json`; `validateSourceCard` applies it, and `validateSourceCardSubmission` the schema of what an agent hands in.

| Key | Content |
|---|---|
| `formatVersion` | `1`, the version of the format. |
| `source` | `id` (a knowledge source, or an application for its user interface) and `type` (`openapi`, `postgresql`, `document`, `source-code`, `web`). |
| `fingerprint` | `sha256:` and a digest of the source when the card was made; a complete card whose fingerprint is the source's is up to date. |
| `producedAt` | Date and time of production, ISO 8601 in UTC. |
| `model` | `provider`, `baseUrl` and `model` of the model used; never a key. |
| `run` | `iterations`, `actions` and `durationMs` the task used. |
| `status` | `complete`, or `truncated` when a limit or the session cut the task. |
| `domains` | Each domain: `id` (an English slug, unique), `label`, a one-sentence `description`, and `items`. |
| `unassigned` | Names of the elements put in no domain. |

An item has its `name`, exactly as the source gives it, a one-sentence `summary`, its `keyFields` when the agent chose some, and the `facts` the harness read without the model: the keys of a table, the operations of a tag, the number and level of a section, the files and routes of a folder, the title and links of a screen. An agent hands in no facts.

[examples/source-card/orders-db.json](../examples/source-card/orders-db.json) is the card of a fictitious base.
