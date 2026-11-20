# Knowledge

The knowledge sources of an instance — the contracts, the databases, the documents, the source code and the logs its agents read — are declared in [its configuration](configuration.md), each with its attachments to the applications and their environments. A source of `type` `document` declared `"stored": true` holds documents uploaded to the instance rather than files of the test repository: the database of the instance keeps them, and only it. The API lists the documents of such a source, takes an upload, serves one and removes one. Each route is one of [the operations on documents](../../engine/docs/engine.md#the-operations-on-documents) of the engine, said in HTTP. The web console uploads documents through these routes.

The shapes of every body are the types of `@open-qa-stack/domain/sessions`. A client ignores a field or a value it does not know.

| Route | Answer |
|---|---|
| `GET /api/knowledge/:source/documents` | The documents of the source, without their texts. |
| `POST /api/knowledge/:source/documents` | Uploads documents to the source. |
| `GET /api/knowledge/:source/documents/:name` | A document, with its text. |
| `DELETE /api/knowledge/:source/documents/:name` | Removes a document. |
| `GET /api/knowledge/domains` | [The domains of the knowledge](#the-domains-of-the-knowledge), as the cartography named them. |

`:source` is the identifier of the source in the configuration in force, and `:name` the file name of a document, both encoded as a path segment. The two reads are answered with `cache-control: no-store`. Every answer that is not a success is a [problem](sessions.md#problems).

## The domains of the knowledge

```http
GET /api/knowledge/domains
```

The answer lists the domains of the index the last cartography wrote in the test repository, in its order, each with its `id`, its `label` and its `description`: what [a session may be kept to](sessions.md#opening-a-session). It lists none before a cartography, without a test repository, or when the index cannot be read. It is answered with `cache-control: no-store`.

## A source of documents

A source takes documents once the revision in force of the configuration declares it, for instance:

```json
{ "id": "underwriting-guides", "type": "document", "stored": true, "attachments": [{ "application": "policy-management" }] }
```

The declaration is a change of the configuration like any other, saved first with `POST /api/configuration/revisions`; the documents are uploaded to it next. A source removed from the configuration takes no more upload and serves none, but its documents stay in the database with its identifier: declared again under that identifier, it finds them again.

When a session runs, the documents of each such source are written to `<stateDir>/documents/<id>/` of the test repository, and the agents read them there, as they read a folder of documents of the repository.

## The documents of a source

```http
GET /api/knowledge/underwriting-guides/documents

HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
cache-control: no-store

{"items":[{"name":"claims.md","bytes":5120,"uploadedAt":"2026-11-18T09:12:45.120Z"},{"name":"quotes.md","bytes":2048,"uploadedAt":"2026-11-18T09:10:02.008Z"}]}
```

| Field | Value |
|---|---|
| `items` | Every document of the source, in the order of their names, code unit by code unit. |
| `items[].name` | Its file name, unique in its source. |
| `items[].bytes` | The size of its text in UTF-8. |
| `items[].uploadedAt` | When it was uploaded last, as an ISO 8601 date. |

```http
GET /api/knowledge/underwriting-guides/documents/quotes.md

HTTP/1.1 200 OK
cache-control: no-store

{"name":"quotes.md","bytes":2048,"uploadedAt":"2026-11-18T09:10:02.008Z","text":"# Quotes\n\n…"}
```

## Uploading documents

The body is `multipart/form-data`, each document a file part, whatever the name of its field; the file name of the part is the name of the document. It holds no other field.

```http
POST /api/knowledge/underwriting-guides/documents
content-type: multipart/form-data; boundary=x

--x
content-disposition: form-data; name="documents"; filename="quotes.md"
content-type: text/markdown

# Quotes
…
--x--

HTTP/1.1 201 Created

{"items":[{"name":"claims.md",…},{"name":"quotes.md",…}]}
```

The answer is the documents of the source as they are now. An upload is kept whole or not at all, and a document of a name the source holds replaces it. Its rules:

| Rule | What an upload holds |
|---|---|
| `no-documents`, `too-many-documents` | One document at least, 20 at most. |
| `document-name` | A file name of 200 characters at most, which does not start with a dot and holds no slash, backslash or control character. |
| `document-format` | A Markdown document, its name ending with `.md` or `.markdown`, whatever its case: the agents read Markdown. |
| `duplicate` | Each name once. |
| `document-size` | 1,000,000 bytes at most a document: the largest file the agents read. |
| `document-encoding` | Text in UTF-8; a byte order mark is left out. |

An upload that breaks one is refused with `422` `invalid_documents`, which bears `errors`, each with its `path` — `/documents/<rank>`, the rank of the file part from 0, or `""` for the upload — its `rule` and its `message`, as the errors of a configuration are: a client shows each beside its file. The API reads no file further than one byte past the largest document, and stops past the most an upload holds.

## Removing a document

```http
DELETE /api/knowledge/underwriting-guides/documents/quotes.md

HTTP/1.1 204 No Content
```

## Problems

| Code | Status | When |
|---|---|---|
| `invalid_request` | `400` | The upload is not a `multipart/form-data` body of file parts: another media type, a field, or a body cut short. |
| `unknown_document_source` | `404` | The configuration in force declares no source of that identifier whose documents the instance keeps: none at all, one of another type, or documents of the repository. The detail says how to declare one. |
| `unknown_document` | `404` | The source holds no document of that name. |
| `invalid_documents` | `422` | The upload breaks a rule of the documents. The problem bears `errors`, each at its document. |
| `unavailable` | `503` | The database cannot be reached. |

## What the routes call

| Route | Operation |
|---|---|
| `GET /api/knowledge/:source/documents` | `list(source)` |
| `POST /api/knowledge/:source/documents` | `upload(source, files)`, then `list(source)` |
| `GET /api/knowledge/:source/documents/:name` | `read(source, name)` |
| `DELETE /api/knowledge/:source/documents/:name` | `remove(source, name)` |

The files of an upload are read by [`@fastify/multipart`](https://github.com/fastify/fastify-multipart), the plugin of Fastify that parses multipart bodies, each into memory.
