# Domain index

The cartographer writes the domain index of an application in the test repository, by consolidating the [cards](source-card.md) of its sources, at `<indexDir>/domain-index.json` (`.oqas/index/domain-index.json` by default). It tells the test designers where to look for each functional domain; it holds coarse references only, never a mapping operation by operation, column by column, or between a screen, an operation and a table. Its JSON Schema is `schema/oqas-domain-index.schema.json`; `validateDomainIndex` applies it, then the rules that span the document.

| Key | Content |
|---|---|
| `formatVersion` | `1`, the version of the format. |
| `producedAt` | Date and time of production, ISO 8601 in UTC. |
| `environment` | Name of the environment explored. |
| `model` | `provider`, `baseUrl` and `model` of the model used; never a key. |
| `run` | `iterations`, `actions` and `durationMs` the run used, as the harness measured them. |
| `status` | `complete`, or `truncated` when a limit stopped the task, a card is truncated or a source was not read. A `complete` index has every source read. |
| `sources` | Each source of the run: `id` (a knowledge source, or an application for its user interface), `type` (`openapi`, `postgresql`, `document`, `source-code`, `web`), `state` (`read` when it has a card, `not_read` otherwise) and, for a source read, `cardFingerprint`: `sha256:` and a digest of the card it was read from, so that an index whose cards have not changed since is known to be up to date. A source not read has no `cardFingerprint`. |
| `domains` | Each domain: `id` (an English slug, unique), `label`, a one-sentence `description`, and `references`, a list of `{ source, items }`. |
| `unassigned` | The elements of the cards put in no domain, as `{ source, items }`. |

Items are the elements of the cards: tags or path prefixes for a contract, `schema.table` for a base, screen paths for a user interface, section titles for a document, folders for source code. Every reference names a source of the index.

## Placement

Before an index is written, `placementErrors` checks the domains and `unassigned` against an inventory of items by source: every item of each source inventoried appears in a domain or in `unassigned`, and no item is given for such a source that it does not have. The cartographer gives it the elements of each card.

## Example

An excerpt of [examples/domain-index/domain-index.json](../examples/domain-index/domain-index.json), which describes a fictitious shop, with one of its two domains:

```json
{
  "formatVersion": 1,
  "producedAt": "2026-11-13T09:30:00Z",
  "environment": "local",
  "model": { "provider": "openai", "baseUrl": "http://localhost:1234/v1", "model": "local-model" },
  "run": { "iterations": 24, "actions": 31, "durationMs": 412000 },
  "status": "complete",
  "sources": [
    { "id": "orders-api", "type": "openapi", "state": "read", "cardFingerprint": "sha256:235a34306ef94a36e7b700d6f71ec8348621418e8dedbd65429162f31a1e2d71" },
    { "id": "orders-db", "type": "postgresql", "state": "read", "cardFingerprint": "sha256:3496bdf970420909df73d7e3067da98b0ff9f373819fa4c89f1a6cc68c3c2084" },
    { "id": "storefront", "type": "web", "state": "read", "cardFingerprint": "sha256:c6a9a4e6cd25229fca050c5bc87d0da377c01f18b3ceadf9a57754a7d6090ab8" },
    { "id": "order-specs", "type": "document", "state": "read", "cardFingerprint": "sha256:668a09bb5cabc59117e06131331d90dda14b976de35cbe617f045bcda72ac051" }
  ],
  "domains": [
    {
      "id": "orders",
      "label": "Orders",
      "description": "Placing, paying and following an order.",
      "references": [
        { "source": "orders-api", "items": ["orders", "payments"] },
        { "source": "orders-db", "items": ["public.orders", "public.order_lines"] },
        { "source": "storefront", "items": ["/cart", "/checkout", "/orders"] },
        { "source": "order-specs", "items": ["Placing an order"] }
      ]
    }
  ],
  "unassigned": [{ "source": "orders-db", "items": ["public.schema_migrations"] }]
}
```
