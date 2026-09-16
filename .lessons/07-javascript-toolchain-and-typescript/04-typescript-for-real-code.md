---
title: 'TypeScript for Real Code'
module: 7
lesson: 4
teaches: [generics, discriminated-unions, utility-types, unknown-vs-any, type-narrowing]
produces: ['next-app/src/types/content.ts', 'next-app/scripts/blame.ts']
requires: [7.3]
---

# Lesson 07.4 — TypeScript for Real Code

## Quick Overview

Now you model the whole content contract by hand. `next-app/src/types/content.ts` becomes a
TypeScript rendering of [appendix 03](../appendix/03-content-model-reference.md): `Incident` with
its `incidentDetails`, `Scapegoat` with its optional `scapegoatProfile`, `TechReview` with both
repeaters as arrays of objects rather than arrays of strings, and `SeverityLevel` and
`IncidentEnvironment` as the literal unions from Lesson 07.3. Module 10 will generate all of it
from `schema.graphql` and delete this file — that is not wasted work, it is the reason you will
be able to *read* the generated output, which is dense and unfriendly to anyone meeting these
constructs for the first time.

Four constructs do the work. **Generics** give you `Connection<T>` once, so
`Connection<Incident>` and `Connection<TechReview>` share one definition — the same shape
WPGraphQL returns for every list, so you write `nodes`, `edges` and `pageInfo` a single time.
**`unknown` versus `any`**: a JSON response is `unknown` until something proves otherwise, and
`any` is the escape hatch that silently turns the checker off for everything downstream.
**Narrowing and type guards** turn `unknown` into something usable, safely. And
**discriminated unions** are the headline: a `Block` type with one variant per custom block,
each carrying a literal `name`, so a `switch (block.name)` gives you the correct props in every
branch and a compile error when you add a seventh block and forget a case. That is exactly the
type the `BlockRenderer` in **Module 14** switches on. You are writing it now, against content
you built yourself, so that Module 14 can be about recursion and React Server Components rather
than about a type system you have never seen.

By the end of this lesson you will have:

- `next-app/src/types/content.ts` modelling `Incident`, `Scapegoat`, `TechReview`,
  `SiteSettings` and their nested field groups
- `Connection<T>` and `Edge<T>` as generics, used by at least three list types
- `Block` as a discriminated union with one variant per custom block from
  [PROJECT.md](../PROJECT.md), keyed on a literal `name`
- An exhaustive `switch` over `Block` with a `never` default case that fails to compile when a
  variant is unhandled
- A type guard turning an `unknown` fetch response into a typed value, with the unsafe `any`
  version written and then deliberately removed
- `readonly` and optional properties applied deliberately, with the nullability matching the
  GraphQL schema rather than wishful thinking

## Classic WP Analogy

Generics are PHPDoc's `@param Incident[] $incidents` promoted from a comment to something the
compiler enforces. If you have written `@return WP_Post[]` so your editor would autocomplete
inside a `foreach`, you have wanted generics and made do with a docblock. `Connection<T>` is the
same instinct — "this is a list-shaped wrapper, and the thing inside varies" — expressed once
instead of copy-pasted per type.

Discriminated unions have a very precise WordPress analogue, and once you see it the construct
stops being abstract. You have written this:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/blame-the-tech-blocks.php — illustration
switch ( $block['blockName'] ) {
    case 'blame/incident-callout': /* ... */ break;
    case 'blame/blame-quote':      /* ... */ break;
    default:                        /* silently render nothing */
}
```

That is a discriminated union used without type safety: `$block['blockName']` is the
discriminant, each case implies a different `$block['attrs']` shape, and you keep the mapping in
your head. In TypeScript the discriminant is declared, the compiler narrows `block` to the right
variant inside each `case`, and the `default` branch can be made to *fail compilation* if a
variant is unhandled. The parse-blocks pattern you already use for Gutenberg content is, it
turns out, the textbook motivating example for the feature.

**Where the analogy breaks down:** in PHP, that `default` case is a runtime shrug. An unknown
block renders nothing, the page still loads, nobody files a bug, and the missing content is
discovered by a client three weeks later. TypeScript's `never`-typed default turns the same
situation into a **build failure**: add a seventh block in Module 13 and forget to handle it in
Module 14, and the deploy stops rather than the content silently vanishing. That inversion — a
whole class of "silently renders nothing" bug becoming impossible to ship — is the strongest
argument for the type system in this entire course, and it is worth experiencing deliberately
before Module 14 depends on it.
---

## Key Concepts

### 1. Generics, but only where they pay

A generic is a type with a parameter. You already know the idea from PHPDoc — `@return
WP_Post[]` says "an array, and the thing inside is a `WP_Post`" — except here the compiler
enforces it and the parameter varies per call site.

Two places in this codebase genuinely earn one. The first is the Relay envelope, because every
list WPGraphQL returns has the same shape and only the payload changes:
`Connection<Incident>`, `Connection<Scapegoat>`, `Connection<TechReview>` — one declaration, in
the Task. The second is a function whose return type depends on its arguments:

```ts
// next-app/scripts/blame.ts — the signature the whole data layer rests on (illustration)
async function fetchGraphQL<TResult, TVariables extends Record<string, unknown>>(
  query: string,
  variables: TVariables
): Promise<TResult>;

