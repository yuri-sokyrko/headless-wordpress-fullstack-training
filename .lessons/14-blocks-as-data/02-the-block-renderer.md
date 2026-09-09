---
title: 'The BlockRenderer'
module: 14
lesson: 2
teaches: [discriminated-unions, typename-narrowing, exhaustiveness-checking, rsc-recursion, block-registry, unknown-block]
produces: ['next-app/src/components/blocks/BlockRenderer.tsx', 'next-app/src/components/blocks/registry.ts', 'next-app/src/components/blocks/UnknownBlock.tsx', 'next-app/src/components/blocks/CoreParagraph.tsx']
requires: [14.1, 7.3]
---

# Lesson 14.2 — The BlockRenderer

## Quick Overview

`BlockRenderer` takes the flat list from Lesson 14.1 and turns it into a React tree. It is
roughly sixty lines and it is the most carefully designed component in the application, because
four decisions in it determine whether the block system stays maintainable for the next ten
modules or becomes a pile of special cases.

The four: **switch on `__typename`, never on `name`** — `name` is typed `string`, so it narrows
nothing and every branch would need a cast, whereas `__typename` is a literal union and gives
you real narrowing for free. **Put a `never`-typed `default` arm in**, so adding a block in
WordPress without mapping it in Next is a `npm run type-check` failure with the missing type
named in the error, rather than a blank space someone notices in production. **Own the recursion
in the renderer**, rebuilding the tree from `parentClientId` and passing children down, so that
individual block components never call `BlockRenderer` themselves and can therefore be tested in
isolation. And **`UnknownBlock` shouts in development, renders nothing in production, and never
falls back to `renderedHtml`** — a fallback that silently works is a fallback nobody ever
removes.

By the end of this lesson you will have:

- `next-app/src/components/blocks/registry.ts` — a `__typename`-keyed map from block type to component, typed so a wrong component signature fails to compile
- `next-app/src/components/blocks/BlockRenderer.tsx` — flat list to tree, recursion owned here, rendered as a Server Component
- `next-app/src/components/blocks/UnknownBlock.tsx` — a visible dev-only warning, `null` in production, no HTML fallback
- An exhaustiveness check that fails the build by name when a block type is unmapped, demonstrated by deleting a registry entry
- The blog detail route rendering through `BlockRenderer` instead of `dangerouslySetInnerHTML`, with the old code deleted rather than commented out

## Classic WP Analogy

WordPress has two mechanisms that do this job, and you have probably used both:

| Classic WordPress | `BlockRenderer` |
|---|---|
| `render_block` filter switching on `$block['blockName']` | `switch (block.__typename)` |
| `get_template_part('blocks/' . $name)` | `registry[block.__typename]` |
| `register_block_type` with a `render_callback` | a component per block in the registry |
| `$block['innerBlocks']` recursed by `render_block()` | the renderer rebuilding the tree from `parentClientId` |
| A missing template part → nothing rendered | `UnknownBlock` → a loud warning in dev |
| `has_block('btt/hobt-cta', $post)` | a lookup in the same typed list |

The template-part version is the closest, and it is worth naming why: dispatching on a string
to select a renderer is exactly what `get_template_part('blocks/' . $name)` does. The registry
is the same table, made explicit.

The analogy breaks on **what happens when the mapping is missing**, and this is the entire
argument for the `never` arm. `get_template_part('blocks/btt-hobt-cta')` with no such file
renders nothing at all: no error, no warning, no log line, and no way to discover it except a
human noticing a gap on a page. That failure mode is acceptable in PHP because PHP has no way to
know which block names exist. TypeScript does — the union of `__typename` values comes from the
committed schema — so it can tell you at build time that a case is unhandled. Assigning the
unmatched value to a `never`-typed variable is how you ask it to: if the union is fully covered,
the value in the `default` arm is `never` and the assignment compiles; if a case is missing, the
error names the type you forgot. That single line converts a silent content bug into a red CI
run.

The second break is about recursion and it is a genuine architectural difference.
`render_block()` recurses into `innerBlocks` itself, from inside the block being rendered, which
is fine because PHP has one stack and no boundaries. Here, recursion inside a block component
would mean every block component depends on the renderer, the renderer depends on the registry,
and the registry depends on every block component — a cycle that breaks tree-shaking, makes each
component untestable without the whole system, and makes it impossible to reason about which
components are Server Components. So the renderer takes the flat list, rebuilds the tree, and
passes each block's rendered children in as a prop. Block components receive `children` and
never think about nesting. That is why Lesson 14.1 selected `flat: true` and asked for
`parentClientId`.

One consequence worth stating for the next module: because `BlockRenderer` is a Server
Component, everything it renders is server-rendered by default, and a `btt/hobt-cta` that needs a
click handler becomes a client island *inside* the tree rather than turning the tree into
client code. Lesson 14.4 does exactly that.

---

## Key Concepts

### 1. Discriminated unions, recapped in one paragraph

You built one by hand in Lesson 07.4 and rehearsed the `switch` there, so this is a pointer
rather than a re-teach: go and reread that lesson's Key Concepts 5 and 6 if any of the next four
subsections feel like magic.

The short version. A **discriminated union** is a union of object types that all carry one
property whose type is a *different literal* in each member. Compare that property against a
literal and TypeScript narrows the whole object — every other property comes with it, for free,
with no cast. The generated `EditorBlocksFragment` element type from Lesson 14.1 is exactly such
a union, and the discriminating property is `__typename`.

What is genuinely new here is that the union is **not hand-written**. Lesson 07.4's `Block` was
seven members you typed out; this one is derived from a GraphQL document by a tool. That changes
the failure mode you care about: a hand-written union goes stale silently, a derived one changes
under you the moment somebody edits `editorBlocks.graphql` — and the rest of this lesson is
about making that change loud.

### 2. `__typename`, never `name`

WPGraphQL Content Blocks returns both. They look interchangeable and they are not.

| | `name` | `__typename` |
|---|---|---|
| Value | `btt/incident-callout` | `BttIncidentCallout` |
| Schema type | `String` | a **literal** per concrete type |
| Narrows a union | no | **yes** |
| Good for | a human-readable label in a warning | every dispatch decision in this module |

Here is what going the wrong way actually costs you. Write the switch on `name`:

