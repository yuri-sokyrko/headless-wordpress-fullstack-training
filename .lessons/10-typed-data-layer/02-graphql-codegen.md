---
title: 'GraphQL Codegen'
module: 10
lesson: 2
teaches: [graphql-codegen, client-preset, committed-generated-code, schema-as-contract, codegen-check]
produces: ['next-app/codegen.ts', 'wordpress-headless/schema.graphql', 'next-app/src/gql/', 'next-app/src/graphql/incidents.graphql']
requires: [10.1, 9.3]
---

# Lesson 10.2 — GraphQL Codegen

## Quick Overview

This is the lesson that deletes `src/types/graphql-responses.ts`. Every hand-written response
type from Lesson 09.3 goes in one commit, replaced by types generated from the `schema.graphql`
you committed in Module 06. From here on, a type describing WordPress data is derived from the
schema by a tool, or it does not exist. If the schema says `downtimeMinutes: Float` and
therefore nullable, your type says `number | null`, and the bug you shipped in Lesson 09.3
becomes a compile error instead of a 500.

Two configuration decisions carry the weight. First, codegen reads the **committed
`schema.graphql` file**, not a live introspection query against WordPress — which means CI can
regenerate and diff types with no running WordPress, no database and no credential of any kind.
Second, `src/gql/` is **committed**. Generated code in git feels wrong for about a day, until
you notice that `npm run codegen:check` failing in CI is a much better experience than a build
that mysteriously depends on a container being up. Refreshing the schema becomes a deliberate
human action, `npm run schema:pull`, whose diff gets reviewed like any other change — which is
exactly what you want when someone activates a plugin that adds forty types.

By the end of this lesson you will have:

- `next-app/codegen.ts` using the `client-preset`, reading `wordpress-headless/schema.graphql`
- `wordpress-headless/schema.graphql` — the Module 06 schema, committed, plus an `npm run schema:pull` script that refreshes it
- `next-app/src/gql/` — generated and committed, with a header comment telling future you not to edit it
- `next-app/src/graphql/incidents.graphql` and siblings — the first `.graphql` documents, no longer inline template strings
- `src/types/graphql-responses.ts` deleted, and `npm run codegen:check` wired into `package.json` for Module 24's CI gate

## Classic WP Analogy

You already run a generated-artifact-in-git workflow, and you already know why it is worth it:
**SCF Local JSON**. The field group is defined once, saved to `includes/acf-json/`, and every
environment derives from that file instead of from a database table someone edited in
production at 2am. The content model becomes code — diffable, reviewable, deployable — and the
class of bug where staging and production disagree about a field name simply stops existing.

| SCF Local JSON | GraphQL Codegen |
|---|---|
| Field groups defined once, stored as JSON in git | Schema defined once, `schema.graphql` in git |
| Every environment reads the same file | Every build reads the same file |
| No DB export/import step on deploy | No live WordPress needed in CI |
| A field rename shows up as a reviewable diff | A schema change shows up as a reviewable diff |
| `acf-json/` is committed even though SCF wrote it | `src/gql/` is committed even though codegen wrote it |

The parallel is close enough that the objection is the same one too. "Why would I commit a file
a tool generates?" Because the alternative is a build step that depends on a running service,
and because the diff is the review surface: when `src/gql/` changes by nine hundred lines,
somebody should look at why.

