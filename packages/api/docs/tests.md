# Tests

The tests of an instance are the Playwright tests of its test repository, whoever wrote them: a design of the agents, or a person. The API lists them as their files are now, read at each call under the folder of the applications of the configuration in force (`repository.appsDir`, `apps` by default). Nothing is kept: a test added, changed or removed in the repository is listed so at the next call. The route is the operation of the engine that reads them, said in HTTP. The web console lists the tests through it.

The shape of the body is the type `RepositoryTestList` of `@open-qa-stack/domain/sessions`. A client ignores a field it does not know.

| Route | Answer |
|---|---|
| `GET /api/tests` | The tests of the test repository, in the order of their paths. |

The answer is given with `cache-control: no-store`.

## The tests of the repository

```http
GET /api/tests
```

```json
{
  "items": [
    {
      "path": "apps/policy-management/tests/policies/policy-detail/policy-detail-nominal.spec.ts",
      "title": "Display the detail of a policy",
      "steps": ["1. Open the policy of the customer"],
      "tags": ["@level-functional", "@domain-policies", "@feature-policy-detail", "@app-policy-management", "@kind-functional", "@case-nominal", "@data-read"],
      "applications": ["policy-management"],
      "level": "functional",
      "domain": "policies",
      "feature": "policy-detail",
      "kind": "functional",
      "case": "nominal",
      "data": "read"
    }
  ]
}
```

A test is each file whose name ends with `.spec.ts` or `.test.ts` under the folder of the applications, but those of `node_modules`. Its `title` is that of its first `test(…)`, its path when it has none, and its `steps` the titles of its `test.step(…)`, in order.

What a test is, beyond its file, is what its tags say of it, each `@<prefix>-<value>` as the harness writes them from the scenario of the test:

| Field | Tag | Values the harness writes |
|---|---|---|
| `applications` | `@app-…`, each once | the applications the test acts on; several for a test that crosses them |
| `level` | `@level-…` | `smoke`, `functional`, `business`, `cross-application`, `end-to-end` |
| `domain` | `@domain-…` | a domain of the knowledge of the applications |
| `feature` | `@feature-…` | a functionality of that domain |
| `kind` | `@kind-…` | `functional`, `visual`, … |
| `case` | `@case-…` | `nominal`, `negative` |
| `data` | `@data-…` | `read`, `write` |

The first tag of a prefix counts. A test without a tag of a prefix has no such field; a test written by hand may have none of them. `tags` gives every tag as the file does, those of other prefixes too.

An instance without a test repository, or before a revision of its configuration is in force, lists no test.
