# Source manifest

The manifest of a source lists the elements the harness exported from it without the model, each with the fingerprint and the file of its definition, and where the grouping of the source left it. The cartographer of a source writes it at `<indexDir>/sources/<id>/manifest.json` (`.oqas/index/sources/<id>/manifest.json` by default), beside the `export/` folder it describes: once when it writes the export, then when the workflow of the source is over. Only a source that has an export has a manifest: a database. Its JSON Schema is `schema/oqas-source-manifest.schema.json`; `validateSourceManifest` applies it, then refuses a domain or an element named twice, and an element in a domain the manifest does not have.

| Key | Content |
|---|---|
| `formatVersion` | `1`, the version of the format. |
| `source` | `id` of the knowledge source and its `type` (`openapi`, `postgresql`, `document`, `source-code`, `web`). |
| `fingerprint` | `sha256:` and a digest of the fingerprints of the elements, in their order: the fingerprint of the source when it was exported. |
| `producedAt` | Date and time of production, ISO 8601 in UTC. |
| `status` | `in_progress` while an element is not settled or a domain has no file yet; `truncated` when the harness read only part of the source, left an element unplaced, wrote a domain file itself, or found an element no file names; `complete` when every element is set aside or in a domain whose file, written by the model, names it. |
| `domains` | The functional domains made while the elements were grouped: `id` (an English slug, unique), `label`, a one-sentence `description`; then, once its file is written, `file`, its path relative to the folder of the manifest, `writtenBy`, `model` or `harness`, and `refused`, why the harness wrote it itself. |
| `elements` | Each element exported, in the order of the export. |

An element has its `name`, exactly as the source gives it and unique in the manifest, its `kind` in one word of the source (`table`, `view` or `routine` for a database, `operation` or `schema` for a contract), the `fingerprint` of its definition — an element whose fingerprint is the same did not change — and the `file` of its definition, as a path relative to the folder of the manifest, with forward slashes. Once the grouping settled it, it has one of:

- `domain` and `role`: the domain it was placed in, and what it holds or does in one line; an element in a domain always has its role;
- `dismissed`: why the model set it aside, in no domain;
- `unplaced`: why the harness stopped asking for its place. Nothing is lost: the element stays in the manifest with its reason, and a later run places it.

The manifest is written by the harness alone and holds no secret: the connection strings and the key of the model are masked in it as in the export.

`validatePlacementSubmission` applies the schema of what the model hands in for a batch of elements, `placementSubmissionSchema`: the new `domains`, and `items`, each a `name` with a `domain` and a `role`, or with a `reason`. The harness checks what a submission places, element by element.

[examples/source-manifest/orders-db.json](../examples/source-manifest/orders-db.json) is the manifest of a fictitious base.
