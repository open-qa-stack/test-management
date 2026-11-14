# Source manifest

The manifest of a source lists the elements the harness exported from it without the model, each with the fingerprint and the file of its definition. The cartographer of a source writes it at `<indexDir>/sources/<id>/manifest.json` (`.oqas/index/sources/<id>/manifest.json` by default), beside the `export/` folder it describes, when it writes the export. Only a source that has an export has a manifest: a database. Its JSON Schema is `schema/oqas-source-manifest.schema.json`; `validateSourceManifest` applies it, then refuses an element named twice.

| Key | Content |
|---|---|
| `formatVersion` | `1`, the version of the format. |
| `source` | `id` of the knowledge source and its `type` (`openapi`, `postgresql`, `document`, `source-code`, `web`). |
| `fingerprint` | `sha256:` and a digest of the fingerprints of the elements, in their order: the fingerprint of the source when it was exported. |
| `producedAt` | Date and time of production, ISO 8601 in UTC. |
| `status` | `complete`, or `truncated` when the harness read only part of the source. |
| `elements` | Each element exported, in the order of the export. |

An element has its `name`, exactly as the source gives it and unique in the manifest, its `kind` in one word of the source (`table`, `view` or `routine` for a database), the `fingerprint` of its definition — an element whose fingerprint is the same did not change — and the `file` of its definition, as a path relative to the folder of the manifest, with forward slashes.

The manifest is written by the harness alone and holds no secret: the connection strings and the key of the model are masked in it as in the export.

[examples/source-manifest/orders-db.json](../examples/source-manifest/orders-db.json) is the manifest of a fictitious base.