const data = await fetchGraphQL<BlameBoardData, { first: number }>(QUERY, { first: 10 });
//    ^ data is BlameBoardData. Not any. Not unknown.
```

| Piece | Meaning |
|---|---|
| `<TResult, TVariables>` | Two type parameters, named at the call site or inferred |
| `extends Record<string, unknown>` | A **constraint** — variables must be an object, not a number |
| `Promise<TResult>` | The parameter flowing back out through the return type |
| `= Record<string, never>` | A **default** would let you write `fetchGraphQL<Data>(QUERY, {})` |

> **Do not write a generic until you have written the concrete version twice.** A generic
> abstracts a shape you have *observed*; one written speculatively is usually the wrong shape
> with worse error messages. `Connection<T>` qualifies because WPGraphQL really does return the
> same envelope for every list, and `fetchGraphQL` qualifies because every query in Modules
> 09–20 goes through it. Very little else here does.

Note what `TResult` is **not**: a statement about the runtime. `fetchGraphQL<Incident>` tells the
compiler to *treat* the response as an `Incident`. If WordPress sends something else, nothing
notices. Key Concept 4 is about narrowing that gap.

### 2. The utility types you will actually use

TypeScript ships transformations over object types. Six of them cover nearly everything.

| Utility | Produces | A real use here |
|---|---|---|
| `Pick<T, K>` | only the named keys | `Pick<Incident, 'id' \| 'slug' \| 'title'>` — the fields a card renders |
| `Omit<T, K>` | everything except those keys | `Omit<Incident, 'content'>` — a list item that never carries the body |
| `Partial<T>` | every key optional | `Partial<IncidentDetails>` — a draft being filled in |
| `Required<T>` | every key mandatory | rare, and usually a sign the source type was wrong |
| `Record<K, V>` | keys `K`, values `V` | `Record<SeverityLevel, string>` — one label per severity |
| `NonNullable<T>` | `T` without `null`/`undefined` | `NonNullable<Incident['incidentDetails']>` |

`Record<SeverityLevel, string>` deserves a second look, and the Task writes it. It is not
documentation: it is a compile-time guarantee that **every** member of the union has a label, and
it fails the build the day someone adds a fifth severity term. Same guarantee as an exhaustive
`switch` (Key Concept 6), expressed as data instead of control flow.

`T['key']` in the last row is an **indexed access type** — the type of that property. With
`NonNullable` around it, that is how you name "an `IncidentDetails` that is definitely there"
without re-declaring the shape.

### 3. Narrowing, and the difference between a guard and validation

TypeScript reads control flow: inside a branch, a value's type is narrower than outside it. The
mechanisms are ones you already write.

| Technique | Narrows | Example |
|---|---|---|
| Truthiness | out `null`/`undefined`/`''`/`0` | `if (incident.blameScore) { … }` |
| `!= null` | exactly the nullish cases | `if (details != null) { … }` |
| `typeof` | primitives | `if (typeof value === 'string') { … }` |
| `Array.isArray` | arrays | `if (Array.isArray(value)) { … }` |
| `in` | which member of a union | `if ('errors' in body) { … }` |
| Literal comparison | a discriminated union | `if (block.__typename === 'BttHobtCta') { … }` |
| A type guard | anything you can test | `if (isIncident(value)) { … }` |

A **type guard** is an ordinary function with an extraordinary return type:

```ts
// next-app/scripts/blame.ts — a type predicate (illustration)
function isIncident(value: unknown): value is Incident {
  return typeof value === 'object' && value !== null && 'slug' in value;
}
```

`value is Incident` is a **type predicate**: a `true` return tells the compiler the argument has
that type from then on. It is the only way to get from `unknown` to something usable without a
cast.

> **A type guard is a claim, not validation.** Nothing forces the body above to check a single
> field, and as written it will happily certify `{ slug: 42 }` as an `Incident`. That is
> acceptable at a boundary you trust — your own WordPress, over your own network — and
> unacceptable for form input, which is why Module 16 parses with Zod instead. The rule this
> course follows: **validate what you do not control, type what you do.**

Truthiness narrowing walks straight into one trap in this data model: `if (incident.blameScore)`
excludes `0`, and `0` is a real blame score. Use `!= null` whenever the value can legitimately be
falsy — the `??` versus `||` distinction from Lesson 07.2, one level up.

### 4. `unknown` at the boundary, `any` nowhere

`response.json()` is typed `Promise<any>` in the standard library. That `any` is the largest hole
in a typed data layer, because everything derived from it is unchecked too:

```
                any                                    unknown
   ┌─────────────────────────────┐          ┌──────────────────────────────────┐
   │ const b = await res.json()  │          │ const b: unknown = await …       │
   │ b.data.incidents.nodes[0]   │  ✅ tsc  │ b.data                  ❌ tsc   │
   │   .incidentDetails.title    │  ✅ tsc  │ if (isRecord(b)) { … }  ✅       │
   │ 💥 at runtime, in prod      │          │ the check is where you put it     │
   └─────────────────────────────┘          └──────────────────────────────────┘