The analogy breaks on direction of authorship, and the break matters day to day. `acf-json/`
files are written by SCF but read and sometimes hand-edited by you — they are a source of
truth. `src/gql/` is the opposite: it is a **derived artifact**, it is never edited by hand, and
your editor should treat it as read-only. Edit it and the next `npm run codegen` silently
reverts you. The second break: SCF Local JSON is the model itself, whereas codegen output is a
*projection* of a model that lives in WordPress. If someone activates a plugin that changes the
schema and nobody runs `npm run schema:pull`, your types are confidently, silently stale — the
Lesson 09.3 failure mode returning through a different door. `npm run codegen:check` in CI is
what closes it, and
[appendix 04 §7](../appendix/04-env-reference.md#7-secret-injection-per-target) explains why
the check is designed to need no credentials at all.

---

## Key Concepts

### 1. What codegen is, and what it is not

GraphQL Code Generator reads two inputs and writes one output. It reads a **schema** — SDL, from
a file or from an introspection endpoint — and a set of **documents**, the operations and
fragments your app sends. It writes TypeScript.

```
   wordpress-headless/schema.graphql        next-app/src/graphql/*.graphql
   (SDL — what the server can answer)       (what THIS app actually asks)
                    │                                     │
                    └──────────────┬──────────────────────┘
                                   ▼
                        graphql-codegen --config codegen.ts
                                   │
                                   ▼
                          next-app/src/gql/
                          gql.ts · graphql.ts · index.ts
```

What it is **not**: a client, a runtime, or anything that talks to WordPress. Nothing in
`src/gql/` opens a socket. It is a compiler from two text files to a third, and every property
this lesson claims follows from that — CI needs no WordPress, generation is deterministic, and
running it with the container stopped works fine.

It also does not validate your data. It validates your **documents against the schema**, which
is a different and cheaper guarantee: it proves the field exists and has the type you are
reading it as. Whether the editor filled it in is a nullability question, and the answer is
usually "no", which is why generated SCF types are nullable everywhere.

### 2. The `client-preset`, and the files it emits

Codegen has dozens of plugins. Assembling them yourself is a fun afternoon that you can skip:
the **`client` preset** is the maintained, opinionated bundle for exactly this case, and it is
what the Guild recommends for a React app.

| File | Emitted when | What is in it |
|---|---|---|
| `graphql.ts` | always | every schema type, every operation's result and variables type, and a `…Document` constant per operation and fragment |
| `gql.ts` | always | the `graphql()` tag — a function that maps an inline query **string** to the document in `graphql.ts` |
| `index.ts` | always | the barrel re-export |
| `fragment-masking.ts` | only when `fragmentMasking` is on | `FragmentType`, `getFragmentData`, `useFragment` |

This course sets `fragmentMasking: false`, so you get **three** files, not four. If you see
`fragment-masking.ts` appear later, someone changed `codegen.ts`.

The part that matters for Lesson 10.1: `graphql()` returns a **`TypedDocumentNode`**, and so
does every generated `…Document` constant. That is precisely the type `fetchGraphQL` was written
to accept, which is why the two lessons fit together with no adapter:

```ts
// (illustration) — the whole integration, in two lines
import { IncidentsListDocument } from '@/gql/graphql';
const data = await fetchGraphQL(IncidentsListDocument, { first: 12 });
```

> **The `graphql()` tag only knows strings it found inside your TypeScript.** It is a lookup
> table keyed on the exact source text of an inline query. An operation that lives in a
> `.graphql` file is not in that table — you reach it through its generated `…Document`
> constant instead. Both are typed identically; they are two doors to the same room. Key
> Concept 8 picks between them, with a verdict.

### 3. Codegen reads the committed schema, not a live WordPress

`codegen.ts` points at `../wordpress-headless/schema.graphql` — a **file**, produced in Lesson
06.3 by `wp graphql generate-static-schema` and committed.

The alternative that every tutorial shows is `schema: 'http://localhost:8080/graphql'`, which
introspects a live server. Compare the two on the axis that actually costs money:

| | Live introspection | **Committed SDL file** |
|---|---|---|
| CI needs WordPress running | yes | **no** |
| CI needs a database | yes | **no** |
| CI needs any credential | yes, if introspection is protected | **no, ever** |
| A plugin activation changes your types | silently, on the next generate | only when a human runs `schema:pull` |
| The change is reviewable | no | **yes — it is a diff** |
| Verdict | ❌ | ✅ |

The third row is the one to internalise:
[appendix 04 §7](../appendix/04-env-reference.md#7-secret-injection-per-target) states it as a
rule of this project — **no CI job in this course ever holds a WordPress credential.** That is
not a convenience. Every secret that exists in a CI environment is a secret that can leak from
a CI environment, and this architecture simply does not create the need.

The cost, stated plainly: the file can go stale. Someone activates WPGraphQL Yoast SEO,
WordPress gains forty types, and your `schema.graphql` says otherwise — confidently, silently,
exactly the Lesson 09.3 failure mode arriving through a different door. Key Concept 6 is the
gate that closes it and Key Concept 7 is the deliberate human action that refreshes it.

### 4. `src/gql/` is committed, and that is not a mistake

The Quick Overview set up the parallel: SCF Local JSON is a generated artifact you commit, and
you already believe in it. Same argument, same shape.

| Reason | Detail |
|---|---|
| The build stops depending on a service | `npm run build` works on a laptop with Docker closed |
| The diff is the review surface | a field rename shows up in a pull request, not in an incident |
| CI gets a cheap staleness check | `codegen:check` is a regenerate-and-diff, no network |
| A fresh clone typechecks immediately | no "run this one command first" step nobody documents |

And the cost, which is real: **a nine-hundred-line diff nobody reads.** Adding one field to one
fragment can move `graphql.ts` by dozens of lines, and after the third time reviewers start
approving `src/gql/` changes on sight, at which point the review surface you were buying is
gone.

The mitigation is process, not tooling: put `src/gql/` in a separate commit from the change that
caused it, so the pull request has one commit a human reads and one commit a human skims. Write
that convention down in `docs/api-contract.md` alongside the naming rules — Lesson 10.5 adds to
the same file.

### 5. The opposite-rules pair, in one repository

Two directories in `next-app/src/` are both generated by a tool. They have **opposite** rules,
and mixing them up wastes an afternoon in each direction.

| | `src/gql/` (this lesson) | `src/components/ui/` (Lesson 11.2) |
|---|---|---|
| Written by | `graphql-codegen` | the `shadcn` CLI |
| In git | yes | yes |
| Hand-edited | **never** | **always, that is the point** |
| Regenerating it | routine, and expected to be a no-op | would destroy your work |
| If you edit it | the next `npm run codegen` silently reverts you | nothing, it is yours now |
| Mental model | a derived artifact | a scaffold you have adopted |

Write that distinction into `docs/api-contract.md` today. It is the single most common source of
"who deleted my change?" in a project that uses both, and the answer is always the same tool.

### 6. `npm run codegen:check` — stale types become a failing build

The gate is one command, and its job is to answer one question: **is what is committed in
`src/gql/` what the schema and the documents currently produce?**

```bash
# The script you will define in the Task
graphql-codegen --config codegen.ts && git diff --exit-code -- src/gql/
```

Regenerate, then ask git whether anything moved. `git diff --exit-code` exits non-zero when
there is a difference, which is exactly what a CI job needs.

> **Recent `@graphql-codegen/cli` releases also ship a `--check` flag** that reports whether
> output would change without writing it. This course does not use it, for two reasons that are
> worth more than the one saved command: the regenerate-and-diff form works on every CLI version
> you might have installed, and it checks something stronger — not "would codegen produce
> different output" but "**is the file we committed the output**". Those come apart the moment
> someone hand-edits `graphql.ts`, which Key Concept 5 says will happen.

What it needs: `node`, the repo, and nothing else. No WordPress, no database, no token. Module
24 wires it into the CI workflow next to `type-check` and `lint`; the reason it can be a
zero-secret job is Key Concept 3.

### 7. `npm run schema:pull` — a deliberate human action

Refreshing the schema is not automatic, on purpose. It is one script wrapping the Lesson 06.3
command pair:

```bash
cd ../wordpress-headless
docker compose run --rm wpcli wp graphql generate-static-schema \
  --output=/var/www/html/wp-content/plugins/blame-the-tech-core/schema.graphql
mv wp-content/plugins/blame-the-tech-core/schema.graphql schema.graphql
```

Three details, each of which has cost someone an hour:

**`--output` is not optional.** Without it, WP-CLI writes the schema to WPGraphQL's default
location inside the container — and the container was started with `--rm`, so Docker deletes it
seconds later. The command reports success and the file does not exist.

**The output path is inside the bind-mounted plugin directory**, which is why the `mv` on your
host can see it at all. The plugin directory is bind-mounted
([Lesson 02.2](../02-docker-mysql-and-infrastructure/02-the-compose-stack.md)); most of
`/var/www/html` is not.

**The `mv` is a separate command because the file belongs to WordPress, not to the plugin.**
WordPress owns the schema, so the snapshot lives at `wordpress-headless/schema.graphql`, and
`codegen.ts` reaches across the repository with a relative path. There is **no**
`schema.graphql` under `next-app/` and there never will be — Verification check 7 asserts it.

Then you read the diff. `git diff wordpress-headless/schema.graphql` is where you find out that
someone activated a plugin, that a field you use was deprecated, or that an SCF group changed
shape. That is a review, not a surprise.

### 8. Documents in `.graphql` files versus `graphql()` in TypeScript

Both are first-class. Pick one per project and be consistent.

| | `.graphql` file + `…Document` const | inline `graphql(\`…\`)` in the `.tsx` |
|---|---|---|
| Editor support | full — the GraphQL LSP validates against the schema as you type | good, via the `gql`-tag plugins |
| The document sits next to | its siblings, in `src/graphql/` | the component that renders it |
| Route file stays about | rendering | rendering **and** data shape |
| Auditable inventory of every query | `ls src/graphql/` | a `grep` across `src/` |
| Reached from TypeScript by | `import { XDocument } from '@/gql/graphql'` | the `graphql()` return value |
| Verdict | ✅ this course | ❌ not here |

The deciding argument is Lesson 10.5 and Module 21. `src/graphql/` becomes the app's query
inventory: one place where you can read every field this front end asks WordPress for, count
them, and delete the ones nobody renders. You cannot audit what is scattered across nineteen
route files.

The cost, stated plainly: one extra import, and the document is no longer in the file that uses
it, so understanding a route means opening two files instead of one.

### 9. Reading generated types without flinching

Codegen output is dense on purpose. Four constructs account for nearly all of it.

| Construct | Roughly | Why it exists |
|---|---|---|
| `Maybe<T>` | `T \| null` | every nullable schema field |
| `InputMaybe<T>` | `T \| null \| undefined` | an **input** may be omitted entirely, which is different from being null |
| `Scalars` | a lookup of scalar names to TS types | one place to remap `DateTime` to `Date`, if you ever want to |
| `Exact<{ … }>` | the object type, with excess properties rejected | passing an extra variable is a mistake, not a courtesy |

So the field that broke Lesson 09.3 generates as:

```ts
// next-app/src/gql/graphql.ts — generated (illustration)
export type IncidentDetails = {
  downtimeMinutes?: Maybe<Scalars['Float']['output']>;
  environment?: Maybe<IncidentEnvironment>;
};
```

`Scalars['Float']['output']` looks alarming and means `number`. Codegen splits each scalar into
an `input` and an `output` type because they legitimately differ — a `DateTime` you send may be
a string while the one you receive is parsed. For `Float` both sides are `number`.

Read that declaration back and notice what has become impossible. `downtimeMinutes` is
`number | null | undefined`. `.toFixed(0)` on it is a compile error. The Lesson 09.3 bug is not
"less likely" — it is unrepresentable, because the type came from the same file the server
generated its behaviour from. The Task makes you see that error before you fix it.

### 10. What codegen cannot give you: the closed sets that live in your data

This is the caveat that keeps "generated types replace hand-written types" honest, and it is
why `src/types/content.ts` **shrinks** in this lesson rather than disappearing.

The four `severity` term slugs are `s1-catastrophic`, `s2-major`, `s3-minor` and `s4-cosmetic`.
That set is closed:
[appendix 03 §2](../appendix/03-content-model-reference.md#2-taxonomies) locks the term UI to
radio buttons over exactly those four, created on plugin activation and never extended. But
WPGraphQL types a term's `slug` as **`String`**, because that is what a slug is in WordPress.
No amount of codegen will ever narrow it.

| Lives in the schema | Lives in your data |
|---|---|
| `IncidentEnvironment`, `IncidentResolutionStatus`, `TechReviewVerdict`, `LeadSource` — **registered GraphQL enums** ([appendix 03 §3](../appendix/03-content-model-reference.md#3-registered-graphql-enums)) | the four `severity` slugs — **taxonomy terms** |
| Codegen emits a union | codegen emits `string` |
| Deleted from `content.ts` this lesson | **kept** in `content.ts`, by hand |

So the rule, and it is worth writing on something: **codegen owns the shape of the response; you
still own the closed sets that live in your content.** `SeverityLevel`, `SEVERITY_LABEL` and a
new `SEVERITY_ORDER` survive for exactly that reason, and Module 12 unit-tests the ordering
because a hand-asserted invariant is precisely the kind of thing a test should hold down.

> **This is also the argument for registering real GraphQL enums in PHP.** Lesson 06.1 made
> `environment` an enum rather than letting the SCF select value through as a bare string, and
> the payoff arrives here: one of those two modelling choices produces a TypeScript union for
> free and the other leaves you maintaining a union by hand. When you design a schema, you are
> choosing how much your front end will have to assert.

---

## Task

### Step 1: Check licences, install the two dev packages

```bash
cd next-app

npm view @graphql-codegen/cli license
# Expected: MIT
npm view @graphql-codegen/client-preset license
# Expected: MIT

npm install --save-dev @graphql-codegen/cli @graphql-codegen/client-preset
```

Dev dependencies, both: nothing in the running app imports either one. `graphql` itself is
already a runtime dependency from Lesson 10.1, which is what the preset needs as a peer.

**Verify §1:**

- [ ] Both licences are `MIT`.
- [ ] `npm ls graphql` still shows **one** version. Two copies is the classic cause of
      "Cannot use GraphQLSchema from another module or realm".

### Step 2: Write `codegen.ts`

```ts
// next-app/codegen.ts
// Generated output lands in src/gql/ and is NEVER hand-edited.
// Regenerate with `npm run codegen`. Verify with `npm run codegen:check`.
// Refresh the schema itself with `npm run schema:pull` — a deliberate, reviewed action.
import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  overwrite: true,

  // A FILE, not an endpoint. WordPress owns the schema, so the snapshot lives with
  // WordPress; this reaches across the repository. There is no schema.graphql under
  // next-app/, and CI therefore needs no WordPress, no database and no credential.
  schema: '../wordpress-headless/schema.graphql',

  // Both document styles are scanned: .graphql files (this course's choice) and
  // graphql() calls inside TS/TSX. The negation stops codegen reading its own output.
  documents: ['src/**/*.graphql', 'src/**/*.{ts,tsx}', '!src/gql/**/*'],

  // The first run happens before any document exists. Without this it exits non-zero.
  ignoreNoDocuments: true,

  generates: {
    './src/gql/': {
      preset: 'client',
      presetConfig: {
        fragmentMasking: false,
      },
    },
  },

  config: {
    // `verbatimModuleSyntax` has been on since Lesson 07.3: a type-only import must
    // say so, or it survives into the emitted JavaScript.
    useTypeImports: true,
  },
};

export default config;
```

> **`fragmentMasking: false` is a teaching decision, and the right default for a large team is
> the opposite.** Masking makes a component physically unable to read a field its own fragment
> did not request, which is a genuinely good property once a codebase has forty components and
> six people. It buys that by putting an indirection — `getFragmentData()` — between you and
> your data, and meeting that indirection before you have understood what a fragment *is*
> reliably produces the conclusion that codegen is too complicated. Lesson 10.5 revisits it as
> a named option, with the conditions under which you would switch it on.

`codegen.ts` sits at the project root, so `tsconfig.json`'s `**/*.ts` include picks it up and
`npm run type-check` checks it. A typo in a preset name is a compile error before it is a
runtime one.

### Step 3: Wire the three scripts, and confirm the schema is current

```bash
npm pkg set "scripts.codegen=graphql-codegen --config codegen.ts"
npm pkg set "scripts.codegen:check=graphql-codegen --config codegen.ts && git diff --exit-code -- src/gql/"
npm pkg set "scripts.schema:pull=cd ../wordpress-headless && docker compose run --rm wpcli wp graphql generate-static-schema --output=/var/www/html/wp-content/plugins/blame-the-tech-core/schema.graphql && mv wp-content/plugins/blame-the-tech-core/schema.graphql schema.graphql"

npm pkg get scripts
```

Now confirm the snapshot from Lesson 06.3 is present and still matches WordPress:

```bash
wc -l ../wordpress-headless/schema.graphql
# Expected: a few thousand lines

npm run schema:pull
git diff --stat ../wordpress-headless/schema.graphql
```

**Verify §3:**

- [ ] `npm pkg get scripts` lists `codegen`, `codegen:check` and `schema:pull` alongside the
      Module 07 scripts. It is `type-check`, with a hyphen — do not add a `typecheck` alias.
- [ ] `git diff --stat` on the schema shows **no change**. If it shows one, read it: something
      changed in WordPress since Lesson 06.3 and you want to know what before you generate types
      from it.
- [ ] `ls schema.graphql` in `next-app/` fails. The schema does not live here.

### Step 4: Move the first documents into `src/graphql/incidents.graphql`

```bash
mkdir -p src/graphql
```

Both incident operations, taken from your scratch `queries.graphql` with the names unchanged:

```graphql
# next-app/src/graphql/incidents.graphql
# The /[locale]/incidents routes. Lesson 10.5 factors the repeated field set into
# a fragment and moves the detail query's extra fields with it.

query IncidentsList($first: Int!, $after: String, $search: String) {
  incidents(
    first: $first
    after: $after
    where: { status: PUBLISH, search: $search, orderby: { field: DATE, order: DESC } }
  ) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      databaseId
      title
      slug
      date
      blameScore
      severities(first: 1) {
        nodes {
          name
          slug
        }
      }
      scapegoats(first: 1) {
        nodes {
          name
          slug
        }
      }
      incidentDetails {
        downtimeMinutes
        environment
      }
    }
  }
}

# `id: $slug, idType: SLUG`. A bare `id:` carrying a slug returns null — Lesson 05.3.
query IncidentBySlug($slug: ID!) {
  incident(id: $slug, idType: SLUG) {
    id
    databaseId
    title
    slug
    date
    blameScore
    content
    severities(first: 1) {
      nodes {
        name
        slug
      }
    }
    scapegoats(first: 1) {
      nodes {
        name
        slug
      }
    }
    incidentDetails {
      occurredAt
      downtimeMinutes
      estimatedCostUsd
      environment
      resolutionStatus
      blameConfidence
      stackTrace
      reporterDisplayName
      isVerified
    }
  }
}
```

Only the two incident routes move in this lesson. The blog, reviews and scapegoats routes keep
their inline `untypedDocument` strings for now, because **Lesson 10.5 is the lesson that
restructures all of `src/graphql/`** and moving them twice is churn with no lesson attached.
Say which is which out loud so the half-migrated state is deliberate rather than forgotten.

### Step 5: Generate, and read what came out

```bash
npm run codegen
ls -la src/gql/
```

**Verify §5:**

- [ ] `src/gql/` contains `graphql.ts`, `gql.ts` and `index.ts`. **Three** files —
      `fragment-masking.ts` is absent because masking is off.
- [ ] `grep -n 'IncidentsListDocument' src/gql/graphql.ts` finds a `const` declaration.
- [ ] `grep -n 'IncidentsListQueryVariables' src/gql/graphql.ts` finds a type with `first`,
      `after` and `search`.
- [ ] Open `src/gql/graphql.ts` and find `downtimeMinutes`. It is
      `Maybe<Scalars['Float']['output']>`. Sit with that for a moment: nobody typed it.

### Step 6: Migrate the two incident routes

```tsx
// next-app/src/app/[locale]/incidents/page.tsx — replace the document and the import
import { fetchGraphQL } from '@/lib/graphql/client';
import { IncidentsListDocument } from '@/gql/graphql';

// …and inside the component:
//   const data = await fetchGraphQL(IncidentsListDocument, { first: 12 });
```

```tsx
// next-app/src/app/[locale]/incidents/[slug]/page.tsx — same three lines
import { fetchGraphQL } from '@/lib/graphql/client';
import { IncidentBySlugDocument } from '@/gql/graphql';

// …and inside the component:
//   const data = await fetchGraphQL(IncidentBySlugDocument, { slug });
```

Delete from both files: the `untypedDocument` import, the inline query template literal, and
the `import type { … } from '@/types/graphql-responses'`.

**Verify §6:**

- [ ] Hover `data`. It is `IncidentsListQuery`, generated, and you did not name it.
- [ ] `grep -rn 'untypedDocument' src/app/` returns nothing.
- [ ] `npm run type-check` reports errors — and that is correct. Step 7 is those errors.

### Step 7: Delete the hand-written types, then work the compile errors

This is the commit the module exists for. The list of hand-written types is the note Lesson 09.3
asked you to append to `docs/api-contract.md` — open it, and delete the file it describes.

```bash
git rm src/types/graphql-responses.ts
npm run type-check
```

Read every error. Each one is a place where a human's guess about WordPress was load-bearing.

| Error in | Fix |
|---|---|
| `src/app/[locale]/incidents/page.tsx` | already migrated in Step 6 — should be clean |
| `src/app/[locale]/blog/**`, `reviews/**`, `scapegoats/**` | still on `untypedDocument`; retype their manual argument to the generated `…Query` type from `@/gql/graphql` and delete the local response type. Lesson 10.5 finishes the move. |
| `src/components/incidents/IncidentCard.tsx` | props become `{ readonly incident: IncidentCardFieldsFragment }` after Lesson 10.5 generates that fragment; until then, `IncidentsListQuery['incidents']` narrowed to one node. The prop **name** does not change, so no call site moves. |
| `src/components/incidents/fixtures.ts` | retype to the generated node type and delete any fixture field the query does not select — if the query never asked for it, nothing renders it |
| `next-app/scripts/blame.ts` | it imports `Incident` and `Block` from `@/types/content`, and Step 7b removes both. Point it at `@/gql/graphql` instead; `tsx` honours the `@/*` path from `tsconfig.json`, so the alias resolves at runtime too |

Now the reduction of `content.ts`. Delete everything codegen derives from the schema —
`Incident`, `Scapegoat`, `TechReview`, `IncidentDetails`, `ScapegoatProfile`,
`TechReviewFields`, `Term`, `SeverityTerm`, `MediaItem`, `AcfMediaEdge`, `Connection`, `Edge`,
`PageInfo`, `TechReviewPro`, `TechReviewCon`, `IncidentCardFields`, `IncidentDraft`,
`BlameBoardData`, `Block` and the four enum unions. Keep exactly this, and replace the stale
Module 07 header comment while you are there — Lesson 07.4 told you to delete stale comments on
sight, and that one now promises something untrue:

```ts
// next-app/src/types/content.ts — what survives Lesson 10.2
// Lesson 10.2 deleted everything codegen derives from wordpress-headless/schema.graphql.
// What is left is the part codegen CANNOT produce: closed sets that live in the content,
// not in the schema. WPGraphQL types a term slug as String, so the severity union is a
// domain invariant the plugin enforces and the front end asserts. Module 12 tests it.

export type SeverityLevel = 's1-catastrophic' | 's2-major' | 's3-minor' | 's4-cosmetic';

// Exhaustive by construction: add a fifth severity term and this stops compiling.
export const SEVERITY_LABEL: Record<SeverityLevel, string> = {
  's1-catastrophic': 'S1 — Catastrophic',
  's2-major': 'S2 — Major',
  's3-minor': 'S3 — Minor',
  's4-cosmetic': 'S4 — Cosmetic',
};

// Ordering for the severity taxonomy. Not derivable from the schema: term order is
// editorial, and `slug` is a String on the wire. Module 12 unit-tests this.
export const SEVERITY_ORDER: readonly SeverityLevel[] = [
  's1-catastrophic',
  's2-major',
  's3-minor',
  's4-cosmetic',
];

/** Sort comparator for anything carrying a severity slug. Worst first. */
export function compareSeverity(a: SeverityLevel, b: SeverityLevel): number {
  return SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b);
}
```

Finally, delete `untypedDocument` from `src/lib/graphql/client.ts` — nothing calls it now, and
leaving a hole in the type system lying around is how it gets used again in eleven months.

**Verify §7:**

- [ ] `test ! -f src/types/graphql-responses.ts` succeeds.
- [ ] `grep -c 'untypedDocument' src/lib/graphql/client.ts` prints `0`.
- [ ] `npm run type-check` is silent.
- [ ] `grep -c 'export type' src/types/content.ts` prints `1`. One type, two constants, one
      function — and every one of them is something codegen could not have written.

### Step 8: Commit the generated output, in its own commit

```bash
git add src/gql/
git commit -m "chore(next): commit codegen output for the incidents documents"

git add -A
git commit -m "feat(next): typed GraphQL documents from the committed schema; delete hand-written response types"
```

Two commits, in that order, for the reason in Key Concept 4: the second one is the change a
reviewer reads, and the first one is the consequence they skim. Do **not** add `src/gql/` or
`wordpress-headless/schema.graphql` to `.gitignore`.

---

## Verification

```bash
cd next-app

# 1. Codegen runs clean and produces the three expected files
npm run codegen
ls src/gql/
# Expected: gql.ts  graphql.ts  index.ts
#           NOT fragment-masking.ts — masking is off in codegen.ts

# 2. The output is committed, so a fresh generate changes nothing
npm run codegen:check
# Expected: no output, exit 0. A diff here means someone hand-edited src/gql/
#           or forgot to commit it.

# 3. The generated output IS in git
git status --short src/gql/
# Expected: no output — tracked and clean
git ls-files src/gql/ | wc -l
# Expected: 3

# 4. Types are clean, and the deleted file is gone
npm run type-check
# Expected: no output
test ! -f src/types/graphql-responses.ts && echo "deleted"
# Expected: deleted

# 5. The drift-is-impossible proof: nobody typed this line
grep -n 'downtimeMinutes' src/gql/graphql.ts | head -2
# Expected: a line containing  Maybe<Scalars['Float']
#           i.e. number | null, derived from the schema's `Float`

# 6. What survives content.ts is only what codegen cannot produce
grep -c 'export ' src/types/content.ts
# Expected: 4   (SeverityLevel, SEVERITY_LABEL, SEVERITY_ORDER, compareSeverity)

# 7. NEGATIVE — the schema path points across the repo, and there is none here
grep -n 'schema:' codegen.ts
# Expected: schema: '../wordpress-headless/schema.graphql'
test ! -f schema.graphql && echo "correct: no schema in next-app"
# Expected: correct: no schema in next-app

# 8. NEGATIVE — the nullable field cannot be used as a number.
#    Append a deliberate mistake to a THROWAWAY file, watch it fail, delete it.
#    Not to content.ts: you reduced that file in Step 7 and have not committed yet,
#    so anything that restores it from git hands you back the Module 07 version.
cat > src/types/_drift-probe.ts <<'EOF'
// next-app/src/types/_drift-probe.ts
// TEMPORARY — proves the generated nullability is enforced. Deleted below.
import type { IncidentsListQuery } from '@/gql/graphql';
export function badFormat(q: IncidentsListQuery): string {
  return q.incidents?.nodes?.[0]?.incidentDetails?.downtimeMinutes.toFixed(0) ?? '';
}
EOF
npm run type-check 2>&1 | grep -c "possibly 'null'\|possibly 'undefined'"
# Expected: 1 or more. This is the Lesson 09.3 bug, now a compile error.
rm src/types/_drift-probe.ts
npm run type-check
# Expected: no output — clean again

# 9. NEGATIVE — codegen works with WordPress stopped. This is the whole argument
#    for committing the schema, executed rather than asserted.
docker compose -f ../wordpress-headless/docker-compose.yml stop wordpress
npm run codegen && echo "generated with WordPress down"
# Expected: generated with WordPress down
npm run codegen:check
# Expected: no output, exit 0
docker compose -f ../wordpress-headless/docker-compose.yml start wordpress

# 10. NEGATIVE — no route file still names a hand-written response type
grep -rn 'graphql-responses' src/ ; echo "exit=$?"
# Expected: no matches, exit=1

# 11. The app still works end to end
npm run build && npm run start & SERVER_PID=$!
sleep 6
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/incidents
# Expected: 200
kill "$SERVER_PID"
```

If check 9 fails, read the error before anything else: a codegen run that needs WordPress means
`codegen.ts` is pointed at an endpoint rather than at the file, and every claim this lesson made
about CI is void.

## Control Questions

1. `codegen.ts` reads `../wordpress-headless/schema.graphql` rather than
   `http://localhost:8080/graphql`. Name the three things a CI job therefore does not need, and
   the one new failure mode you have accepted in exchange.
2. `src/gql/` and `src/components/ui/` are both generated and both committed, and the rule for
   editing them is opposite. State each rule, and describe what happens if you get one of them
   backwards.
3. `npm run codegen:check` regenerates and then runs `git diff --exit-code`. Explain what that
   catches which a hypothetical "would the output change?" flag would not, and why that
   difference matters given Key Concept 5.
4. `SeverityLevel` survived the deletion and `IncidentEnvironment` did not. Explain the
   difference in terms of where each closed set is enforced, and say what would have to change
   in the WordPress plugin for `SeverityLevel` to become generated too.
5. `--output` is mandatory in `schema:pull`. Say exactly where the file lands without it, why
   you never see it, and why the command still reports success.

## Learn More

- [The `client` preset](https://the-guild.dev/graphql/codegen/plugins/presets/preset-client) —
  the authoritative description of the three files you generated, and the masking option this
  lesson turned off
- [Codegen — `codegen.ts` configuration reference](https://the-guild.dev/graphql/codegen/docs/config-reference/codegen-config)
  — every key in the config you wrote, including `overwrite` and `ignoreNoDocuments`
- [Codegen — getting started with React](https://the-guild.dev/graphql/codegen/docs/guides/react-vue)
  — the Guild's own walkthrough; read it as the inline-`graphql()` alternative to this course's
  `.graphql` files
- [`typed-document-node` plugin](https://the-guild.dev/graphql/codegen/plugins/typescript/typed-document-node)
  — what makes each `…Document` constant carry its own types, which is why `fetchGraphQL` needs
  no type argument
- [WP-CLI command reference](https://developer.wordpress.org/cli/commands/) — for
  `wp graphql generate-static-schema` and the `--output` flag `schema:pull` depends on
- [`git diff --exit-code`](https://git-scm.com/docs/git-diff) — the exit-status behaviour the
  `codegen:check` script is built on
- [SCF Local JSON](https://www.advancedcustomfields.com/resources/local-json/) — the
  generated-artifact-in-git workflow this lesson borrowed its argument from