```tsx
// (illustration — this does not compile, which is the point)
switch (block.name) {
  case 'btt/incident-callout':
    return block.attributes?.severity;
    //           ~~~~~~~~~~
    // error TS2339: Property 'attributes' does not exist on type
    //   '{ __typename: "BttIncidentCallout" | "CoreArchives" | … ; clientId?: string | null; … }'.
}
```

`name` is typed `string | null | undefined`, so comparing it against a literal tells the
compiler nothing about which member of the union you are holding. `block` is still the whole
union inside the `case`, so `attributes` — which only some members have — is an error. The only
way out is a cast, and a cast in every branch of a twelve-way dispatch is a type system you are
paying for and not using.

> **`name` is still worth selecting.** `UnknownBlock` prints it, because "no component for
> `btt/hobt-cta`" is a message you can act on and "no component for `BttHobtCta`" makes you
> translate back to WordPress in your head. One field, one job, and it is not narrowing.

### 3. The honest exhaustiveness story

Almost every tutorial on this pattern says: `switch` on the discriminant, add a `default` arm
that assigns the value to `never`, and the compiler will now fail your build if you forget a
case. That is true for a union you wrote by hand. **It is not true here**, and a lesson that
claimed otherwise would be teaching you to trust a check that does nothing.

The reason is the collapse from Lesson 14.1 Key Concept 9:

```
   EditorBlock interface
   ├── ~90 implementing types in the schema
   │
   │  your fragment names ONE of them with an inline fragment
   ▼
   generated union = 2 members
   ┌────────────────────────────────┐   ┌──────────────────────────────────────────┐
   │ { __typename: 'CoreParagraph'  │   │ { __typename: 'CoreHeading'              │
   │   clientId, parentClientId,    │   │              | 'BttIncidentCallout'      │
   │   name,                        │   │              | 'CoreArchives' | …86 more │
   │   attributes: { content } }    │   │   clientId, parentClientId, name }       │
   └────────────────────────────────┘   └──────────────────────────────────────────┘
             NAMED                                    COLLAPSED
        has `attributes`                          has NO `attributes`
```

`block.__typename` is therefore a union of **all ninety literals**, whether you wrote an inline
fragment for a type or not. So:

| Attempt | Does it prove your registry is complete? |
|---|---|
| `switch (block.__typename)` with a `never` default | **No.** You would have to write ninety cases to reach the default, and adding an inline fragment changes nothing about the set of literals |
| `Record<AllTypenames, Component>` | **No.** It demands ninety components, most of which are for blocks nobody can insert |
| A runtime `if (!registry[t]) console.warn(...)` | **No.** That is a log line in a build nobody watches |

What *does* work is two layers, and they check different things. Layer 1 proves the **mapping is
complete relative to the fragment**, at compile time. Layer 2 proves the **dispatch handled
everything the mapping did not**, also at compile time. Neither alone is enough; together they
are the check the module README promises, and Task §7 breaks it on purpose so you see it fail.

### 4. Layer 1 — mapping completeness, at compile time

The collapsed member cannot have an `attributes` property. `attributes` is declared on each
concrete block type and never on the interface, so a type that contributed only interface fields
provably has no such key. That single asymmetry is the hook:

```ts
// next-app/src/components/blocks/registry.ts — (illustration; Task §3 writes the real file)
type WithAttributes<T> = T extends unknown ? ('attributes' extends keyof T ? T : never) : never;

export type SupportedBlock = WithAttributes<Block>;         // the named members
export type UnsupportedBlock = Exclude<Block, SupportedBlock>; // the collapsed member
export type SupportedBlockTypename = SupportedBlock['__typename'];
```

Three details in four lines, each doing work:

- **`T extends unknown ? … : …`** is the idiom for making a conditional type *distribute* over a
  union. Without it, the condition is evaluated once against the whole union and you get one
  answer for twelve members.
- **`'attributes' extends keyof T`** and not `T extends { attributes: unknown }`. Codegen emits
  nullable selected fields as **optional** properties (`attributes?: … | null`), and an object
  type without a property is assignable to one where that property is optional — so the
  structural test matches everything and proves nothing. `keyof` includes optional keys, so the
  key-presence test is the one that discriminates.
- **`Exclude<Block, SupportedBlock>`** gives you the residual, which is exactly the collapsed
  member. Layer 2 uses it.

Then the map is declared against a **mapped type keyed on the typename**:

```ts
// next-app/src/components/blocks/registry.ts — (illustration)
export type BlockRegistry = {
  readonly [K in SupportedBlockTypename]: (props: BlockComponentProps<K>) => ReactNode;
};

export const blockRegistry = { CoreParagraph } satisfies BlockRegistry;
```

`satisfies` rather than a type annotation, deliberately: an annotation would widen
`blockRegistry` to `BlockRegistry` and you would lose the literal key set that Task §4's
`Object.keys()` depends on. `satisfies` checks and keeps the narrow type — which is the entire
reason the operator exists.

A mapped type rather than `Record<SupportedBlockTypename, SomeComponent>`, also deliberately:
mapping `K` *into the props* means each entry is checked against **its own** block type. Wiring
`CoreHeading: CoreParagraph` is then a compile error, and with a plain `Record` it would not be.

Delete one entry and this is what you get:

```
src/components/blocks/registry.ts:41:31 - error TS1360: Type '{ CoreHeading: …; CoreList: …; }'
  does not satisfy the expected type 'BlockRegistry'.
  Property 'CoreParagraph' is missing in type '{ CoreHeading: …; CoreList: …; }' but required
  in type 'BlockRegistry'.
```

**The error names the type you forgot.** That is the failure the module README promises in its
step 3, and Task §7 reproduces it.

### 5. Layer 2 — the residual assertion in the dispatch

Layer 1 says the map covers the fragment. It says nothing about the code that *uses* the map,
and the code that uses the map still has to do something with the collapsed member. So the
dispatch narrows past every supported typename and then annotates what is left:

```tsx
// next-app/src/components/blocks/BlockRenderer.tsx — (illustration)
if (isSupported(block)) {
  /* …render through the registry… */
}

// Narrowed past every supported __typename. The only member left is the collapsed
// one, and this annotation is the compiler agreeing.
const unsupported: UnsupportedBlock = block;
return <UnknownBlock name={unsupported.name ?? unsupported.__typename} />;
```

This is the `never`-arm idea with the honesty put back in. In the textbook version the residual
type *is* `never`, because the union was hand-written and fully handled. Here the residual is a
real type with real values in it — the eighty-nine blocks nobody mapped — so asserting `never`
would be a lie that happens to compile. Annotating the residual is the true statement:

| Change | What the annotation does |
|---|---|
| You add an inline fragment and a registry entry | that typename moves from the collapsed member into `SupportedBlock`; nothing here changes |
| A plugin upgrade splits the collapsed member into two shapes | `block` is no longer assignable to `UnsupportedBlock`; **this line stops compiling** |
| You map every one of the ninety implementors | `UnsupportedBlock` becomes `never`, `UnknownBlock` becomes dead code, and you get to delete it |

`isSupported` is a hand-written type predicate over `Object.keys(blockRegistry)`, which means it
is the one place a human asserts something the compiler cannot see: that the runtime keys of the
map are the compile-time keys of `BlockRegistry`. `satisfies` is what makes that true, and it is
worth knowing that this is where the trust sits.

### 6. The registry as a table

The registry is a lookup table, and it reads like one. This is the shape at the end of the
module — Task §3 writes the first row and the rest arrive with their components:

| `__typename` | Component | Written in | Job |
|---|---|---|---|
| `CoreParagraph` | `CoreParagraph` | **14.2** (placeholder) → 14.3 | inline rich text |
| `CoreHeading` | `CoreHeading` | 14.3 | `level` → `h2`–`h6` |
| `CoreList` / `CoreListItem` | `CoreList` / `CoreListItem` | 14.3 | `ordered`, and children |
| `CoreQuote` | `CoreQuote` | 14.3 | children plus a citation |
| `CoreCode` | `CoreCode` | 14.3 | escaped, never rendered |
| `BttIncidentCallout` | `IncidentCallout` | 14.4 | read attributes |
| `BttBlameQuote` | `BlameQuote` | 14.4 | render children |
| `BttScapegoatPicker` | `ScapegoatPicker` | 14.4 | resolve a reference |
| `BttIncidentTicker` | `IncidentTicker` | 14.4 | re-run a query |
| `BttHobtCta` | `HobtCta` | 14.4 | cross the client boundary |
| `CoreImage` | `CoreImage` | 14.5 | `next/image` |

Two conventions the table hides, both worth stating because the rest of the module depends on
them.

**Every component takes `{ block, locale, children? }` and nothing else.** `locale` is a prop
rather than something a component reaches for, because a block component may need a
locale-prefixed `href` — `IncidentCallout` links to `/{locale}/incidents/{slug}` — and Lesson
14.1's argument against `renderedHtml` listed "the route's locale, not WordPress's" as a cost.
Passing it down is how that promise is kept. It is a `string`, so it crosses into a client
component without ceremony.

**Every component's root element carries `data-block="<__typename>"`.** It is a convention, not
a test hook: Playwright locators in this course are `getByRole` plus an accessible name, never
an attribute selector. What `data-block` buys is a one-line answer to "did this page render as a
React tree or as a blob?", which is a question you will ask in four later modules — Module 15's
Starting State greps for it on `/en/hobt`, and Module 21 uses it to find which blocks are on the
critical path.

### 7. Flat list to tree, and the two edge cases

The grouping pass is the whole algorithm and it is smaller than the explanation.

```
   THE FLAT LIST (document order)              THE TREE
   ─────────────────────────────────────       ────────────────────────────────
   0  CoreHeading         parent: null         CoreHeading
   1  BttBlameQuote       parent: null         BttBlameQuote
   2  CoreParagraph       parent: "q1"   ──┐     └── CoreParagraph
   3  BttHobtCta          parent: null     │   BttHobtCta
                                           │
   clientId of #1 is "q1" ─────────────────┘

   Map<parentKey, Block[]>
     ROOT  → [ CoreHeading, BttBlameQuote, BttHobtCta ]
     "q1"  → [ CoreParagraph ]
```

One pass, in document order, appending each block to its parent's bucket. Because the list
arrives in document order and `Map` preserves insertion order, **siblings need no sorting** —
there is no `order` field to sort on and none is needed. Then render `ROOT`'s bucket, and for
each block render its own bucket as `children`.

Two inputs break the naive version, and neither is hypothetical.

**Edge case 1: a `parentClientId` nobody in the list owns.** It happens when a query returns a
subset of a post's blocks, or when a fixture is written by hand. The naive grouping puts that
block in a bucket keyed on a parent that never renders, so it silently disappears. The renderer
**adopts orphans at the root** instead: a paragraph in slightly the wrong place is a visible
content bug someone reports; a paragraph that vanished is a bug nobody can see.

**Edge case 2: a cycle.** Two blocks each naming the other as parent. Gutenberg cannot produce
it; a hand-written fixture or a bad migration can. Recursing into it is not a blank `<div>` — it
is an unbounded recursion inside a Server Component render, which means a hung request and,
eventually, a dead Node process. So the renderer carries the set of ancestor `clientId`s and
**refuses** to descend into one it has already seen, plus a depth cap as a second belt. Both
refusals log in development and are silent in production.

> **Refuse, do not repair.** Neither edge case tries to guess what the editor meant. The
> renderer's contract is "render what is renderable and complain about the rest", because the
> alternative — inferring a parent, or breaking a cycle at an arbitrary point — produces a page
> that looks fine and is wrong, which is strictly worse than a page with a gap and a log line.

### 8. Why the renderer owns the recursion

The obvious alternative is for `BlameQuote` to call `BlockRenderer` on its own children. It even
looks tidier. It creates an import cycle that costs you three things.

```
   RECURSION IN THE COMPONENTS (rejected)        RECURSION IN THE RENDERER (this course)
   ────────────────────────────────────────      ──────────────────────────────────────────
        registry.ts                                   registry.ts
            │ imports                                     │ imports
            ▼                                             ▼
        BlameQuote.tsx                                BlameQuote.tsx
            │ imports                                     (imports NOTHING from blocks/)
            ▼
        BlockRenderer.tsx                             BlockRenderer.tsx
            │ imports                                     │ imports
            ▼                                             ▼
        registry.ts   ◀── CYCLE                       registry.ts   ── acyclic
```