```

The rule for this codebase: **`any` appears nowhere**, enforced by
`@typescript-eslint/no-explicit-any` from Lesson 07.5. The permitted escape hatch is `unknown`
plus a guard, because that puts the check somewhere a reader can find it.

### 5. Discriminated unions

The centrepiece, and the construct the rest of the course leans on hardest.

A discriminated union is a union of object types that all carry a **common property whose type is
a different literal in each member**. You have written the pattern in PHP; what you have not had
is anything enforcing it.

```
PHP — the discriminant exists, nothing enforces it
──────────────────────────────────────────────────────────────────────
switch ( $block['blockName'] ) {
  case 'btt/incident-callout':                 // $block['attrs'] shape? in your head
    echo $block['attrs']['severity'];          // typo → notice, or silence
    break;
  case 'btt/blame-quote':
    echo $block['attrs']['attribution'];
    break;
  default:                                     // unknown block → renders NOTHING
}

TypeScript — the discriminant is declared, and the compiler follows it
──────────────────────────────────────────────────────────────────────
switch (block.__typename) {
  case 'BttIncidentCallout':                   // block is narrowed to this variant
    return block.attributes?.severity;         // ✅ typed SeverityLevel | null
  case 'BttBlameQuote':
    return block.attributes?.attribution;      // ✅ and `severity` HERE is a compile error
  default:
    return assertNever(block);                 // ❌ build fails on an unhandled variant
}
```

**Discriminate on `__typename`, never on `name`.** WPGraphQL Content Blocks returns both, and
they look interchangeable. They are not: `name` is typed `string` in the schema, so it narrows
nothing and every branch would need a cast, while `__typename` is a **literal type** per concrete
object type — exactly what narrowing needs. Lesson 14.2 states the same rule and depends on it
entirely, and it is why
[appendix 05 §4](../appendix/05-graphql-cheatsheet.md#inline-fragments--narrowing-a-union-or-interface)
selects `__typename` in every polymorphic query in this course.

The union you write in the Task has one member per block from
[the block list](../13-gutenberg-block-development/README.md#the-six-blocks), plus one core
block, and it is declared with a small generic so seven variants do not cost seventy lines.

### 6. Exhaustiveness, and the `never` that fails the build

`never` is the type with no values. Nothing is assignable to it — which turns it into a proof.

In the `default` arm of a `switch` over a fully-handled union, the compiler has eliminated every
variant, so the value's type is `never` and passing it to a function that takes `never` compiles.
Miss a case and the value is that missing variant, which is *not* assignable to `never`, so the
build fails — **naming the variant you forgot**:

```
scripts/blame.ts:96:29 - error TS2345: Argument of type
'BlockOf<"BttIncidentMap", { readonly zoom: number | null; }>' is not assignable to
parameter of type 'never'.
```

| | PHP `switch` on `$block['blockName']` | TypeScript `switch` + `assertNever` |
|---|---|---|
| Unhandled case | renders nothing, silently | **build fails** |
| Wrong attribute name | notice, or empty output | compile error |
| Discovered by | a client, three weeks later | CI, before the merge |
| Adding a variant | remember every switch yourself | the compiler lists them for you |

That inversion — a whole class of "silently renders nothing" bug becoming impossible to ship — is
the strongest single argument for the type system in this course. `noFallthroughCasesInSwitch` and
`noImplicitReturns` are on for the same reason: they close the two ways a `switch` can be wrong
that `never` alone does not catch.

`assertNever` also throws at runtime, and that matters. In production the union can be violated by
*data* — an editor uses a block your deploy has not caught up with — so the runtime arm is a real
code path, not decoration. Lesson 14.2 replaces the throw with an `UnknownBlock` component that
shouts in development and renders `null` in production.

### 7. `import type`, and running TypeScript directly

With `verbatimModuleSyntax` on, imports are emitted exactly as written, so an import used only
for types must say so:

```ts
// next-app/scripts/blame.ts — type-only imports leave no trace (illustration)
import type { Incident, Block } from '../src/types/content.ts';
// erased entirely: no module loaded at runtime, no import cycle, no cost.

