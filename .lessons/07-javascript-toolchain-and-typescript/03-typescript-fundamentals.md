---
title: 'TypeScript Fundamentals'
module: 7
lesson: 3
teaches: [typescript-basics, structural-typing, interfaces-vs-types, strict-mode, literal-unions]
produces: ['next-app/tsconfig.json']
requires: [7.2]
---

# Lesson 07.3 — TypeScript Fundamentals

## Quick Overview

TypeScript is JavaScript with a type checker bolted on at compile time. It emits plain
JavaScript, it has no runtime presence whatsoever, and every type you write is erased before the
code runs — which is the single most clarifying fact about it. The checker's job is to tell you,
before you run anything, that `incident.incidentDetails.downtimeMinutes` might be `null` and
that `severity.slug` is not one of the four values you handle. This lesson sets up `tsc`, writes
`tsconfig.json` with `strict: true` and every non-obvious setting justified in a comment, and
types the first real modules — starting with the response shape of the script you wrote in
Lesson 07.2.

Three ideas carry most of the value. **Structural typing**: TypeScript cares about an object's
shape, not its declared name, so anything with the right properties satisfies a type — which is
much closer to how you already think about PHP arrays than to PHP's nominal classes.
**`strict` mode**, which is on from the first line and never negotiated: `strictNullChecks`
alone eliminates the largest class of bug in this codebase, because a headless front end is
mostly nullable data arriving over a network. And **literal union types**: `type SeverityLevel =
's1-catastrophic' | 's2-major' | 's3-minor' | 's4-cosmetic'` turns the closed term set from
[appendix 03 §2](../appendix/03-content-model-reference.md#seeded-terms) into something the
compiler enforces, so a typo is an error rather than an empty badge in production.

By the end of this lesson you will have:

- `next-app/tsconfig.json` with `strict: true`, and a one-line justification comment beside each
  non-default setting
- `typecheck` in `package.json` running `tsc --noEmit`, and `tsc --watch` used while you work
- `SeverityLevel` and `IncidentEnvironment` as literal union types matching the contract exactly
- The Lesson 07.2 fetch response typed, with `strictNullChecks` forcing you to handle the
  nullable cases
- Three deliberately introduced type errors, read and fixed — including one whose real cause is
  on the last line of the message
- A written explanation of when you use `interface` and when you use `type`, and why it barely
  matters

## Classic WP Analogy

PHP's type declarations are the closest thing you know, and they cover more ground than people
give them credit for: `function f(string $slug, ?int $minutes = null): array`, union types since
8.0, `declare(strict_types=1)`, and the docblock annotations PHPStan reads. If you have run
PHPStan or Psalm over a plugin — which Module 23 does to yours — you have already experienced
the core loop: a tool reads your code without running it and tells you a value can be `null` on
a path you had not considered. TypeScript is that, with the annotations built into the syntax
instead of living in comments.

The mindset shift is smaller than the reputation suggests, and the useful framing is: you were
already tracking types in your head. Every time you wrote `absint($_POST['downtime'])` or
checked `is_wp_error($result)` or wrote `@param int[] $ids` in a docblock, you were doing type
work manually. TypeScript writes it down and checks it. The specific WordPress habit it will
break is the one where a function returns `false` on failure and an array on success — `WP_Query`
does it, `get_field()` does it, half of core does it — and TypeScript will make you handle both
branches every single time. That is not pedantry; it is the bug you shipped last year.

**Where the analogy breaks down:** PHP's types are **enforced at runtime**. Pass a string where
`int` is declared with `strict_types=1` and PHP throws a `TypeError` in production, at the
moment it happens, and your error log records it. TypeScript's types are **erased**. They do not
exist at runtime, they cannot check anything at runtime, and a JSON response from WPGraphQL that
does not match its declared type will sail straight through and fail somewhere far away with a
confusing message. That is why this course validates data at every boundary it does not control
— Zod on the Next side in Module 16, and re-validation in PHP as you saw in Lesson 06.2. A
TypeScript type is a promise you made to the compiler, not a check the runtime performs, and
confusing the two is the mistake that costs the most.
---

## Key Concepts

### 1. The types are erased, and that is the whole story

`tsc` reads your annotated code, judges it, and emits JavaScript with every annotation deleted.
Nothing about a type survives into the running program.

```
   content.ts                    tsc                    what actually runs
   ┌──────────────────────────┐         ┌───────────────────────────────────┐
   │ type SeverityLevel =     │         │ export {};                        │
   │   's1-catastrophic' | …  │────────▶│                                   │
   │ type Incident = { … }    │  ERASE  │ (nothing — it was all types)      │
   └──────────────────────────┘         └───────────────────────────────────┘
                │
                └── errors reported HERE, before anything runs
```

| | PHP type declarations | PHPDoc / PHPStan | TypeScript |
|---|---|---|---|
| Checked when | **at runtime, every call** | when you run the tool | when you run `tsc` |
| Present in the shipped artifact | yes | as comments | **no — erased** |
| A wrong value from an API | `TypeError` at the boundary | not detected | **not detected** |
| Blocks the build | n/a | only if you wire it up | **yes, by default** |

The consequence is the single most important sentence in this lesson: **a TypeScript type is a
promise you made to the compiler, not a check the runtime performs.** Declare that
`response.data.incidents.nodes` is `Incident[]`, and if WordPress sends something else,
TypeScript will not notice — the failure surfaces later and further away.

> **This is why the course validates at every boundary it does not control.** Zod parses form
> input in Module 16, WordPress re-validates independently, and Lesson 07.4 writes a type
> *guard* — a runtime check that produces a type. Types where you control both ends; validation
> where you do not.

### 2. Running `tsc`, and who actually compiles your code

Two jobs that people conflate: **judging** the code, and **compiling** it.

```bash
npx tsc --noEmit          # judge everything in tsconfig.json. Emit nothing.
npx tsc --noEmit --watch  # the same, re-run on every save. Keep it open.
npx tsc --showConfig      # the fully resolved configuration, after `extends`
```

In this module, `tsc --noEmit` is the whole toolchain. From Module 09 onward **Next.js compiles
your TypeScript** — with SWC, not `tsc` — and `tsc --noEmit` remains as the separate gate that
says whether the types are sound. That division survives into CI, which is why `noEmit` lives in
the config file rather than in a flag.

> **Keep `tsc --noEmit --watch` running in a second terminal for the rest of this module.** A
> type checker you run once at the end is a linter. A type checker that answers in 300 ms is a
> conversation, and the conversation is the thing that teaches you the type system.

### 3. `strict: true`, and every flag this project turns on

`strict` is not one setting. It is a bundle, and it is on from the first line of the project
because retrofitting it later means fixing hundreds of errors at once instead of one at a time.

| Flag inside `strict` | What it stops |
|---|---|
| `noImplicitAny` | A parameter with no annotation silently becoming `any` |
| `strictNullChecks` | `null` and `undefined` being assignable to everything. **The big one.** |
| `strictFunctionTypes` | Unsound callback parameter substitution |
| `strictBindCallApply` | `fn.call(null, wrongArgs)` |
| `strictPropertyInitialization` | A class field declared and never assigned |
| `noImplicitThis` | `this` being `any` in a detached function |
| `useUnknownInCatchVariables` | `catch (e)` giving you `any` — it is `unknown`, because anything can be thrown |
| `alwaysStrict` | Missing `"use strict"` semantics |

`strictNullChecks` is the one that pays for the whole feature in a headless build, because
almost every field WPGraphQL returns is nullable. It forces the question "what does this page
render when `incidentDetails` is `null`?" at the moment you write the code rather than when an
editor saves a half-filled incident.

The extra flags this project adds, and why:

| Flag | Effect | Why here |
|---|---|---|
| `noUncheckedIndexedAccess` | `arr[0]` is `T \| undefined` | See below. The one that will surprise you. |
| `exactOptionalPropertyTypes` | `field?: string` means **absent**, not "may be `undefined`" | GraphQL distinguishes "not selected" from "null". So should the type. |
| `noFallthroughCasesInSwitch` | A `case` without `break`/`return` is an error | Lesson 07.4's `blockSummary` and `renderLine` are both exhaustive `switch`es, and Module 14's block components narrow the same way |
| `noImplicitReturns` | Some code paths returning a value and some not | Catches a missing branch in exactly those switches |
| `noUnusedLocals` / `noUnusedParameters` | Dead bindings fail the build | Keeps deleted code deleted |
| `erasableSyntaxOnly` | Bans `enum`, `namespace`, parameter properties | Key Concept 8. No type position may emit runtime code. |
| `skipLibCheck` | Do not type-check `node_modules`' own `.d.ts` | Their errors are not yours, and it is much faster |

**`noUncheckedIndexedAccess` deserves its own example**, because it produces an error that looks
wrong the first time you see it:

```ts
// next-app/src/types/content.ts — why arr[0] is not what you think (illustration)
const severities: readonly SeverityTerm[] = incident.severities;

// ❌ Error: 'severities[0]' is possibly 'undefined'.
const label = severities[0].name;

// ✅ Either destructure and check, or chain and fall back.
const [primary] = severities;
const labelA = primary ? primary.name : 'unclassified';
const labelB = severities[0]?.name ?? 'unclassified';
```

TypeScript is right and JavaScript is the problem: `[]` has no element `0`, and reading it gives
`undefined`, not an error. Without this flag, `severities[0].name` type-checks and then throws
`Cannot read properties of undefined` in production on the one incident an editor forgot to
classify. `blame.mjs` already wrote `?.nodes?.[0]?.slug ?? 'unclassified'` for this reason — the
flag makes the habit compulsory.

### 4. Primitives, arrays, tuples, and when to annotate

```ts
// next-app/src/types/content.ts — the primitives (illustration)
const title: string = 'The Coffee Machine Took Down Prod';
const minutes: number = 47; // one number type. No int/float distinction.
const verified: boolean = false;

const slugs: string[] = ['dns', 'the-intern']; // preferred over Array<string>
const frozen: readonly string[] = slugs; // no push, no assignment by index
const pair: [SeverityLevel, number] = ['s1-catastrophic', 47]; // tuple: fixed length and order
```

Every annotation above is redundant — TypeScript infers all of them. The rule worth adopting:

**Annotate boundaries, infer internals.** Function parameters, function return types on exported
functions, and anything arriving from outside the program get explicit types. Local variables do
not; `const rows = nodes.map(toRow)` is better than restating a shape the compiler already knows,
because the annotation is one more thing to keep in sync.

One inference subtlety that will bite you exactly once:

```ts
// next-app/src/types/content.ts — const narrows, let widens (illustration)
const env1 = 'PRODUCTION'; // the literal type 'PRODUCTION'
let env2 = 'PRODUCTION'; // string — `let` widens, because it may be reassigned
const envs = ['PRODUCTION', 'STAGING']; // string[] — NOT a tuple of literals
const fixed = ['PRODUCTION', 'STAGING'] as const; // readonly ['PRODUCTION', 'STAGING']
```

`as const` is how you keep literal types on an array or object literal, and it is how the block
registry in Module 14 stays type-safe.

### 5. Object types: `type` versus `interface`

TypeScript is **structurally** typed. A type is a description of a shape, and anything with that
shape satisfies it — there is no `implements`, no nominal identity, and no relationship between
two types beyond their members. If you have ever written a function that accepts "an array with
`title` and `slug` keys" and documented it in a docblock, structural typing is the thing you
were reaching for.

`type IncidentSummary = { title: string; slug: string }` and
`interface IncidentSummary { title: string; slug: string }` are the same type as far as any
consumer is concerned. The differences:

| | `type` | `interface` |
|---|---|---|
| Objects | yes | yes |
| Unions, intersections, primitives, tuples | **yes** | no — objects only |
| Mapped and conditional types | yes | no |
| Declaration merging (two declarations combine) | no | **yes** |
| `extends` | via `&` | `extends` keyword |
| Error messages | occasionally longer | occasionally shorter |

**Use `type` everywhere in this course.** It covers every case, including the unions and literal
types that carry most of the value, and one keyword for one concept is worth more than a marginal
difference in error formatting. Reach for `interface` in exactly two situations: you need
declaration merging to augment a library's types (Module 20 does this for `next-intl`), or a
library's own documentation tells you to.

The honest version: it barely matters. Pick one and stop discussing it.

### 6. Unions and literal types

A **union** is "one of these": `string | null`, `Incident | TechReview`. A **literal type** is a
type with exactly one value: `'s1-catastrophic'`. Put them together and you can express a closed
set — which is what most of your content model actually is.

```ts
// next-app/src/types/content.ts — a closed set, enforced (illustration)
type SeverityLevel = 's1-catastrophic' | 's2-major' | 's3-minor' | 's4-cosmetic';

const good: SeverityLevel = 's2-major'; // ✅
const typo: SeverityLevel = 's2-majro'; // ❌ Type '"s2-majro"' is not assignable to 'SeverityLevel'
```

Compare the two ways to model the same field:

| Modelled as | A typo is caught | Autocomplete | `switch` exhaustiveness |
|---|---|---|---|
| `slug: string` | never | none | impossible |
| `slug: SeverityLevel` | **at compile time** | all four values | **checkable** |

The severity taxonomy is a locked term list
([appendix 03 §2](../appendix/03-content-model-reference.md#seeded-terms)) — four terms, term UI
locked to radio buttons, never extended. Modelling it as `string` throws away a guarantee the
content model already gives you. The same argument covers the registered GraphQL enums in
[§3](../appendix/03-content-model-reference.md#3-registered-graphql-enums).

### 7. Optional, nullable, and `readonly` — three different statements

`?` and `| null` are not synonyms, and in a GraphQL client the difference is load-bearing.

| Declaration | Means | GraphQL origin |
|---|---|---|
| `title: string` | always present, never null | `title: String!` |
| `title: string \| null` | present, may be null | `title: String` |
| `title?: string` | **may be absent entirely** | a field you did not select |
| `title?: string \| null` | may be absent, and null if present | nullable field, optionally selected |
| `readonly title: string` | you may not assign to it | server data is not yours to mutate |

The mapping is mechanical: `String!` is `string`, `String` is `string | null`, `[Incident!]!` is
`readonly Incident[]`, and a field you did not select is optional.

Every field in `content.ts` is `readonly` for a reason worth stating: data fetched from
WordPress is a snapshot of someone else's state. Mutating it locally produces a UI that
disagrees with the server, and `readonly` turns that mistake into a compile error at no runtime
cost. It is shallow — `readonly` on an object property does not freeze the object's own
properties — which is why every nested type declares its own `readonly` members too.

With `exactOptionalPropertyTypes` on, `field?: string` genuinely means *absent* — you cannot
assign `undefined` to it explicitly. That is correct here, because "not selected" and "null" are
different facts that a GraphQL response reports differently.

### 8. `enum` versus a union of literals

TypeScript has an `enum` keyword. This project bans it, and the ban is enforced by
`erasableSyntaxOnly` in `tsconfig.json`.

```ts
// next-app/src/types/content.ts — the two options (illustration)
// ❌ A TypeScript enum. EMITS RUNTIME CODE — an object, in your bundle.
enum Environment {
  Production = 'PRODUCTION',
  Staging = 'STAGING',
}

// ✅ A union of literals. Erased completely, and it IS the wire format.
type IncidentEnvironment = 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT' | 'WORKS_ON_MY_MACHINE';
```

| | `enum` | Union of literals |
|---|---|---|
| Runtime footprint | an object in the output | **none — erased** |
| Comparing to a string from an API | needs a cast or a lookup | **direct** — the values are the strings |
| Import required to use a member | yes | no |
| Allowed by `erasableSyntaxOnly` | **no** | yes |
| What codegen produces for a GraphQL enum | optional | **this, by default** |

**Prefer the union, always.** The decisive argument is the third row: WPGraphQL sends the string
`"PRODUCTION"` over the wire, and a union of literals *is* that string, with no translation
layer. An `enum` adds a runtime object whose only job is to hold the string you already have, and
then every comparison needs the import. Module 10's codegen defaults to the union for exactly
this reason, so choosing it now means the generated types look like the ones you hand-wrote.

### 9. `unknown`, `any` and `never`

Three types that describe "I do not know", "stop checking" and "impossible".

| | `any` | `unknown` | `never` |
|---|---|---|---|
| Assign anything **to** it | yes | yes | no |
| Assign it **to** something else | **yes — silently** | no, until narrowed | yes (it is assignable to everything) |
| Property access | allowed, unchecked | **error until narrowed** | error |
| Use it for | nothing, ideally | data from outside the program | exhaustiveness checks, functions that never return |

```ts
// next-app/src/types/content.ts — the JSON boundary (illustration)
const loose: any = JSON.parse(text);
console.log(loose.data.incidents.nodes.length); // compiles. May explode. No warning.

const parsed: unknown = JSON.parse(text);
// console.log(parsed.data);  ❌ 'parsed' is of type 'unknown' — good.
if (typeof parsed === 'object' && parsed !== null && 'data' in parsed) {
  // narrowed here, and only here
}
```

`any` is not "I will type it later"; it is "disable the checker for this value **and everything
derived from it**". One `any` in a data-fetching helper silently untypes every component
downstream, which is the most common way a strict codebase quietly stops being strict.
`response.json()` returns `Promise<any>` in the standard library, so this is not a hypothetical
— it is the first thing Lesson 07.4 fixes.

`never` looks academic and is not: it is how you make the compiler prove a `switch` is
exhaustive, which is the centrepiece of Lesson 07.4.

### 10. How to read a `tsc` error

TypeScript's errors are long because they are precise. They are also structured, and the
structure tells you where to look.

```
src/types/_scratch.ts:14:7 - error TS2322: Type '{ id: string; name: string; slug: string; }'
is not assignable to type 'SeverityTerm'.
  Types of property 'slug' are incompatible.
    Type 'string' is not assignable to type 'SeverityLevel'.
```

| Part | What it gives you |
|---|---|
| `_scratch.ts:14:7` and `TS2322` | file, line, column, and a searchable error code |
| First line | the *outermost* mismatch — usually the least useful sentence |
| Indented lines | the compiler drilling down, one level per indent |
| **Last line** | the actual problem |

**Read the last line first.** Each indentation level is the compiler saying "and the reason for
the line above is…". Here: a `string` where a `SeverityLevel` was required — someone typed a
severity slug by hand instead of using the union. The first line told you an object was wrong;
the last line told you which character.

Three error shapes you will meet constantly:

| Message | Almost always means |
|---|---|
| `Object is possibly 'null'` / `'undefined'` | You skipped a nullability check `strictNullChecks` demands |
| `Property 'x' does not exist on type 'y'` | A typo, or a field you did not select in the query |
| `Type 'string' is not assignable to type '…'` | You used a bare string where a literal union is required |

---

## Task

### Step 1: Confirm the compiler is installed

TypeScript arrived as a devDependency in Lesson 07.1, so there is nothing to install.

```bash
cd next-app
npx tsc --version
# Expected: Version 5.9.x or newer. If npx offers to DOWNLOAD tsc, run `npm ci` first —
#           you are not using the project's own copy.
```

### Step 2: Write `tsconfig.json`

`tsconfig.json` permits comments despite the name, so this file documents itself. Every
non-default setting has a reason on the line next to it.

```jsonc
// next-app/tsconfig.json
{
  "compilerOptions": {
    /* ── Language and libraries ─────────────────────────────────────── */
    "target": "ES2023", // Node 22 runs all of it; nothing is downlevelled
    "lib": ["ES2023"], // no "DOM" — this module has no browser. Lesson 08.1 adds it.
    "types": ["node"], // @types/node: process, Buffer, the node: modules

    /* ── Modules ────────────────────────────────────────────────────── */
    "module": "NodeNext",
    "moduleResolution": "NodeNext", // resolve specifiers exactly the way Node does
    "moduleDetection": "force", // every file is a module; no accidental global scripts
    "verbatimModuleSyntax": true, // emit imports as written — forces `import type`
    "allowImportingTsExtensions": true, // write './content.ts', the path Node really loads
    "erasableSyntaxOnly": true, // ban `enum`, `namespace`, parameter properties

    /* ── Output ─────────────────────────────────────────────────────── */
    "noEmit": true, // tsc JUDGES. It does not build. Module 09's Next.js builds.
    "skipLibCheck": true, // do not type-check dependencies' own .d.ts files
    "forceConsistentCasingInFileNames": true, // macOS is case-insensitive; Linux CI is not

    /* ── Correctness ────────────────────────────────────────────────── */
    "strict": true, // the eight flags from Key Concept 3. Never negotiated.
    "noUncheckedIndexedAccess": true, // arr[0] is T | undefined — the surprising one
    "exactOptionalPropertyTypes": true, // `?` means ABSENT, not "may be undefined"
    "noFallthroughCasesInSwitch": true, // every case breaks or returns
    "noImplicitReturns": true, // no branch may forget to return
    "noUnusedLocals": true, // dead bindings fail the build
    "noUnusedParameters": true // prefix with _ when a signature forces one
  },
  "include": ["src/**/*.ts", "scripts/**/*.ts"]
}
```

Two absences worth naming. There is no `"jsx"` setting and no `"DOM"` library, because there is
no React and no browser in this module — Lesson 08.1 adds both, for the React harness. And
`allowJs` is off, so
`scripts/blame.mjs` is **invisible to `tsc`**: it is checked by ESLint in Lesson 07.5 and
replaced by a typed version in Lesson 07.4.

### Step 3: Wire the type-check script

```bash
npm pkg set scripts.type-check="tsc --noEmit"
npm pkg get scripts.type-check
# Expected: "tsc --noEmit"
```

`typecheck` already delegates to `type-check` from Lesson 07.1, so both spellings now work.

Do **not** run it yet: `include` currently matches no files, and `tsc` reports `TS18003 No
inputs were found` — which is a correct complaint about an empty project, not a broken config.

### Step 4: Model the content contract

Now the content-model review, disguised as a language lesson. Every field name, every enum value
and every nullability decision below comes from
[appendix 03](../appendix/03-content-model-reference.md) — §2 for the taxonomies, §3 for the
enums, §4.1 for `Incident Details`. If this file and the appendix disagree, the appendix is
right.

This is the **incident half** of the model. Lesson 07.4 adds `Scapegoat`, `TechReview`, the
media edges and the generics, and finishes the file.

```bash
mkdir -p src/types
```

```ts
// next-app/src/types/content.ts
// The Blame The Tech content model, by hand, from the contract in appendix 03.
// Module 10 generates MOST of this from wordpress-headless/schema.graphql and deletes what it
// replaces. What survives is the part codegen cannot produce: the severity term slugs, which
// are taxonomy DATA rather than schema enums. Writing the rest once by hand is what makes that
// generated output readable — and Module 09 deliberately shows you what happens when a
// hand-written type drifts from the schema.

/* ── Registered GraphQL enums (appendix 03 §3) ────────────────────────────
   SCREAMING_SNAKE on the wire; the underlying ACF select values are kebab-case and
   the PHP resolver maps between them (Lesson 06.1). A client only sees the wire. */

export type IncidentEnvironment =
  | 'PRODUCTION'
  | 'STAGING'
  | 'DEVELOPMENT'
  | 'WORKS_ON_MY_MACHINE';

export type IncidentResolutionStatus = 'OPEN' | 'MITIGATED' | 'BLAMED' | 'WONTFIX';

export type TechReviewVerdict = 'ADOPT' | 'TRIAL' | 'ASSESS' | 'HOLD';

export type LeadSource = 'HOBT_HERO' | 'HOBT_CTA_BLOCK' | 'HOBT_FOOTER' | 'INCIDENT_SIDEBAR';

/* ── Taxonomy terms (appendix 03 §2) ─────────────────────────────────── */

// The `severity` taxonomy is a CLOSED set: four terms, created on activation, term UI
// locked to radio buttons, never extended. So it is a union, not a string.
export type SeverityLevel = 's1-catastrophic' | 's2-major' | 's3-minor' | 's4-cosmetic';

// `scapegoat` and `tech_stack` are free-form, so their slugs stay `string`.
export type Term = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly count: number | null; // wp_term_taxonomy.count — the leaderboard reads this
};

export type SeverityTerm = {
  readonly id: string;
  readonly name: string;
  readonly slug: SeverityLevel; // the whole point of the union
  readonly count: number | null;
};

/* ── Incident Details (appendix 03 §4.1) ─────────────────────────────── */

export type IncidentDetails = {
  readonly occurredAt: string | null; // ISO 8601 string. There is no Date over JSON.
  readonly downtimeMinutes: number | null;
  readonly estimatedCostUsd: number | null;
  readonly environment: IncidentEnvironment | null;
  readonly resolutionStatus: IncidentResolutionStatus | null;
  readonly blameConfidence: number | null; // Range 0–100, default 73
  readonly stackTrace: string | null; // rendered in <pre>, ESCAPED. Never as HTML.
  readonly reporterDisplayName: string | null; // denormalised — reporters are not WP authors
  readonly isVerified: boolean | null; // editor-only; the mutation discards client values
};

export type Incident = {
  readonly id: string; // the global relay ID
  readonly databaseId: number; // the WP post ID
  readonly slug: string;
  readonly title: string;
  readonly date: string | null;
  readonly blameScore: number | null; // registered in Lesson 06.1, computed server-side
  readonly incidentDetails: IncidentDetails | null;
  // In the schema these are Relay CONNECTIONS, not arrays, and `scapegoats` carries an
  // ACF term field group. Lesson 07.4 fixes both — flat `Term[]` is a placeholder.
  readonly severities: readonly SeverityTerm[];
  readonly scapegoats: readonly Term[];
  readonly techStacks: readonly Term[];
  readonly content?: string | null; // only when you select it
};

/* ── The response shape of the BlameBoard query from Lesson 07.2 ─────── */

// `incidents` is nullable because a GraphQL error arrives with HTTP 200 and no data.
export type BlameBoardData = {
  readonly incidents: { readonly nodes: readonly Incident[] } | null;
};
```

**Verify §4:**

- [ ] `npm run type-check` prints nothing and exits `0`. A file of pure type declarations
      always type-checks; the value is that the *names* are now checkable.
- [ ] Field names match §4.1 exactly — `estimatedCostUsd`, not `estimatedCostUSD`;
      `reporterDisplayName`, not `reporterName`. Check your file against the appendix line by
      line. This is the review, and it is the point of the exercise.
- [ ] Enum values are `SCREAMING_SNAKE` while `SeverityLevel` values are kebab-case slugs. They
      differ because one is a registered GraphQL enum and the other is a term slug.

> **`isVerified` is typed `readonly` and that changes nothing about security.** The mutation in
> Lesson 06.2 discards any client-supplied value server-side, and *that* is the control.
> `readonly` here documents the intent for the next developer; it does not enforce anything,
> because the type does not exist at runtime. Key Concept 1.

### Step 5: Make three errors on purpose, and read them properly

Start the watcher in a second terminal:

```bash
npx tsc --noEmit --watch
```

Then create a scratch file. It is deleted at the end of this step and never committed.

```ts
// next-app/src/types/_scratch.ts — DELETE THIS FILE at the end of Step 5
import type { Incident, SeverityLevel, SeverityTerm } from './content.ts';

// ERROR 1 — a typo in a closed set.
export const level: SeverityLevel = 's2-majro';

// ERROR 2 — nullable data, unhandled.
export function downtime(incident: Incident): number {
  return incident.incidentDetails.downtimeMinutes;
}

// ERROR 3 — noUncheckedIndexedAccess.
export function primarySeverity(incident: Incident): SeverityTerm {
  return incident.severities[0];
}
```

Read each message — last line first — then fix them in place:

| Error | Message | Fix |
|---|---|---|
| 1 | `Type '"s2-majro"' is not assignable to type 'SeverityLevel'` | `'s2-major'` |
| 2 | `'incident.incidentDetails' is possibly 'null'` | `return incident.incidentDetails?.downtimeMinutes ?? 0;` |
| 3 | `Type 'SeverityTerm \| undefined' is not assignable to type 'SeverityTerm'` | Return `SeverityTerm \| undefined`, or destructure and handle the empty case |

Error 2 is the important one and error 3 is the surprising one, and they are the same lesson from
two directions: the compiler has read your own content model and is describing a state your data
genuinely reaches — an incident saved without ACF fields, or one nobody ever classified.

Then delete the file:

```bash
rm src/types/_scratch.ts
npm run type-check
# Expected: no output
```

### Step 6: Commit

```bash
cd .. && git add next-app/tsconfig.json next-app/src/types/content.ts next-app/package.json
git commit -m "feat(web): strict tsconfig and the hand-written content model"
git status --short next-app/
# Expected: clean. In particular, no _scratch.ts.
```

---

## Verification

```bash
cd next-app

# 1. The project's own compiler, not a downloaded one
npx tsc --version
# Expected: Version 5.9.x or newer

# 2. The whole project type-checks
npm run type-check && echo "types OK"
# Expected: no output from tsc, then "types OK"

# 3. Strictness is actually on, in the RESOLVED config
npx tsc --showConfig | grep -E '"(strict|noUncheckedIndexedAccess|exactOptionalPropertyTypes|erasableSyntaxOnly|noEmit)"'
# Expected: all five present and true

# 4. The types are ERASED — compile content.ts and look at the output
OUT=$(mktemp -d)
npx tsc src/types/content.ts --outDir "$OUT" --target es2023 --module nodenext
grep -c 'SeverityLevel\|IncidentDetails\|readonly' "$OUT/content.js"
# Expected: 0 — not one type name survives. This is Key Concept 1, demonstrated.
rm -rf "$OUT"

# 5. NEGATIVE — a typo in a closed set fails the build
cat > src/types/_v1.ts <<'TS'
import type { SeverityLevel } from './content.ts';
export const bad: SeverityLevel = 's5-kinda-bad';
TS
npm run type-check; echo "exit=$?"
# Expected: TS2322 naming 's5-kinda-bad', then exit=1. NOT exit=0.
rm src/types/_v1.ts

# 6. NEGATIVE — unchecked index access fails the build
cat > src/types/_v2.ts <<'TS'
import type { Incident, SeverityTerm } from './content.ts';
export function first(i: Incident): SeverityTerm {
  return i.severities[0];
}
TS
npm run type-check; echo "exit=$?"
# Expected: "possibly 'undefined'" (or SeverityTerm | undefined), then exit=1
rm src/types/_v2.ts

# 7. NEGATIVE — `enum` is banned by erasableSyntaxOnly
cat > src/types/_v3.ts <<'TS'
export enum Environment {
  Production = 'PRODUCTION',
}
TS
npm run type-check; echo "exit=$?"
# Expected: "This syntax is not allowed when 'erasableSyntaxOnly' is enabled", exit=1
rm src/types/_v3.ts

# 8. Back to green, with no scratch files left behind
npm run type-check && ls src/types/
# Expected: no output from tsc, then exactly: content.ts

# 9. The contract's field names are spelled the contract's way
grep -c -E 'occurredAt|downtimeMinutes|estimatedCostUsd|blameConfidence|reporterDisplayName' src/types/content.ts
# Expected: 5

# 10. Only the intended files are tracked, and no scratch file survived
cd .. && git status --short next-app/
# Expected: clean — everything was committed in Step 6, and no _scratch or _v file exists
```

Checks 5, 6 and 7 are the ones that matter. A `tsconfig.json` that reports no errors because it
is not strict enough is worse than having no type checker, because it produces confidence
instead of information.

## Control Questions

1. A WPGraphQL response arrives with `incidentDetails.downtimeMinutes` as the string `"47"`
   instead of a number, and your type says `number | null`. Describe exactly what TypeScript
   does about it, where the failure eventually appears, and what the course does instead.
2. `noUncheckedIndexedAccess` made `incident.severities[0].name` an error. Explain what
   real-world state of your own database that error is describing, and give two different fixes
   with a reason to prefer one.
3. `field?: string`, `field: string | null` and `field?: string | null` are three different
   declarations. Map each one to the GraphQL situation it describes, using
   `Incident.content` and `IncidentDetails.stackTrace` as your examples.
4. This project bans `enum` in favour of unions of literals. Give the argument that has nothing
   to do with bundle size — the one about what WPGraphQL puts on the wire.
5. `interface` and `type` are interchangeable for every object in `content.ts`. Name the one
   capability `interface` has that `type` does not, name the module of this course that needs it,
   and say why that is not a reason to use `interface` everywhere.

## Learn More

- [TypeScript Handbook: Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html)
  — the canonical tour of primitives, unions, literals and object types, in about twenty minutes
- [TypeScript Handbook: `type` vs `interface`](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#differences-between-type-aliases-and-interfaces)
  — the official version of Key Concept 5's table, without the internet's shouting
- [tsconfig reference](https://www.typescriptlang.org/tsconfig) — every flag with an example of
  the code it rejects; the only reliable way to justify a setting you inherited
- [tsconfig: `noUncheckedIndexedAccess`](https://www.typescriptlang.org/tsconfig#noUncheckedIndexedAccess)
  — read this before you decide it is too annoying to keep on
- [tsconfig: `exactOptionalPropertyTypes`](https://www.typescriptlang.org/tsconfig#exactOptionalPropertyTypes)
  — why "absent" and "undefined" are different facts, which is exactly the GraphQL distinction
- [TypeScript 5.8 release notes: `erasableSyntaxOnly`](https://devblogs.microsoft.com/typescript/announcing-typescript-5-8/)
  — the flag, and the Node type-stripping work that motivated it
- [TypeScript Handbook: Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
  — read the first half now; Lesson 07.4 uses the second half