| Cost | Detail |
|---|---|
| Tree-shaking | The cycle makes every block component reachable from every other, so a route that renders one paragraph pulls the whole registry into its module graph |
| Testability | Module 23.2 wants to render `BlameQuote` alone with React Testing Library. In the cyclic version, importing it imports the renderer, which imports the registry, which imports all twelve components — so the "unit" test boots the system |
| RSC reasoning | `HobtCta` is `'use client'`. If a client component could reach `BlockRenderer`, the renderer would be pulled into the client graph, and with it every component in the registry. One `'use client'` leaf would convert the whole tree |

That third row is the one that would actually hurt, and it is the reason the rule is absolute:
**no file under `src/components/blocks/` imports `BlockRenderer` except `BlockRenderer.tsx`
itself.** Verification greps for it.

### 9. `children` as a prop, and `key` as `clientId`

Because the renderer owns the recursion, a block component receives its rendered children as an
ordinary `children` prop. Two consequences worth naming.

**It makes block components trivially testable.** `<BlameQuote block={fixture}><p>x</p></BlameQuote>`
is a complete test — no renderer, no registry, no GraphQL, no mock. Lesson 23.2's component
tests are short because of this decision, and that is not a coincidence: `children` as a prop is
the standard React answer to "how do I test a container without its contents".

**It makes the container's contract obvious.** `BlameQuote` renders `{children}` inside a
`<blockquote>` and has no opinion about what they are. A component that called the renderer
would have to know about `clientId`s, buckets and depth — none of which is a quote's business.

And `key`. The React key for each block is its **`clientId`**, never the array index:

| Key | An editor moves the CTA above the quote and saves |
|---|---|
| `key={index}` | React sees the same keys in the same positions and *reuses* the components. A client island keeps the state of the block that used to be in that slot, and a transition animates the wrong element. In development you also get the wrong `data-block` briefly |
| **`key={block.clientId}`** | React matches by identity, moves the DOM nodes, and state follows the block it belongs to |

`clientId` is typed `String` and therefore nullable, so the renderer falls back to a
parent-plus-index key when it is missing. Say out loud what that fallback costs — it reintroduces
the index-key problem for that one block — and note that it has never fired against real
WordPress output.

### 10. `BlockRenderer` is a Server Component, and `UnknownBlock` is dev-loud

`BlockRenderer.tsx` has **no `'use client'` directive**, which in the App Router means it is a
Server Component. That is not a detail; it is what makes Lesson 14.4 possible.

```
   Server Component tree                        no JS shipped for any of this
   ├── [locale]/hobt/page.tsx
   │   ├── HobtHero
   │   └── BlockRenderer                    ← Server Component, no directive
   │       ├── CoreHeading                  ← server
   │       ├── IncidentCallout              ← server
   │       └── HobtCta       'use client'   ← ONE island, and the boundary stops here
   └── HobtModules                              its attributes cross as plain props
```

A `'use client'` directive on `BlockRenderer` would put the renderer, the registry and therefore
every block component into the client bundle, and every block's data into the RSC payload as
serialised props. The tree stays on the server precisely so that one interactive leaf costs one
interactive leaf.

`UnknownBlock` closes the loop, and its three properties are all deliberate:

| Property | Why |
|---|---|
| A visible red box naming the block, in development | You find the gap while writing the feature, not from a support ticket |
| `null` in production | An editor's stray block must not put a developer warning in front of a customer. `process.env.NODE_ENV` is inlined at build time, so the box is dead-code-eliminated |
| **Never a `renderedHtml` fallback** | This is the whole argument. A fallback that renders *something* removes the pressure to write the component, so the fallback becomes the renderer for a third of your blocks and nobody notices for a year. Lesson 14.1's decision record already refused to select the field; this is where the refusal earns its keep |

Note the consequence of the third row: an unmapped **parent** swallows its children, because
`UnknownBlock` renders neither the block nor what was inside it. That is correct. Rendering a
quote's paragraphs outside their quote is worse than not rendering them, and you will see it
happen at the end of this lesson.

---

## Task

### Step 1: Write `UnknownBlock.tsx`

Start at the leaf that has no dependencies.

```tsx
// next-app/src/components/blocks/UnknownBlock.tsx
// Loud in development, silent in production, and NEVER an HTML fallback.
// Lesson 14.1's decision record explains why the fallback is refused; this file
// is what makes refusing it survivable.

export function UnknownBlock({ name }: { readonly name: string }) {
  // NODE_ENV is inlined by the bundler, so in a production build this whole
  // component collapses to `return null` and the markup below is eliminated.
  if (process.env.NODE_ENV === 'production') return null;

  return (
    <div
      data-block="UnknownBlock"
      className="my-4 rounded-md border-2 border-dashed border-destructive bg-destructive/10 p-4 text-sm"
    >
      <p className="font-semibold text-destructive">Unmapped block: {name}</p>
      <p className="mt-1 text-muted-foreground">
        Nothing is registered for this block, so it renders nothing in production. Add an inline
        fragment to <code>src/graphql/fragments/editorBlocks.graphql</code> and a matching entry
        to <code>src/components/blocks/registry.ts</code> — the compiler will insist on both.
      </p>
    </div>
  );
}
```

No `<main>`, no `<header>`, no `<footer>`, here or in any other file in this directory. Lesson
11.4 moved those three landmarks into `src/app/[locale]/layout.tsx` and Lesson 12.3's smoke spec
asserts `getByRole('main')` has a count of exactly **1** on every route. A block component that
opens a second one turns nine passing tests red.

### Step 2: Write the `CoreParagraph` placeholder

One block component, so the tree has something to render before Lesson 14.3 arrives.

```tsx
// next-app/src/components/blocks/CoreParagraph.tsx
// PLACEHOLDER for ONE lesson. Lesson 14.3 replaces the body with <RichText>.
//
// `content` is HTML — the editor put <strong>, <em> and <a> inside it. Rendering
// it as JSX text means React escapes it, so for this one lesson your paragraphs
// display their own tags. That is deliberate and it is not a bug: the alternative
// is an unsanitized dangerouslySetInnerHTML "just until 14.3", which is exactly
// the fallback nobody removes.
import type { BlockComponentProps } from '@/components/blocks/registry';

export function CoreParagraph({ block }: BlockComponentProps<'CoreParagraph'>) {
  // Every attribute is nullable — Lesson 14.1 Key Concept 4.
  const content = block.attributes?.content ?? '';

  // An empty paragraph is a real thing editors leave behind. Render nothing
  // rather than a <p> with a margin, which shows up as a mystery gap.
  if (content.trim() === '') return null;

  return (
    <p data-block={block.__typename} className="my-4 leading-relaxed">
      {content}
    </p>
  );
}
```