import { SEVERITY_LABEL } from '../src/types/content.ts';
// a value import — this one survives into the running program.
```

That is why `content.ts` costs nothing: it is types all the way down except `SEVERITY_LABEL`.

Running a `.ts` file needs something to strip the annotations first. Three options; this course
uses the second:

| Option | Command | Type-checks? |
|---|---|---|
| Compile, then run | `tsc && node dist/blame.js` | yes — but now you maintain a build directory |
| **`tsx`** | `npx tsx scripts/blame.ts` | **no** |
| Node's own stripping | `node --experimental-strip-types scripts/blame.ts` | no |

> **Neither `tsx` nor Node type-checks anything.** They delete the annotations and run the
> JavaScript underneath, exactly as Lesson 07.3 Key Concept 1 described. `npm run type-check` is
> the only command that judges your types, which is why it is a separate script and, in Module
> 24, a separate CI job. A script that runs is not a script that is correct.

### 8. What Module 10 deletes, and why this is not wasted work

`src/types/content.ts` is temporary by design.

| Written by hand here | Replaced in Module 10 by | Survives? |
|---|---|---|
| `Incident`, `Scapegoat`, `TechReview` | `src/gql/`, generated from `schema.graphql` | no |
| The enum unions, `SeverityLevel` | generated unions, near-identical in shape | no |
| `Connection<T>`, `Edge<T>`, `PageInfo` | generated per-operation types | no |
| `Block` | generated from the Content Blocks schema | no |
| `fetchGraphQL` | `src/lib/graphql/client.ts`, with cache tags and error mapping | rewritten |
| **Being able to read all of it** | — | **yes** |

The sequence is deliberate. **Module 09 hand-writes response types and lets them drift from the
schema on purpose** — you add a field to a query, forget the type, and watch TypeScript
confidently describe a shape that no longer exists. **Lesson 10.2 then replaces the lot with
codegen**, which cannot drift, because it is generated from the committed schema and verified in
CI.

Codegen output is dense: deep generic instantiations, `Exact<>` wrappers, `Maybe<T>` everywhere.
Meeting that with no idea what a discriminated union is, is how people conclude generated types
are unusable and switch them off. You are writing the small version first so the big version is
legible.

---

## Task

### Step 1: Check a licence, then install the TypeScript runner

```bash
cd next-app
npm view tsx license
# Expected: MIT — permissive, so it is allowed in next-app (Lesson 07.1 Key Concept 9)

npm install --save-dev tsx@^4.20.0
```

### Step 2: Finish the content model

Three additions and two edits to `next-app/src/types/content.ts`. Append the additions in order.

```ts
// next-app/src/types/content.ts — append
/* ── Relay connections (appendix 05 §2), as generics ─────────────────── */

export type PageInfo = {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
};

export type Edge<TNode> = {
  readonly cursor: string;
  readonly node: TNode;
};

export type Connection<TNode> = {
  readonly nodes: readonly TNode[];
  readonly pageInfo?: PageInfo; // only when you select it
  readonly edges?: readonly Edge<TNode>[]; // the long form — rarely needed
};

/* ── Media, and the SCF image edge (appendix 03 §4.2) ────────────────── */

export type MediaItem = {
  readonly id: string;
  readonly sourceUrl: string;
  readonly altText: string;
};

// SCF image fields do NOT arrive as a bare object. WPGraphQL for SCF returns an
// `AcfMediaItemConnectionEdge`, so the media item sits one level down, under `node`.
export type AcfMediaEdge = { readonly node: MediaItem } | null;

/* ── Scapegoat Profile (appendix 03 §4.2) — an SCF TERM field group ──── */

