# Domain index

The cartographer writes the domain index of an application in the test repository, at `<indexDir>/domain-index.json` (`.oqas/index/domain-index.json` by default). It tells the test designers where to look for each functional domain; it holds coarse references only, never a mapping operation by operation, column by column, or between a screen, an operation and a table. Its JSON Schema is `schema/oqas-domain-index.schema.json`; `validateDomainIndex` applies it, then the rules that span the document.

| Key | Content |
|---|---|
| `formatVersion` | `1`, the version of the format. |
| `producedAt` | Date and time of production, ISO 8601 in UTC. |
| `environment` | Name of the environment explored. |
| `model` | `provider`, `baseUrl` and `model` of the model used; never a key. |
| `run` | `iterations`, `actions` and `durationMs` the run used, as the harness measured them. |
| `status` | `complete`, or `truncated` when a limit stopped the task or a source was not read. A `complete` index has every source read. |
| `sources` | Each source of the run: `id` (a knowledge source, or an application for its user interface), `type` (`openapi`, `postgresql`, `document`, `source-code`, `web`) and `state` (`read`, `not_read`). |
| `domains` | Each domain: `id` (an English slug, unique), `label`, a one-sentence `description`, and `references`, a list of `{ source, items }`. |
| `unassigned` | What was read but put in no domain, as `{ source, items }`. |

Items are tags or path prefixes for a contract, `schema.table` for a base, URL paths for a user interface, section titles for a document, folders or files for source code. Every reference names a source of the index.

## Placement

Before an index is written, `placementErrors` checks the domains and `unassigned` against what the harness read itself, without the model: every tag of each contract — or the first path segment of an operation without tag — and every table of each base appears in a domain or in `unassigned`, and no item is given for such a source that it does not have. References to other sources are free.

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
    { "id": "orders-api", "type": "openapi", "state": "read" },
    { "id": "orders-db", "type": "postgresql", "state": "read" },
    { "id": "storefront", "type": "web", "state": "read" },
    { "id": "order-specs", "type": "document", "state": "read" }
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