### Step 3: Write `registry.ts` — the type machinery, and one row

This is the file the module turns on. Read the comments; they are the lesson.

```ts
// next-app/src/components/blocks/registry.ts
// The __typename → component map, plus the type machinery that makes it complete.
//
// NO `import 'server-only'` here, deliberately: Module 23 unit-tests block
// components in a plain Node process, where that package throws on purpose. The
// same reasoning as tags.ts and errors.ts in Module 10.
import type { ReactNode } from 'react';

import { CoreParagraph } from '@/components/blocks/CoreParagraph';
import type { EditorBlocksFragment } from '@/gql/graphql';

/** One entry of the flat list from Lesson 14.1's fragment. */
export type Block = NonNullable<NonNullable<EditorBlocksFragment['editorBlocks']>[number]>;

/**
 * Distributes over the union (that is what `T extends unknown ?` is for) and
 * keeps the members that selected `attributes`. The collapsed member cannot have
 * it: `attributes` is declared per concrete block type and never on the
 * EditorBlock interface. `'attributes' extends keyof T` and NOT
 * `T extends { attributes: unknown }` — codegen emits nullable selected fields as
 * OPTIONAL properties, and every object type is assignable to one whose extra
 * property is optional, so the structural test would match all of them.
 */
type WithAttributes<T> = T extends unknown ? ('attributes' extends keyof T ? T : never) : never;

/** The blocks this app renders. DERIVED from the fragment — never hand-listed. */
export type SupportedBlock = WithAttributes<Block>;

/** The residual: the collapsed member. `UnknownBlock` renders these. */
export type UnsupportedBlock = Exclude<Block, SupportedBlock>;

export type SupportedBlockTypename = SupportedBlock['__typename'];

/**
 * Props every block component receives, and the complete list.
 * · `block`   — narrowed to this component's own type, so no casts inside it.
 * · `locale`  — a locale-prefixed href is a block's business; Lesson 14.1 listed
 *               "WordPress's locale, not the route's" as a cost of renderedHtml,
 *               and this prop is how that promise is kept. A string, so it
 *               crosses the client boundary in Lesson 14.4 with no ceremony.
 * · `children`— the rendered subtree, handed IN by BlockRenderer. A component
 *               never renders its own children. Key Concept 8.
 */
export type BlockComponentProps<TTypename extends SupportedBlockTypename> = {
  readonly block: Extract<SupportedBlock, { readonly __typename: TTypename }>;
  readonly locale: string;
  readonly children?: ReactNode;
};

/**
 * A MAPPED type, not Record<SupportedBlockTypename, SomeComponent>: mapping the
 * key into the props means each entry is checked against its own block type, so
 * `CoreHeading: CoreParagraph` is a compile error too, not just a missing key.
 */
export type BlockRegistry = {
  readonly [K in SupportedBlockTypename]: (props: BlockComponentProps<K>) => ReactNode;
};

/**
 * `satisfies`, not `: BlockRegistry`. An annotation would widen this to the mapped
 * type and BlockRenderer's `Object.keys(blockRegistry)` would lose the literal key
 * set it depends on. `satisfies` checks and keeps the narrow type.
 *
 * Adding a `... on X` inline fragment to editorBlocks.graphql without adding a row
 * here is a type error NAMING X. Deleting a row while the fragment still names the
 * type is the same error. Task Step 7 proves it.
 */
export const blockRegistry = {
  CoreParagraph,
  // 14.3 → CoreHeading, CoreList, CoreListItem, CoreQuote, CoreCode
  // 14.4 → BttIncidentCallout, BttBlameQuote, BttScapegoatPicker,
  //        BttIncidentTicker, BttHobtCta
  // 14.5 → CoreImage
} satisfies BlockRegistry;
```

> **`CoreParagraph.tsx` imports a type from `registry.ts`, and `registry.ts` imports
> `CoreParagraph` as a value.** That is a cycle at the type level and **not** at runtime:
> `import type` is fully erased under `verbatimModuleSyntax` (Lesson 07.3), so the emitted
> JavaScript has one edge, not two. The distinction matters — a *value* import of `registry.ts`
> from a block component would be a genuine runtime cycle and exactly the shape Key Concept 8
> rejects. Verification greps that every such import says `import type`.

**Verify §3:**

- [ ] `npm run type-check` is silent.
- [ ] Hover `SupportedBlockTypename` in your editor. It is `'CoreParagraph'` — one literal,
      because the fragment names one type. If it is a union of ninety names, `WithAttributes`
      matched everything: check you wrote `'attributes' extends keyof T` and not a structural
      test.
- [ ] Hover `UnsupportedBlock`. Its `__typename` is a very long union and it has **no**
      `attributes` property.

### Step 4: Write `BlockRenderer.tsx`