export type ScapegoatProfile = {
  readonly avatar: AcfMediaEdge;
  readonly tagline: string | null;
  readonly defensiveness: number | null; // Range 1–10 → Float
  readonly firstBlamedOn: string | null; // Date Picker → String
  readonly officialExcuse: string | null;
  readonly isSentient: boolean | null;
};

export type Scapegoat = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly count: number | null;
  readonly scapegoatProfile?: ScapegoatProfile | null; // optional AND nullable
};

/* ── Tech Review Fields (appendix 03 §4.3) ───────────────────────────── */

// An SCF REPEATER is not a string array. It generates one object type per repeater with
// the sub-field as a property — `TechReviewFieldsPros`, never `string[]`. This is the
// most common "why is my generated type not what I expected?" moment in headless WP.
export type TechReviewPro = { readonly item: string | null };
export type TechReviewCon = { readonly item: string | null };

export type TechReviewFields = {
  readonly companyName: string | null;
  readonly logo: AcfMediaEdge;
  readonly ratingOverall: number | null;
  readonly ratingDx: number | null;
  readonly ratingDocs: number | null;
  readonly ratingIncidentResponse: number | null;
  readonly verdict: TechReviewVerdict | null;
  readonly pros: readonly TechReviewPro[] | null;
  readonly cons: readonly TechReviewCon[] | null;
  readonly reviewedAt: string | null;
};

export type TechReview = {
  readonly id: string;
  readonly databaseId: number;
  readonly slug: string;
  readonly title: string;
  readonly date: string | null;
  readonly techReviewFields: TechReviewFields | null;
  readonly techStacks: Connection<Term>;
};

/* ── Derived types (Key Concept 2) ───────────────────────────────────── */

export type IncidentCardFields = Pick<Incident, 'id' | 'slug' | 'title' | 'date' | 'blameScore'>;

export type IncidentDraft = Partial<IncidentDetails>;

// Exhaustive by construction: add a fifth severity term and this stops compiling.
export const SEVERITY_LABEL: Record<SeverityLevel, string> = {
  's1-catastrophic': 'S1 — Catastrophic',
  's2-major': 'S2 — Major',
  's3-minor': 'S3 — Minor',
  's4-cosmetic': 'S4 — Cosmetic',
};

/* ── Blocks as a discriminated union (Module 13's six, plus a core one) ─ */

type BlockOf<TName extends string, TAttributes> = {
  readonly __typename: TName; // the DISCRIMINANT. Never `name` — that is typed `string`.
  readonly clientId: string;
  readonly parentClientId: string | null;
  readonly attributes: TAttributes | null;
};

export type Block =
  | BlockOf<'CoreParagraph', { readonly content: string | null }>
  | BlockOf<'BttIncidentCallout', { readonly severity: SeverityLevel | null }>
  | BlockOf<'BttBlameQuote', { readonly attribution: string | null }>
  | BlockOf<'BttScapegoatPicker', { readonly termId: number | null }>
  | BlockOf<'BttIncidentTicker', { readonly count: number | null }>
  | BlockOf<'BttHobtCta', { readonly label: string | null }>
  | BlockOf<'BttTechVerdictCard', { readonly reviewSlug: string | null }>;
```

Now the two **edits**. Inside `export type Incident`, replace the three placeholder arrays — and
the comment above them — with the real connection types, giving `scapegoats` its profile-bearing
element type:

```ts
// next-app/src/types/content.ts — edit, inside `export type Incident`
  readonly severities: Connection<SeverityTerm>;
  readonly scapegoats: Connection<Scapegoat>;
  readonly techStacks: Connection<Term>;
```

And `BlameBoardData` now says what it always meant:

```ts
// next-app/src/types/content.ts — edit
export type BlameBoardData = {
  readonly incidents: Connection<Incident> | null;
};
```

**Verify §2:**

- [ ] `npm run type-check` is clean.
- [ ] The placeholder comment about Relay connections is gone. Delete a comment the moment it
      stops being true.
- [ ] `Block` has exactly seven members and every `__typename` is a literal string.
- [ ] Nothing in the file is `any`, and every field name still matches
      [appendix 03 §4](../appendix/03-content-model-reference.md#4-acf-field-groups).

### Step 3: Write the typed script

`scripts/blame.mjs` stays exactly where it is. You are writing its typed twin beside it, so you
can run both and see that the output is identical — Lesson 07.3's erasure claim, proved rather
than asserted.

```ts
// next-app/scripts/blame.ts
// The typed blame board. Same behaviour as blame.mjs, judged before it runs.
//   export WP_GRAPHQL_ENDPOINT=http://localhost:8080/graphql && npm run blame

import type { BlameBoardData, Block, Incident } from '../src/types/content.ts';

const TIMEOUT_MS = 8_000;

const QUERY = /* GraphQL */ `
  query BlameBoard($first: Int!) {
    incidents(first: $first, where: { orderby: { field: DATE, order: DESC } }) {
      nodes {
        id
        databaseId
        slug
        title
        date
        blameScore
        severities(first: 1) { nodes { id name slug count } }
        scapegoats(first: 1) { nodes { id name slug count } }
        techStacks(first: 5) { nodes { id name slug count } }
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
  }
`;

/* ── The GraphQL envelope, and a guard for it ────────────────────────── */

type GraphQLBody<TData> = {
  readonly data?: TData | null;
  readonly errors?: readonly { readonly message: string }[];
};

// A type predicate: a `true` return tells the compiler what the value is. A claim about
// shape, not validation — Key Concept 3.
function isGraphQLBody<TData>(value: unknown): value is GraphQLBody<TData> {
  return typeof value === 'object' && value !== null && ('data' in value || 'errors' in value);
}

export async function fetchGraphQL<TResult, TVariables extends Record<string, unknown>>(
  query: string,
  variables: TVariables
): Promise<TResult> {
  const endpoint = process.env.WP_GRAPHQL_ENDPOINT;
  if (endpoint === undefined || endpoint === '') {
    throw new Error('WP_GRAPHQL_ENDPOINT is not set. Export it, then re-run.');
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    throw new Error(`cannot reach ${endpoint} within ${TIMEOUT_MS} ms`, { cause });
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} from ${endpoint}`);
  }

  // json() is typed `any`. Park it in `unknown` immediately — Key Concept 4.
  const body: unknown = await response.json();
  if (!isGraphQLBody<TResult>(body)) {
    throw new Error('the response was not a GraphQL envelope');
  }
  if (body.errors !== undefined && body.errors.length > 0) {
    throw new Error(`GraphQL reported: ${body.errors.map((e) => e.message).join('; ')}`);
  }

  const data = body.data;
  if (data === undefined || data === null) {
    throw new Error('the response contained neither data nor errors');
  }
  return data;
}

/* ── Two discriminated unions, two exhaustive switches ───────────────── */

type ReportLine =
  | { readonly kind: 'header'; readonly label: string }
  | { readonly kind: 'incident'; readonly incident: Incident }
  | { readonly kind: 'block'; readonly block: Block }
  | { readonly kind: 'total'; readonly count: number; readonly minutes: number }
  | { readonly kind: 'empty'; readonly reason: string };

function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}

function renderIncident(incident: Incident): string {
  // noUncheckedIndexedAccess: [0] is possibly undefined, so it has to be guarded.
  const severity = incident.severities.nodes[0]?.slug ?? 'unclassified';
  const scapegoat = incident.scapegoats.nodes[0]?.name ?? 'nobody yet';
  const blame = String(Math.round(incident.blameScore ?? 0)).padStart(5);
  const minutes = String(incident.incidentDetails?.downtimeMinutes ?? 0).padStart(5);

  return `${blame}  ${severity.padEnd(17)} ${minutes}  ${scapegoat.padEnd(22)} ${incident.title}`;
}

// The Module 14 rehearsal: switch on __typename and let the compiler prove coverage.
function blockSummary(block: Block): string {
  switch (block.__typename) {
    case 'CoreParagraph':
      return `paragraph — ${block.attributes?.content ?? '(empty)'}`;
    case 'BttIncidentCallout':
      return `callout — ${block.attributes?.severity ?? 'unclassified'}`;
    case 'BttBlameQuote':
      return `quote — ${block.attributes?.attribution ?? 'anonymous'}`;
    case 'BttScapegoatPicker':
      return `picker — term #${block.attributes?.termId ?? 0}`;
    case 'BttIncidentTicker':
      return `ticker — ${block.attributes?.count ?? 0} incidents`;
    case 'BttHobtCta':
      return `CTA — ${block.attributes?.label ?? 'Get demo'}`;
    case 'BttTechVerdictCard':
      return `verdict — review ${block.attributes?.reviewSlug ?? '(none)'}`;
    default:
      return assertNever(block);
  }
}

function renderLine(line: ReportLine): string {
  switch (line.kind) {
    case 'header':
      return `\n${line.label}\n${'─'.repeat(72)}`;
    case 'incident':
      return renderIncident(line.incident);
    case 'block':
      return `  ${blockSummary(line.block)}`;
    case 'total':
      return `\n${line.count} incidents · ${line.minutes} minutes of downtime`;
    case 'empty':
      return `No incidents. ${line.reason}`;
    default:
      return assertNever(line);
  }
}