```tsx
// next-app/src/components/blocks/BlockRenderer.tsx
// Flat list → React tree. The ONLY place recursion happens in this system.
//
// No 'use client' directive, deliberately: this is a Server Component, so Lesson
// 14.4's client island lands INSIDE the tree instead of converting it. Key
// Concept 10.
import type { ReactNode } from 'react';

import { UnknownBlock } from '@/components/blocks/UnknownBlock';
import { blockRegistry } from '@/components/blocks/registry';
import type { Block, SupportedBlock, UnsupportedBlock } from '@/components/blocks/registry';

/** Deeper than this is a cycle or a mistake. Either way, refuse. */
const MAX_DEPTH = 12;

/** The bucket key for top-level blocks. WordPress clientIds are UUIDs, so this
 *  cannot collide with one. */
const ROOT = '::root';

/**
 * The runtime keys of the map. `satisfies BlockRegistry` in registry.ts is what
 * makes "runtime keys === compile-time keys" true, which is what makes the
 * predicate below honest. Key Concept 5.
 */
const SUPPORTED: ReadonlySet<string> = new Set(Object.keys(blockRegistry));

function isSupported(block: Block): block is SupportedBlock {
  return SUPPORTED.has(block.__typename);
}

type Tree = ReadonlyMap<string, readonly Block[]>;

function buildTree(blocks: readonly Block[]): Tree {
  // 1. Which clientIds this list actually contains.
  const present = new Set(
    blocks.map((b) => b.clientId).filter((id): id is string => typeof id === 'string')
  );

  // 2. One bucket per parent, filled in document order. Map preserves insertion
  //    order, so siblings need no sorting and there is no `order` field to sort on.
  const tree = new Map<string, Block[]>();
  for (const block of blocks) {
    const parent = block.parentClientId;

    // EDGE CASE 1 — a parentClientId nobody here owns. Adopt the orphan at the
    // root instead of dropping it: a paragraph in the wrong place gets reported,
    // a paragraph that vanished does not. Key Concept 7.
    const key = typeof parent === 'string' && present.has(parent) ? parent : ROOT;

    const bucket = tree.get(key);
    if (bucket === undefined) tree.set(key, [block]);
    else bucket.push(block);
  }

  return tree;
}

function BlockNode({
  block,
  locale,
  children,
}: {
  readonly block: Block;
  readonly locale: string;
  readonly children?: ReactNode;
}) {
  if (isSupported(block)) {
    // The ONE type assertion in this system, and here is why it is needed:
    // blockRegistry[k] holds the exact component type for k, but TypeScript
    // cannot relate the two sides of an indexed access when the key is itself a
    // union, so the call site has to widen. registry.ts is what makes it safe —
    // `satisfies BlockRegistry` already checked every value against its own key.
    const Component = blockRegistry[block.__typename] as (props: {
      readonly block: SupportedBlock;
      readonly locale: string;
      readonly children?: ReactNode;
    }) => ReactNode;

    return (
      <Component block={block} locale={locale}>
        {children}
      </Component>
    );
  }

  // LAYER 2 of the exhaustiveness check. `block` has been narrowed past every
  // supported __typename, so the only member left is the collapsed one — and this
  // annotation is the compiler agreeing. If a plugin upgrade ever splits that
  // member into two shapes, THIS line is what stops compiling. Key Concept 5.
  const unsupported: UnsupportedBlock = block;

  // `name` is the WordPress name (`btt/hobt-cta`), which is what you can act on.
  return <UnknownBlock name={unsupported.name ?? unsupported.__typename} />;
}

function renderLevel(
  tree: Tree,
  parentKey: string,
  locale: string,
  seen: ReadonlySet<string>,
  depth: number
): ReactNode {
  const level = tree.get(parentKey);
  if (level === undefined) return null;

  if (depth > MAX_DEPTH) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[blocks] refusing to recurse past depth ${MAX_DEPTH} under "${parentKey}"`);
    }
    return null;
  }

  return level.map((block, index) => {
    const id = block.clientId;

    // EDGE CASE 2 — a cycle. Unbounded recursion in a Server Component render is
    // a hung request, not a blank div, so refuse rather than repair.
    if (typeof id === 'string' && seen.has(id)) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[blocks] cycle: clientId "${id}" is its own ancestor`);
      }
      return null;
    }

    const children =
      typeof id === 'string'
        ? renderLevel(tree, id, locale, new Set([...seen, id]), depth + 1)
        : null;

    // key is the clientId, NEVER the index. Key Concept 9. `clientId` is typed
    // String and therefore nullable, so there is a fallback — and the fallback
    // reintroduces the index-key problem for that one block, which is the honest
    // cost of a nullable field the schema will not promise.
    return (
      <BlockNode key={id ?? `${parentKey}:${index}`} block={block} locale={locale}>
        {children}
      </BlockNode>
    );
  });
}

export function BlockRenderer({
  blocks,
  locale,
}: {
  // Exactly the shape the generated query type has: a nullable list of nullable
  // entries. With fragmentMasking off (Lesson 10.2) the spread is inlined, so a
  // route's `post.editorBlocks` is structurally this type and needs no adapter.
  readonly blocks: readonly (Block | null)[] | null | undefined;
  readonly locale: string;
}) {
  const list = (blocks ?? []).filter((b): b is Block => b !== null);
  if (list.length === 0) return null;

  const tree = buildTree(list);
  const roots = tree.get(ROOT);

  // Every block claims a parent that is present, so nothing is at the root: the
  // list is one big cycle. Say so rather than rendering an empty page.
  if (roots === undefined) {
    return <UnknownBlock name="the flat list is cyclic — no block is at the root" />;
  }

  return <>{renderLevel(tree, ROOT, locale, new Set(), 0)}</>;
}
```

**Verify §4:**

- [ ] `npm run type-check` and `npm run lint` are both silent.
- [ ] The file contains no `'use client'`. If your editor added one, delete it — Key Concept 10.
- [ ] `roots` is read, not just computed. If you deleted the cyclic-list guard,
      `npm run lint` fails on `@typescript-eslint/no-unused-vars`, which is the linter making
      the same point.

### Step 5: Drop `content` from `PostBySlug`, and spread the fragment

An anchored edit to an existing document, not a rewrite. Only the selection set changes.

```graphql
# next-app/src/graphql/posts.graphql — the detail query, edited
# `content` is GONE. The debt Lesson 09.4 took on and Lesson 10.5 re-labelled is
# paid here: the body is structured data, and no route renders an HTML blob.
query PostBySlug($slug: ID!) {
  post(id: $slug, idType: SLUG) {
    ...PostCardFields
    ...EditorBlocks
  }
}
```

`PostsList` above it is untouched — a list page renders cards, and a card has never wanted a
body.

```bash
cd next-app
npm run codegen

# The generated query type now carries editorBlocks and NOT content
grep -c 'PostBySlugQuery' src/gql/graphql.ts
```

**Verify §5:**

- [ ] `npm run codegen` is silent. An error naming `EditorBlocks` as unknown means the fragment
      file from Lesson 14.1 is not under `src/`, so codegen's `documents` glob never saw it.
- [ ] `npm run type-check` now **fails**, in `blog/[slug]/page.tsx`, because `post.content` no
      longer exists. That is the migration, and Step 6 is the fix. Read the error before you fix
      it.

### Step 6: Rewire the blog detail route, and delete the blob

```tsx
// next-app/src/app/[locale]/blog/[slug]/page.tsx — the import, added
import { BlockRenderer } from '@/components/blocks/BlockRenderer';
```

```tsx
// next-app/src/app/[locale]/blog/[slug]/page.tsx — the component body, edited
// `locale` joins the destructure: BlockRenderer passes it to every block, so an
// in-content link can be locale-correct. params is a Promise in Next 16.
const { locale, slug } = await params;

// …the fetchGraphQL call is UNCHANGED — same document constant, same
// { revalidate: 3600, tags: [postTag(slug), listTag('post')] } from Lesson 10.3.

if (post == null) notFound();

return (
  <>
    <h1 className="text-3xl font-semibold tracking-tight">{post.title}</h1>
    <time dateTime={post.date ?? undefined} className="text-sm text-muted-foreground">
      {(post.date ?? '').slice(0, 10)}
    </time>

    {/* The blob is GONE — deleted, not commented out. A commented-out
        dangerouslySetInnerHTML still matches the grep Module 24 turns into a CI
        gate, and it is an invitation to somebody in a hurry. */}
    <BlockRenderer blocks={post.editorBlocks} locale={locale} />
  </>
);
```

Now look at it: `npm run dev`, then `http://localhost:3000/en/blog/blog-01`.

You should see **one** paragraph and **seven** red boxes. That is correct, and it is the most
informative screen in the module: `block_showcase()` puts eight top-level blocks on `blog-01`
and exactly one of them is a `core/paragraph`. The heading, the callout, the quote, the picker,
the ticker, the verdict card and the CTA all have inline fragments and components arriving in
Lessons 14.3 and 14.4, and until then `UnknownBlock` names each one.

Note what you do **not** see: the paragraph nested inside `btt/blame-quote`. Its parent is
unmapped, and `UnknownBlock` renders neither the block nor its children. Key Concept 10's last
paragraph, on screen.

**Verify §6:**

- [ ] `/en/blog/blog-01` returns 200 and shows one real paragraph plus seven dashed red boxes.
- [ ] Each red box names a WordPress block name — `core/heading`, `btt/incident-callout` — not a
      GraphQL type name. If it prints `CoreHeading`, `name` is not selected in the fragment.
- [ ] `/en/blog/blog-03` shows one paragraph and no red boxes at all. Only the first two seeded
      posts carry the showcase; the rest are a single paragraph, so that route is already done.
- [ ] The `<h1>` is still the post title and there is still exactly one `<main>` on the page.
      Lesson 12.3's smoke spec asserts both.

### Step 7: Break the exhaustiveness check on purpose

This is the module README's step 3, and it is the reason the previous six steps were worth it.
Copy the file to `/tmp` first — never restore from git in the middle of a lesson, because the
file was created in this lesson and `git checkout` has nothing to give you back.

```bash
cp src/components/blocks/registry.ts /tmp/registry.ts.bak

# Delete the one entry. The fragment still names CoreParagraph, so the map is now
# incomplete relative to the fragment — which is precisely what Layer 1 checks.
python3 - <<'EOPY'
p = 'src/components/blocks/registry.ts'
s = open(p).read()
open(p, 'w').write(s.replace('\n  CoreParagraph,', '', 1))
EOPY

npm run type-check
# Read the WHOLE error. Two things are wrong and both are worth seeing:
#   TS1360 — the object does not satisfy BlockRegistry: property 'CoreParagraph'
#            is missing. THIS is the check. The error names the type you forgot.
#   TS6133 — 'CoreParagraph' is declared but its value is never read, from the
#            now-unused import. The linter would have caught that one; only the
#            first error could have caught the actual mistake.

npm run lint || true

# Restore, and prove you restored.
cp /tmp/registry.ts.bak src/components/blocks/registry.ts
rm /tmp/registry.ts.bak
npm run type-check
```

Now break it from the other side, which is the failure you will actually hit in Lesson 14.3:

```bash
cp src/graphql/fragments/editorBlocks.graphql /tmp/eb.graphql.bak

# Add an inline fragment with NO component behind it, anchored on the one that
# is already in the file.
python3 - <<'EOPY'
p = 'src/graphql/fragments/editorBlocks.graphql'
s = open(p).read()
anchor = '    ... on CoreParagraph {'
extra = '    ... on CoreSeparator {\n      attributes {\n        opacity\n      }\n    }\n'
open(p, 'w').write(s.replace(anchor, extra + anchor, 1))
EOPY

npm run codegen && npm run type-check
# Expected: TS1360 again, naming 'CoreSeparator' as missing from blockRegistry.
#           The fragment and the registry are now provably locked together, in
#           BOTH directions.

cp /tmp/eb.graphql.bak src/graphql/fragments/editorBlocks.graphql
rm /tmp/eb.graphql.bak
npm run codegen && npm run verify
```

> **This is the check that makes the rest of the module safe to write.** Without it, "add a
> block in WordPress, forget the component in Next" is a blank space on a page that a human has
> to notice. With it, it is a red CI run with the missing type's name in the message. Everything
> else in `src/components/blocks/` is ordinary React; this is the part that is load-bearing.

```bash
git add -A
git commit -m "feat(next): BlockRenderer, a typed block registry, and the blog body as a react tree"
```

---

## Verification

```bash
cd next-app

# 1. The whole quality gate: type-check, lint, format
npm run verify
# Expected: exit 0, no output from any of the three

# 2. The three files exist and nothing else snuck into the directory
ls src/components/blocks/
# Expected: BlockRenderer.tsx  CoreParagraph.tsx  UnknownBlock.tsx  registry.ts

# 3. The registry is derived from the fragment, not hand-listed
grep -c 'EditorBlocksFragment' src/components/blocks/registry.ts
# Expected: 1
grep -c 'satisfies BlockRegistry' src/components/blocks/registry.ts
# Expected: 1

# 4. The blog detail route renders as a React tree. `data-block` is the convention
#    from Key Concept 6, and Module 15's Starting State greps for it on /en/hobt.
#    Start `npm run dev` in another terminal first.
curl -s http://localhost:3000/en/blog/blog-01 | grep -o 'data-block' | wc -l
# Expected: 8 — one CoreParagraph plus seven UnknownBlock boxes (dev only).
#           block_showcase() emits 8 top-level blocks; exactly one is a paragraph.
#           `grep -o | wc -l`, not `grep -c`: the HTML arrives as one long line,
#           so -c would count that line ONCE however many blocks rendered.

curl -s http://localhost:3000/en/blog/blog-01 | grep -o 'data-block="[A-Za-z]*"' | sort | uniq -c
# Expected: 1 data-block="CoreParagraph"
#           7 data-block="UnknownBlock"

# 5. The paragraph nested inside btt/blame-quote is NOT rendered, because its
#    parent is unmapped and UnknownBlock renders no children. Key Concept 10.
curl -s http://localhost:3000/en/blog/blog-01 | grep -c 'It worked on my machine'
# Expected: 0   (it comes back in Lesson 14.4, with BlameQuote)

# 6. A post with no custom blocks is already finished
curl -s http://localhost:3000/en/blog/blog-03 | grep -o 'data-block="[A-Za-z]*"' | sort | uniq -c
# Expected: 1 data-block="CoreParagraph"    and no UnknownBlock at all

# 7. The route's own structure is intact — Lesson 12.3's smoke spec asserts both
curl -s http://localhost:3000/en/blog/blog-01 | grep -o '<h1' | wc -l
# Expected: 1
curl -s http://localhost:3000/en/blog/blog-01 | grep -o '<main' | wc -l
# Expected: 1

# 8. The dev-only warning really is dev-only. STOP `npm run dev` first — this
#    needs port 3000 to itself.
npm run build
npm run start &
sleep 6
curl -s http://localhost:3000/en/blog/blog-01 | grep -o 'data-block="UnknownBlock"' | wc -l
# Expected: 0 — the box is dead-code-eliminated in a production build.
curl -s http://localhost:3000/en/blog/blog-01 | grep -o 'data-block="CoreParagraph"' | wc -l
# Expected: 1 — the real block still renders.
kill %1

# 9. NEGATIVE — the blob is gone from the blog route, and it is DELETED rather
#    than commented out
grep -rn 'dangerouslySetInnerHTML' 'src/app/[locale]/blog/' | wc -l
# Expected: 0
grep -rl 'dangerouslySetInnerHTML' src/app/ | wc -l
# Expected: 2 — incidents/[slug] and reviews/[slug]. Lesson 14.4 removes both.

# 10. NEGATIVE — no block component imports the renderer. Exactly one file under
#     src/components/blocks/ mentions BlockRenderer, and it is BlockRenderer.tsx.
#     This is the acyclic-graph rule from Key Concept 8.
grep -rl 'BlockRenderer' src/components/blocks/ | wc -l
# Expected: 1
grep -rl 'BlockRenderer' src/components/blocks/
# Expected: src/components/blocks/BlockRenderer.tsx

# 11. NEGATIVE — every import of registry.ts from a block component is TYPE-only,
#     so the type-level cycle never becomes a runtime one
grep -rn "from '@/components/blocks/registry'" src/components/blocks/*.tsx
# Expected: every line begins with `import type`. A bare `import {` here is a
#           genuine require cycle and the shape Key Concept 8 rejects.

# 12. NEGATIVE — BlockRenderer is a Server Component, and nothing under blocks/ is
#     a client component yet. Lesson 14.4 adds exactly one.
grep -c "'use client'" src/components/blocks/BlockRenderer.tsx
# Expected: 0
grep -rl "'use client'" src/components/blocks/ | wc -l
# Expected: 0

# 13. NEGATIVE — no block component opens a second landmark. Lesson 11.4 put
#     main/header/footer in the layout and Lesson 12.3 asserts one of each.
grep -rn '<main\|<header\|<footer' src/components/blocks/
# Expected: no output

# 14. NEGATIVE — still nothing renders or selects renderedHtml, and there is still
#     no HTML fallback inside UnknownBlock
grep -rn 'renderedHtml' src/ | wc -l
# Expected: 0
grep -c 'dangerouslySetInnerHTML' src/components/blocks/UnknownBlock.tsx
# Expected: 0

# 15. Module 12's suites still pass. The blog detail route changed, and its smoke
#     assertion is on the h1 and the landmarks, both of which survived.
npm test -- --run
# Expected: 0 failures
npx playwright test
# Expected: 0 failures
```

If check 4 returns `0`, the route is still rendering the old markup from the Next build cache:
stop `npm run dev`, `rm -rf .next`, and start it again. If it returns `9`, you rendered the
nested paragraph too, which means `UnknownBlock` is passing `children` through — remove it.

## Control Questions

1. Explain, in terms of the generated union rather than in general, why a `switch` on
   `block.__typename` with `default: return assertNever(block)` would compile today and would
   still compile after you deleted every entry from `blockRegistry`.
2. `WithAttributes<T>` tests `'attributes' extends keyof T` rather than
   `T extends { attributes: unknown }`. Describe what the second version would return for the
   collapsed member, and say which codegen output detail — one word — makes it wrong.
3. `blockRegistry` uses `satisfies BlockRegistry` instead of `: BlockRegistry`. Name the one
   line in `BlockRenderer.tsx` that stops working if you change it to an annotation, and explain
   what it loses.
4. An editor drags the `btt/hobt-cta` block from the bottom of the HOBT page to the top and
   saves. Describe what the user sees on the next request if `BlockRenderer` keyed its children
   on the array index, and say which of the module's later components would exhibit it most
   visibly.
5. `UnknownBlock` renders no children, so an unmapped parent hides its whole subtree. Argue for
   that behaviour against the alternative — rendering the children in place — and name a
   concrete block from Module 13 where the alternative would produce a visibly wrong page.

## Learn More

- [TypeScript handbook — discriminated unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)
  — the mechanism Key Concept 1 recaps, with the compiler's own vocabulary for it
- [TypeScript handbook — exhaustiveness checking](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking)
  — the textbook `never` arm, worth reading precisely so you can see why Key Concept 3 says it
  is not enough here
- [The `satisfies` operator](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator)
  — check without widening, which is the entire reason `blockRegistry` is declared the way it is
- [Distributive conditional types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types)
  — why `T extends unknown ? … : …` is not the no-op it looks like
- [Mapped types](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html) — how
  `{ [K in SupportedBlockTypename]: … }` gets you per-key prop checking that a `Record` cannot
- [React — Server Components](https://react.dev/reference/rsc/server-components) — the boundary
  Key Concept 10 relies on, and where the `'use client'` directive actually applies
- [React — keeping list items in order with `key`](https://react.dev/learn/rendering-lists#keeping-list-items-in-order-with-key)
  — read the "why index keys are a problem" section next to Key Concept 9's table
- [graphql-codegen — the `client` preset](https://the-guild.dev/graphql/codegen/plugins/presets/preset-client)
  — the generator whose output shape Layer 1 is built on; the `fragmentMasking` section explains
  why a spread inlines here
- [WPGraphQL — interfaces and inline fragments](https://www.wpgraphql.com/docs/interfaces/) —
  the server side of the same story, useful when you are deciding what to add to the fragment