const REHEARSAL: readonly Block[] = [
  { __typename: 'CoreParagraph', clientId: 'a', parentClientId: null, attributes: null },
  { __typename: 'BttHobtCta', clientId: 'b', parentClientId: 'a', attributes: { label: 'Demo' } },
];

async function main(): Promise<void> {
  const limit = Number(process.env.BLAME_LIMIT ?? 10);
  const data = await fetchGraphQL<BlameBoardData, { first: number }>(QUERY, { first: limit });

  // `readonly` forbids sorting in place, so copy first. The compiler insisted.
  const incidents = [...(data.incidents?.nodes ?? [])].sort(
    (a, b) => (b.blameScore ?? 0) - (a.blameScore ?? 0)
  );
  const minutes = incidents.reduce(
    (sum, incident) => sum + (incident.incidentDetails?.downtimeMinutes ?? 0),
    0
  );

  const lines: ReportLine[] =
    incidents.length === 0
      ? [{ kind: 'empty', reason: 'Seed the site with the wpcli service, then re-run.' }]
      : [
          { kind: 'header', label: `Blame board — ${incidents.length} most recent incidents` },
          ...incidents.map((incident): ReportLine => ({ kind: 'incident', incident })),
          { kind: 'total', count: incidents.length, minutes },
        ];

  if (process.argv.includes('--blocks')) {
    lines.push({ kind: 'header', label: 'Block renderer rehearsal (Module 14)' });
    lines.push(...REHEARSAL.map((block): ReportLine => ({ kind: 'block', block })));
  }

  console.log(lines.map(renderLine).join('\n'));
}

try {
  await main();
} catch (error) {
  // `catch` gives you `unknown` — useUnknownInCatchVariables. Anything can be thrown.
  console.error(`\nblame: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
```

### Step 4: Point the scripts at both versions

```bash
npm pkg set scripts.blame="tsx scripts/blame.ts"
npm pkg set "scripts.blame:mjs"="node scripts/blame.mjs"

export WP_GRAPHQL_ENDPOINT=http://localhost:8080/graphql
npm run type-check
npm run blame
npm run blame -- --blocks
```

**Verify §4:**

- [ ] `npm run type-check` is silent.
- [ ] `npm run blame` prints the same board as Lesson 07.2 did.
- [ ] `npm run blame -- --blocks` adds two rehearsal lines — `paragraph — (empty)` and
      `CTA — Demo`.
- [ ] `npm run blame:mjs` prints the same incidents. The types changed the build, not the run.

### Step 5: Break the exhaustiveness check on purpose

This is the Module 14 scenario, seven modules early: a block is added on the WordPress side and
the renderer is not updated. Add an eighth member to `Block`:

```ts
// next-app/src/types/content.ts — TEMPORARY. Removed at the end of Step 5.
  | BlockOf<'BttIncidentMap', { readonly zoom: number | null }>;
```

```bash
npm run type-check; echo "exit=$?"
```

**Verify §5:**

- [ ] The build fails with `TS2345`, and the message **names `BttIncidentMap`** as the type that
      is not assignable to `never`.
- [ ] The error points at the `default:` arm of `blockSummary`, not at the union declaration.
- [ ] The exit code is non-zero.
- [ ] Add `case 'BttIncidentMap': return 'map';` and the build goes green — the check is about
      coverage, not about how many variants there are.
- [ ] Remove **both** the temporary union member and that new `case`, then confirm
      `npm run type-check` is clean and `Block` has seven members again.

### Step 6: Commit

```bash
cd .. && git add next-app/package.json next-app/package-lock.json \
  next-app/src/types/content.ts next-app/scripts/blame.ts
git commit -m "feat(web): generics, guards and a discriminated union over the content model"
```

---

## Verification

```bash
cd next-app
export WP_GRAPHQL_ENDPOINT=http://localhost:8080/graphql

# 1. Everything type-checks
npm run type-check && echo "types OK"
# Expected: types OK

# 2. The typed script prints real incidents, and the union renderer works
npm run blame | head -4
npm run blame -- --blocks | tail -2
# Expected: the board sorted by blame descending; then
#           "  paragraph — (empty)" and "  CTA — Demo"

# 3. ERASURE — the typed and untyped scripts agree, line for line
diff <(npm run --silent blame) <(npm run --silent blame:mjs) && echo "identical"
# Expected: identical. Types changed the build, not the behaviour.

# 4. NEGATIVE — an unhandled union member fails the build, and the error NAMES it
cat > src/types/_exhaustive.ts <<'TS'
import type { SeverityLevel } from './content.ts';

function assertNever(value: never): never {
  throw new Error(String(value));
}

export function shortLabel(level: SeverityLevel): string {
  switch (level) {
    case 's1-catastrophic':
      return 'S1';
    case 's2-major':
      return 'S2';
    case 's3-minor':
      return 'S3';
    default:
      return assertNever(level); // 's4-cosmetic' is deliberately unhandled
  }
}
TS
npm run type-check; echo "exit=$?"
# Expected: TS2345 — '"s4-cosmetic"' is not assignable to parameter of type 'never'.
#           Non-zero exit. This is the Module 14 failure, in miniature.
rm src/types/_exhaustive.ts
npm run type-check && echo "restored"
# Expected: restored

# 5. NEGATIVE — the runner does NOT type-check, which is why both commands exist
cp scripts/blame.ts /tmp/blame.ts.bak
printf "\nconst wrong: number = 'not a number';\n" >> scripts/blame.ts
npx tsx scripts/blame.ts >/dev/null 2>&1; echo "tsx exit=$?"
npm run type-check >/dev/null 2>&1; echo "tsc exit=$?"
# Expected: tsx exit=0 — it ran happily. tsc exit non-zero — it did not.
cp /tmp/blame.ts.bak scripts/blame.ts && rm /tmp/blame.ts.bak
npm run type-check && echo "green again"

# 6. NEGATIVE — `any` has not crept back in
grep -n ': any\|<any>\|as any' src/types/content.ts scripts/blame.ts; echo "hits=$?"
# Expected: no output, then hits=1 (grep found nothing). Lesson 07.5 makes this a lint rule.

# 7. The union is discriminated on __typename, and every block has a case
grep -c '__typename' src/types/content.ts
grep -c "case 'Btt" scripts/blame.ts
# Expected: at least 1, then 6 — one case per custom block

# 8. Utility types are used instead of duplicated shapes
grep -n 'Pick<Incident\|Record<SeverityLevel\|Partial<IncidentDetails' src/types/content.ts
# Expected: three lines

# 9. Nothing stray is staged
cd .. && git status --short next-app/
# Expected: clean — no .bak, no _exhaustive.ts, no node_modules
```

Check 3 is the one to sit with. Two files, one typed and one not, producing byte-for-byte
identical output, because the types were deleted before the program ran. Check 5 is its
consequence: the runner does not care that a type is wrong, so `npm run type-check` is not
optional — and Module 24 makes it a required CI job for exactly that reason.

## Control Questions

1. `fetchGraphQL<BlameBoardData, { first: number }>(QUERY, { first: 10 })` returns a value typed
   `BlameBoardData`. Describe precisely what happens if WordPress returns a field that is not in
   that type, and at which of Lesson 07.2's three error layers the failure would surface.
2. Both `name` and `__typename` identify a block, and both come back from WPGraphQL Content
   Blocks. Explain why a `switch` on `name` would compile while narrowing nothing, and what each
   `case` body would then have to do.
3. `assertNever` fails the build *and* throws at runtime. Give one production scenario where the
   runtime throw genuinely fires despite a green build, and say what Lesson 14.2 does instead of
   throwing.
4. `Record<SeverityLevel, string>` and an exhaustive `switch` over `SeverityLevel` enforce the
   same guarantee by different means. State the guarantee, and give one reason to prefer each
   form.
5. `npx tsx scripts/blame.ts` happily ran a file containing a type error. Explain why that is
   correct behaviour rather than a bug, and name the two separate commands a CI pipeline
   therefore needs.

## Learn More

- [TypeScript Handbook: Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html) —
  constraints and defaults, which is the 20% of generics this codebase uses
- [TypeScript Handbook: Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
  — type predicates, discriminated unions and the `never` exhaustiveness pattern, in that order
- [TypeScript Handbook: Utility types](https://www.typescriptlang.org/docs/handbook/utility-types.html)
  — the full list; `Pick`, `Omit`, `Partial` and `Record` are the four that earn their keep
- [`tsx`](https://tsx.is/) — what it does and, stated plainly, what it does not do
- [Node.js: type stripping](https://nodejs.org/api/typescript.html#type-stripping) — the
  dependency-free alternative, and why `enum` is unsupported there
- [GraphQL Code Generator: the TypeScript plugin](https://the-guild.dev/graphql/codegen/plugins/typescript/typescript)
  — read it now so Module 10 is a comparison rather than an introduction
