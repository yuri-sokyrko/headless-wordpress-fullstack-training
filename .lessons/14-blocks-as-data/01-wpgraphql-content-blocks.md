---
title: 'WPGraphQL Content Blocks'
module: 14
lesson: 1
teaches: [wpgraphql-content-blocks, editor-blocks, block-attributes-over-the-wire, rendered-html-rejected, flat-block-list]
produces: ['next-app/src/graphql/fragments/editorBlocks.graphql', 'wordpress-headless/schema.graphql', 'next-app/src/gql/']
requires: [13.4, 10.2]
---

# Lesson 14.1 — WPGraphQL Content Blocks

## Quick Overview

The HTML blob you have been rendering since Module 09 was always a structured tree. Here it is.

`content` is a serialisation, not a document. Every `<div>` in it was produced from a block with
a name and typed attributes, and WordPress has always been able to hand you the structure rather
than the string. WPGraphQL Content Blocks exposes exactly that: `editorBlocks` on any content
node, a flat ordered list where each entry carries a `__typename`, a `clientId`, a
`parentClientId` and its own `attributes`. Query it once and the paragraph is a
`CoreParagraph`, the callout is a `BttIncidentCallout`, and `severity` is a string you can
switch on instead of a class name you have to parse. This is the most important conceptual
moment in the course, and it is worth pausing on: the loss of structure you have been working
around for five modules was never in the data, only in the field you were asking for.

The lesson also settles a decision that shapes the whole of `src/components/blocks/`. Every
block comes back with **both** `attributes` and `renderedHtml` — WordPress's own rendering of
that block — and `renderedHtml` looks like a shortcut that saves you writing twelve components.
It is not. Rendering it costs you client-side navigation, image optimisation, your design
system, the route's locale, cache-tag granularity, and it opens a `dangerouslySetInnerHTML`
surface writable by anyone with `edit_posts`. The rule for the rest of the course is short:
**never render `renderedHtml`.** This lesson makes the argument in full so that the rule is a
conclusion rather than a decree.

By the end of this lesson you will have:

- WPGraphQL Content Blocks installed and configured, with `btt/*` blocks appearing as generated GraphQL types
- `next-app/src/graphql/fragments/editorBlocks.graphql` — a flat `editorBlocks` selection with per-type inline fragments
- A refreshed `wordpress-headless/schema.graphql` and regenerated `next-app/src/gql/`, both committed, with the diff reviewed
- A GraphiQL side-by-side of the same blog post as `content` and as `editorBlocks`, saved for reference
- A written decision record rejecting `renderedHtml`, with the five costs enumerated and the one narrow exception named

## Classic WP Analogy

WordPress has shipped this exact capability in PHP since 5.0, and you may well have used it:

```
Classic PHP                                 WPGraphQL Content Blocks
──────────────────────────────────────────  ──────────────────────────────────────────
$blocks = parse_blocks($post->post_content);  editorBlocks(flat: true) {
foreach ($blocks as $b) {                       __typename
  $b['blockName']   // 'btt/incident-callout'   clientId
  $b['attrs']       // ['severity' => 's1…']    parentClientId
  $b['innerBlocks'] // nested array             ... on BttIncidentCallout {
  render_block($b); // ← the trap               attributes { severity headline }
}                                               }
                                              }
```

`parse_blocks()` is the same idea, and if you have written a `render_block` filter or built a
custom block-driven template you already have the mental model. `blockName` is `__typename`,
`attrs` is `attributes`, `innerBlocks` is what `parentClientId` reconstructs, and
`render_block()` is `renderedHtml`. The structure was always available; the only new thing is
that it now crosses a network boundary.

The analogy breaks in one good way and one dangerous way.

**The good break: `attrs` is untyped and `attributes` is not.** `parse_blocks()` returns
`attrs` as a plain associative array of whatever JSON happened to be in the comment — every
value is `mixed`, missing keys are silent, and a typo in `$b['attrs']['severty']` is a `null`
you find in production. WPGraphQL Content Blocks registers a **distinct GraphQL type per block**,
which means codegen produces a distinct TypeScript type per block, which means Lesson 14.2 can
build a discriminated union over them and have the compiler check that you handled every case.
This is the payoff for every hour spent in Module 10.

**The dangerous break: `render_block()` is the right answer in PHP and the wrong answer here.**
In a Classic theme, calling `render_block()` is correct — it is the same rendering path the rest
of the site uses, the theme's CSS matches the output, and links are ordinary anchors that work.
Reaching for `renderedHtml` in Next feels like the same move and is not, because the output is
now crossing into a system that shares none of those assumptions:

| Cost | Detail |
|---|---|
| No `next/link` | You get raw `<a href>`, so every internal link is a full document load |
| No `next/image` | Raw `<img src>` — no optimisation, no `sizes`, no LCP priority, and Module 21 fails |
| Wrong CSS | `wp-block-*` class names Tailwind never compiled a rule for, so it is unstyled or half-styled |
| Wrong locale | The blob is rendered in WordPress's current language, not the route's — Module 20 breaks |
| No cache granularity | HTML baked at WP render time, with nothing for `revalidateTag` to key on |
| An XSS surface | `dangerouslySetInnerHTML` fed by any user with `edit_posts`, which in this app means editors, not just administrators |

The one narrow exception is **inline** rich text — the `<strong>`, `<em>` and `<a>` inside a
paragraph's own text — which genuinely is HTML and genuinely has to be rendered as HTML.
Lesson 14.3 routes it through a single sanitizing component, and that component is the only place
`dangerouslySetInnerHTML` appears in the entire codebase.

---

## Key Concepts

### 1. What the plugin adds to the schema

WPGraphQL Content Blocks reads WordPress's **block type registry** and projects it into GraphQL.
Nothing about your content changes; a new view of it appears.

```
   post_content  (one TEXT column, HTML with comment delimiters)
        │
        │  parse_blocks()          ← core, since 5.0
        ▼
   array of blocks, each { blockName, attrs, innerBlocks, innerHTML }
        │
        │  WPGraphQL Content Blocks
        ▼
   NodeWithEditorBlocks.editorBlocks : [EditorBlock]
        │
        ├── interface EditorBlock          clientId · parentClientId · name · renderedHtml …
        ├── type CoreParagraph  implements EditorBlock   attributes { content align … }
        ├── type BttIncidentCallout  implements EditorBlock  attributes { severity headline … }
        └── … one concrete type per REGISTERED block type
```

Three facts follow, and they shape everything in this module.

| Fact | Consequence |
|---|---|
| The list of concrete types comes from the **PHP** block registry | A block registered only in JavaScript gets no type — Key Concept 5 |
| `attributes` is declared **per concrete type**, not on the interface | You cannot read `attributes` off an `EditorBlock` without narrowing first, which is exactly what makes Lesson 14.2's union work |
| The interface carries the tree metadata | `clientId` and `parentClientId` are the same on every block, so the renderer can be written once |

The five interface fields worth knowing, and what each is for:

| Field | Type | What you do with it |
|---|---|---|
| `__typename` | a **literal** per concrete type | **The discriminant.** Every narrowing decision in Module 14 is made on this |
| `clientId` | `String` | The identity of this block within this post. Lesson 14.2's React `key`, and the parent handle for children |
| `parentClientId` | `String` | The other half of the tree. `null` for a top-level block |
| `name` | `String` | `btt/incident-callout` — the WordPress name. **Typed `string`, so it narrows nothing.** Selected for the dev-only warning in `UnknownBlock`, and for nothing else |
| `renderedHtml` | `String` | WordPress's own rendering of the block. **Never selected in this course.** Key Concept 6 |

> **Introspect before you paste.** The interface's exact field list moves between plugin
> versions — some releases also expose `apiVersion`, `isDynamic`, `cssClassNames` and `type`.
> Task §2 prints the list from *your* schema; the fragment in §3 selects four fields that have
> been stable across every release this course was checked against. Anything extra is yours to
> use or ignore, but you should have looked.

### 2. `flat: true`, and why the consumer wants the flat shape

`editorBlocks` takes one argument that changes the shape of the answer completely.

```
NESTED (the default)                     FLAT (flat: true)
──────────────────────────────────       ──────────────────────────────────
[                                        [
  { CoreHeading }                          { CoreHeading,   parent: null },
  { BttBlameQuote,                         { BttBlameQuote, parent: null },
    innerBlocks: [                         { CoreParagraph, parent: "quote-1" },
      { CoreParagraph }                    { BttHobtCta,    parent: null },
    ] },                                 ]
  { BttHobtCta }
]
```

Both describe the same tree. The difference is who owns the recursion, and that is a real
decision rather than a taste.

| | Nested | **Flat + `parentClientId`** |
|---|---|---|
| GraphQL document | `innerBlocks { … }` repeated once per depth level you support | one selection, any depth |
| Depth limit | whatever you typed out — three levels of `innerBlocks` means four-deep content silently truncates | none |
| Generated types | a different type per depth, because `innerBlocks` at level 2 selected different fields than at level 1 | one type, reused |
| Recursion lives | in the block components, which then each depend on the renderer | **in the renderer, once** |
| Fragment reuse | impossible — a fragment cannot spread itself | one `EditorBlocks` fragment for every route |

The killer is the third row. GraphQL has **no recursive fragments**: you cannot write
`fragment Block on EditorBlock { innerBlocks { ...Block } }`, because a fragment may not spread
itself directly or transitively. So a nested selection has to be unrolled by hand to a fixed
depth, and every level you unroll is a separate generated TypeScript type describing the same
block. An editor who nests a quote inside a column inside a group finds the limit for you, in
production, silently.

Flat has one cost, and it is worth naming: **the client has to rebuild the tree** — roughly
fifteen lines of grouping code and two edge cases, written once in Lesson 14.2 and reused by
every route. A better trade than a document whose depth is a magic number.

### 3. Installing a plugin that is not in the .org directory

`wp-graphql-content-blocks` is maintained by WP Engine on GitHub and is **not** in the
WordPress.org plugin directory, so `wp plugin install wp-graphql-content-blocks` fails with
"Plugin not found." — the same failure Lesson 15.2 meets with
`wp-graphql-jwt-authentication`. `wp plugin install` accepts a **URL to a zip**, so the install
is one command against a **pinned release asset**:

```
https://github.com/wpengine/wp-graphql-content-blocks/releases/download/vX.Y.Z/wp-graphql-content-blocks.zip
                                                                    └──────┘
                                                    the tag. This is the whole discipline.
```

Compare the three ways to install it:

| Approach | Reproducible | Verdict |
|---|---|---|
| A pinned release-asset URL | yes — the tag names an immutable artifact | ✅ **this course** |
| `.../archive/refs/heads/main.zip` | no — "main" is whatever it is today, and it may not contain the built assets a release does | ❌ |
| Download by hand, drag into wp-admin | no — and it is invisible to the next person who clones the repo | ❌ |

The honest consequence: **a third-party plugin now sits between your content and your types.**
Its version determines your GraphQL type names, which determine your generated TypeScript,
which determines whether `src/components/blocks/` compiles — a supply-chain dependency with a
compiler attached. Three disciplines follow, none optional:

- **Pin the version and write it down.** It goes in `docs/schema-notes.md` in Task §7.
- **Treat an upgrade as a schema change.** `npm run schema:pull`, read the diff,
  `npm run codegen`, `npm run type-check`. Done when all four are clean, not when
  `wp plugin update` exits zero.
- **Never `wp plugin update --all`** here. Module 24 installs plugins at image build time with
  pinned versions for exactly this reason.

### 4. `attrs` versus `attributes`, and the untyped-to-typed jump

The Classic WP Analogy above set up the comparison; here is the part that matters when you are
reading generated code.

`parse_blocks()` gives you `$block['attrs']`, which is `json_decode()` of whatever text sat
inside the HTML comment. Every value is `mixed`. A missing key is `null`. A typo is `null`. A
number that an editor typed as a string is a string.

WPGraphQL Content Blocks builds each concrete type's `attributes` field from the block's
**`block.json`**, so the `type` you declared in Lesson 13.2 becomes the GraphQL type:

| `block.json` | GraphQL | TypeScript after codegen |
|---|---|---|
| `"severity": { "type": "string", "default": "s3-minor" }` | `severity: String` | `severity?: string \| null` |
| `"count": { "type": "number", "default": 5 }` | `count: Float` | `count?: number \| null` |
| `"severities": { "type": "array" }` | `severities: [String]` | `severities?: Array<string \| null> \| null` |
| `"termId": { "type": "number" }` | `termId: Float` | `termId?: number \| null` |

Note what the third column is **not**: not non-nullable, and not the enum you hoped for.
`severity` is `string`, not `'s1-catastrophic' | 's2-major' | …`, because `block.json` has no
enum concept — the `SelectControl` from Lesson 13.3 constrains the editor's UI, not the stored
data. Lesson 14.4 narrows it in TypeScript at the point of use, with a real guard.

And every attribute is **nullable**, which is correct and worth internalising now rather than
fighting: an attribute at its default value is **omitted from the serialised comment
altogether**. Look at the seeder's `btt/hobt-cta` — `{"label":"Stop blaming the tech","href":"/hobt"}`
and no `variant`, no `leadSource`, because both were at their defaults when Gutenberg
serialised it. The plugin reports the default where it can read one from `block.json`, but a
post written before an attribute existed has nothing at all. Lesson 14.4 turns that into a
worked example.

> **The corollary is a verification rule: never assert on the literal JSON inside a block
> comment.** `btt/incident-ticker`'s seeded instance carries
> `{"count":5,"severities":["s1-catastrophic","s2-major"]}`, which are exactly the **defaults**
> Lesson 13.4 declares — so the first time anyone opens `blog-01` in the editor and saves, both
> keys vanish from the comment while the parsed attributes stay identical. Assert on the
> **resolved** attributes instead: `jq` over an `editorBlocks` response, or
> `wp eval 'print_r( parse_blocks( … ) );'`. Nothing in this module greps a block comment.

### 5. "Why is my generated type `any`?" — the JS-only registration trap

The most common Content Blocks support question, and the answer is one sentence: **the server
can only type blocks the server knows about.**

```
   REGISTERED IN PHP + JS                    REGISTERED IN JS ONLY
   ────────────────────────────────          ────────────────────────────────
   register_block_type( 'build/x' )          registerBlockType( 'btt/x', … )
     reads build/x/block.json                  in your editor bundle only
        │                                            │
        ▼                                            ▼
   WP_Block_Type_Registry has 'btt/x'          registry is EMPTY on the server
        │                                            │
        ▼                                            ▼
   type BttX implements EditorBlock            NO concrete type exists
   attributes { … } fully typed                the block arrives as the bare
                                               interface — no `attributes`
```

The symptom is not a crash. The block renders fine in wp-admin, saves fine, sits in
`post_content` fine, and then arrives over GraphQL with a `__typename` you have no inline
fragment for and no `attributes` to read — landing in `UnknownBlock`, which is a red box in
development and nothing in production.

Three checks, in the order they are cheapest:

1. `docker compose run --rm wpcli wp eval 'print_r( array_keys( WP_Block_Type_Registry::get_instance()->get_all_registered() ) );'`
   — if `btt/x` is absent, PHP never registered it.
2. Confirm the plugin registers from **`build/`**, not `src/`. Registering `src/` is the usual
   cause, and appendix 06 §6 lists it as the top block-build mistake.
3. Only then look at the fragment.

> **This is a good reason to be glad Lesson 13.2 used `block.json`.** The pre-`block.json` way
> — `registerBlockType()` in JS plus a `register_block_type()` call declaring the attributes in
> PHP by hand — has two declarations that can drift. `block.json` has one, read by both
> runtimes, and that is what makes the generated type trustworthy.

### 6. The `renderedHtml` rejection, argued

Every block comes back with `renderedHtml`, WordPress's own HTML for that block. It is
genuinely tempting: one field, `dangerouslySetInnerHTML`, and you are done in an afternoon
instead of five lessons. The course rejects it, and this section is the argument rather than the
rule, because you will be asked to defend it in a code review.

**Cost 1 — you lose client-side navigation.** `renderedHtml` contains `<a href="/blog/foo">`,
and a raw anchor is a full document request: no App Router prefetch, the shared layout
re-rendered from scratch, and a perceived navigation cost of a round trip instead of ~50 ms.
*Symptom a reviewer can check:* click an in-content link. If the tab reloads, it came out of a
blob.

**Cost 2 — you lose image optimisation.** `renderedHtml` contains a raw `<img src>` with
WordPress's own `srcset`. `next/image` never sees it: no WebP/AVIF negotiation, no
`/_next/image` cache, no `priority` on the LCP element. Lesson 14.5 exists because that matters.
*Symptom:* `curl` the page and grep for `/_next/image`. Zero hits inside the article body.

**Cost 3 — you lose your design system.** The markup carries `wp-block-paragraph`,
`has-large-font-size` and friends, and Tailwind compiled **none** of them — its content scan
reads your source and your source never mentions them. The body is unstyled or half-styled.
*Symptom:* `grep -c 'wp-block-'` on the rendered page returns a non-zero number.

**Cost 4 — you lose the route's locale.** WordPress renders in *its* current language. A
`/de/blog/…` route asking for `renderedHtml` gets whatever Polylang thinks the request language
is, and Module 20 makes that a real divergence — dates, translated strings inside dynamic
blocks, and `render.php` output all follow WordPress rather than the URL you served.
*Symptom:* the German route shows an English "5 min read" that no translation file can reach.

**Cost 5 — you open a `dangerouslySetInnerHTML` surface with the wrong trust boundary.** The
string is authored by anyone with `edit_posts` — editors, and appendix 03 §6 is explicit that
the set is larger than "you". One `renderedHtml` render is a stored-XSS sink for every block on
the page, including blocks whose output you never inspected.
*Symptom:* `grep -rl 'dangerouslySetInnerHTML' src/` returns more than one file.

**The one narrow exception, and where it is handled.** Inline rich text — `<strong>`, `<em>`,
`<code>` and `<a>` *inside* a paragraph's own `content` attribute — genuinely is HTML, and there
is no structured representation of it to render instead. That single case goes through
`src/components/blocks/RichText.tsx` in Lesson 14.3, sanitized against a strict allowlist, and
that file is the only `dangerouslySetInnerHTML` in `next-app/`.

**The cost of refusing, stated plainly:** every block an editor can insert needs a React
component, and a block without one renders nothing in production. Right for a designed product
with a known block palette; **wrong** for a site where editors install arbitrary block plugins.
Building the second kind of site? Render `renderedHtml` deliberately, sanitize it, and accept
costs 1 through 4 as the price. What you must not do is take the shortcut by accident.

### 7. Why you do not select `renderedHtml` at all

A weaker version of the rule would be "select it, just do not render it". Reject that too, for
three reasons that are cheap to state and expensive to discover.

| Reason | Detail |
|---|---|
| It is not free | `renderedHtml` runs WordPress's full render pipeline per block, including `render.php` for `btt/incident-ticker` and every `render_block` filter. You pay PHP time and response bytes for a string you discard |
| A field you can read is a field someone renders | The fallback nobody removes starts as "just for now" in a pull request at 18:00 on a Friday |
| It is grep-enforceable only if it is absent | `grep -rn 'renderedHtml' src/` returning nothing is a check anyone can run and Module 24 can automate. "It is selected but only rendered in one place" is not a check |

So the invariant for the rest of the course is: **zero occurrences of `renderedHtml` anywhere
under `next-app/src/`, including the `.graphql` documents.** Verification asserts it here and
keeps asserting it through Module 24.

### 8. The schema round trip is a reviewed diff, not a build step

Activating this plugin is the largest single schema change in the course: roughly ninety
concrete block types, each with an `attributes` object type, plus two interfaces — several
thousand SDL lines.

```
   wp plugin install … --activate          ← the schema changes HERE
              │
              ▼
   npm run schema:pull                     ← wordpress-headless/schema.graphql rewritten
              │
              ▼
   git diff wordpress-headless/schema.graphql   ← READ IT. Skim, do not study
              │
              ▼
   npm run codegen                         ← next-app/src/gql/ rewritten
              │
              ▼
   git add + commit BOTH                   ← one commit, reviewable
```

This is a human action rather than a build step for Lesson 10.2's reason: codegen reads the
**committed** `schema.graphql`, so CI needs no WordPress, no database and no credential — and
the price is that a plugin activation does not reach your types until somebody runs
`schema:pull` on purpose.

> **This is the one time in the course to skim rather than read the schema diff.** Look for four
> things: `NodeWithEditorBlocks` appeared, `EditorBlock` appeared, your six `Btt*` types
> appeared, and **nothing you already depended on was removed or renamed.** That last one is the
> only failure mode that matters. Do not read ninety block types line by line — you will learn
> nothing and you will stop reading diffs.

### 9. What codegen emits for an interface selection — the collapse

This is the subtlest fact in the module and Lesson 14.2 is built on it, so it is stated here
first.

`EditorBlock` has roughly ninety implementing types. Your fragment names one of them with an
inline fragment. What does graphql-codegen do with the other eighty-nine?

It **collapses them into a single union member**. Codegen groups selection sets by shape: every
type that contributed only the interface fields produced the same object shape, so they are
emitted once, with `__typename` as a large string-literal union:

```ts
// next-app/src/gql/graphql.ts — (illustration of the emitted shape; do not edit this file)
export type EditorBlocksFragment = {
  readonly editorBlocks?: Array<
    // ONE member per inline fragment you wrote. Today that is exactly one.
    | { __typename: 'CoreParagraph'; clientId?: string | null; parentClientId?: string | null;
        name?: string | null; attributes?: { content?: string | null } | null }
    | { __typename: 'BttIncidentCallout' | 'CoreArchives' | 'CoreHeading' | /* ~86 more */;
        clientId?: string | null; parentClientId?: string | null; name?: string | null }
        //  ↑ ONE member. No `attributes`. This is "the collapsed member".
  > | null;
};
```

Two consequences, and both are load-bearing:

1. **A naive `switch (block.__typename)` with a `never` default cannot be exhaustive.** The
   union of `__typename` literals contains all ninety names whether you wrote an inline fragment
   or not, so "handle every literal" would mean writing ninety cases. Any lesson that claims a
   plain `never` default proves your registry is complete is wrong, and Lesson 14.2 says so.
2. **The named members are exactly the ones that selected `attributes`.** `attributes` is
   declared per concrete type and cannot appear on the interface, so the collapsed member
   provably lacks it. That is the property Lesson 14.2 turns into a compile-time completeness
   check — which is why the fragment you write in Task §3 has a rule attached: **every inline
   fragment selects `attributes`.**

### 10. `editorBlocks` is not free, and the cache is what pays for it

`editorBlocks` is an extra resolver pass over `post_content`: parse, walk, build one object per
block, coerce its attributes. On the seeded showcase posts that is nine blocks and
unmeasurable; on a 200-block long-form page it is not. You are not trading it against nothing,
though — the `content` field it replaces was running `the_content` and every filter attached to
it, and `editorBlocks` **without** `renderedHtml` is usually the cheaper of the two because it
skips rendering entirely.

What pays for it is Lesson 10.3's policy table, unchanged:

| Route | `revalidate` | Why the number survives this module |
|---|---|---|
| `/[locale]/blog/[slug]` | 3600 | An editor's save is an editorial action; Module 18's webhook is what makes it instant |
| `/[locale]/hobt` | 60 | `seatsLeft` drives a live badge, and now the body is editor-composed too |
| `/[locale]/[...slug]` | 3600 | Pages change rarely. Lesson 14.4 adds the route on this row |

So the answer to "is `editorBlocks` slow?" is "you fetch it once per revalidate window per
route, and the number is already written down." Do not add a second cache and do not memoize by
hand: Module 18 shortens the windows by making invalidation precise, and that is the whole plan.

---

## Task

### Step 1: Install WPGraphQL Content Blocks from a pinned release

Find the release you are pinning to first, then install exactly that.

```bash
cd wordpress-headless

# 1. List the recent tags. Pick the newest STABLE release and note the tag.
curl -s https://api.github.com/repos/wpengine/wp-graphql-content-blocks/releases \
  | jq -r '.[] | select(.prerelease == false) | "\(.tag_name)  \(.assets[].browser_download_url)"' \
  | head -5

# 2. Pin it. Replace the tag with the one you just chose — do NOT use `main`.
CB_TAG=v4.9.0
CB_ZIP="https://github.com/wpengine/wp-graphql-content-blocks/releases/download/${CB_TAG}/wp-graphql-content-blocks.zip"

docker compose run --rm wpcli wp plugin install "$CB_ZIP" --activate

docker compose run --rm wpcli wp plugin list --status=active --fields=name,version,status --format=csv
```

**Verify §1:**

- [ ] `wp-graphql-content-blocks` appears with `status=active` and a **concrete version number**.
      Write that number down; it goes into `docs/schema-notes.md` in §7.
- [ ] `docker compose logs --tail=40 wordpress` shows no PHP fatal. Content Blocks requires
      WPGraphQL to be active first; if WPGraphQL were missing you would see the fatal here rather
      than a polite notice.
- [ ] The install command printed a URL, not a slug. If you typed
      `wp plugin install wp-graphql-content-blocks` and it worked, you installed something else —
      check the name.

### Step 2: Confirm the new types are in the schema, from GraphiQL and from `curl`

GraphiQL first, because the docs pane is the fastest way to see the shape:
`http://localhost:8080/wp-admin/admin.php?page=graphiql-ide`. Search the Docs sidebar for
`EditorBlock` and for `BttIncidentCallout`.

Then the same facts non-interactively, which is what you can put in a script:

```bash
# The interface's field list — this is what the fragment in §3 selects from.
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name: \"EditorBlock\") { kind fields { name } } }"}' \
  | jq -r '.data.__type.kind, (.data.__type.fields[].name)'

# One of YOUR blocks, and its attributes object
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name: \"BttIncidentCallout\") { name fields { name type { name kind } } } }"}' \
  | jq '.data.__type'

# Which interface actually carries `editorBlocks` on Post. Do not assume.
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name: \"Post\") { interfaces { name } } }"}' \
  | jq -r '.data.__type.interfaces[].name' | grep -i block
```

**Verify §2:**

- [ ] The first command prints `INTERFACE` followed by a field list containing `clientId`,
      `parentClientId`, `name` and `renderedHtml`.
- [ ] The second prints a `BttIncidentCallout` with an `attributes` field. If `__type` is
      `null`, the block is not registered in **PHP** — Key Concept 5, check number one.
- [ ] The third prints `NodeWithEditorBlocks`. **If your version prints a different name, that
      name is the type condition for the fragment in §3** and the only line you change.
- [ ] Repeat the second command for `BttTechVerdictCard`. `null` is a perfectly good answer if
      you skipped Lesson 13.5's stretch block — write down which answer you got, because
      Lesson 14.4 asks.

### Step 3: Write the `EditorBlocks` fragment

One new file. This is the document every route in the module spreads, and the comment at the top
is not decoration — it is the rule that makes Lesson 14.2's completeness check work.

It has **one** inline fragment today, and that is the interesting design decision in the file.

```graphql
# next-app/src/graphql/fragments/editorBlocks.graphql
# The body of any editor-composed content node, as a FLAT list. Spread by
# posts.graphql (14.2), then pages.graphql, incidents.graphql, reviews.graphql and
# hobt.graphql (14.4).
#
# THE INLINE FRAGMENTS BELOW ARE THE UNION. Lesson 14.2 derives the registry's key
# type from this list, so the list and `blockRegistry` move in LOCKSTEP:
#   · adding a `... on X` line here without adding a component to blockRegistry
#     is an `npm run type-check` failure that names X;
#   · deleting a line here while the component still exists is the same failure.
# That is why the list is one entry long today and grows one lesson at a time:
# 14.3 adds the five core blocks, 14.4 the five btt/* blocks, 14.5 CoreImage —
# each one alongside the component that renders it.
#
# EVERY inline fragment MUST select `attributes`. That is how the generated union
# distinguishes a block you support from the ~90 collapsed into one member.
#
# `renderedHtml` is deliberately NOT selected. Lesson 14.1 Key Concepts 6 and 7,
# and the decision record in docs/api-contract.md.
#
# The type condition came from the introspection in Task §2 — do not assume it.
fragment EditorBlocks on NodeWithEditorBlocks {
  # flat: true — the consumer owns the recursion. Key Concept 2.
  editorBlocks(flat: true) {
    # The discriminant. Never `name` for narrowing — `name` is typed String.
    __typename
    # The tree, and the React key.
    clientId
    parentClientId
    # For UnknownBlock's dev-only warning, and nothing else.
    name

    # Lesson 14.2 writes the component for this one, and only this one.
    ... on CoreParagraph {
      attributes {
        content
      }
    }
  }
}
```

The temptation is to paste all twelve inline fragments now and fill in the components later. Do
not: an inline fragment with no registry entry is a **build failure by design**, so pasting
twelve makes the next four lessons start from a red build and trains you to ignore the check
that is this module's headline feature.

**Verify §3:**

- [ ] The file contains exactly **one** `... on` line, and exactly one `attributes {` line. Those
      two counts must always match — Lesson 14.2's completeness check depends on it and cannot
      warn you itself.
- [ ] `grep -c renderedHtml src/graphql/fragments/editorBlocks.graphql` is `0`.
- [ ] The type condition is whatever Task §2's third command printed, not necessarily what is
      written above.

### Step 4: Pull the schema and read the diff

```bash
cd ../next-app

wc -l ../wordpress-headless/schema.graphql
# Note this number. You are about to compare against it.

npm run schema:pull

git diff --stat ../wordpress-headless/schema.graphql
git diff ../wordpress-headless/schema.graphql | grep -E '^\+(type|interface|enum) ' | head -30
git diff ../wordpress-headless/schema.graphql | grep -E '^-(type|interface|enum|  [a-z])' | head -30
```

The second `grep` is the one that matters: **additions are expected, removals are not.** A
plugin that removes or renames a type you already query is the failure mode this review exists
to catch, and it is much cheaper to see here than as forty compile errors in a minute's time.

**Verify §4:**

- [ ] `git diff --stat` shows a few thousand added lines. Under a hundred means the plugin is not
      active, or `schema:pull` wrote somewhere else — check its output.
- [ ] The additions include `interface EditorBlock`, `interface NodeWithEditorBlocks` and
      `type BttIncidentCallout`.
- [ ] The **removals** grep prints nothing, or prints only things you can explain. This is the
      check; the rest is skimming.
- [ ] `ls schema.graphql` inside `next-app/` still fails. The schema lives with WordPress —
      Lesson 10.2, and it is not negotiable.

### Step 5: Regenerate types and read what came out

```bash
npm run codegen
npm run type-check

# The fragment's own generated type — this is what Lesson 14.2 imports.
grep -n 'EditorBlocksFragment' src/gql/graphql.ts | head -3

# The collapsed member from Key Concept 9, in the flesh: a single `__typename`
# whose type is a union of hundreds of characters of string literals.
grep -o "__typename: '[^;]\{200,\}" src/gql/graphql.ts | head -c 400; echo

# And the proof it is a collapse rather than a list of members: CoreArchives is a
# block nobody in this course will ever map, so its name can only occur inside it.
grep -c "'CoreArchives'" src/gql/graphql.ts
```

Those two commands are worth actually running. Seeing eighty-nine type names inside **one**
union member is what makes the two-layer mechanism in Lesson 14.2 make sense, and it is much
more convincing than this lesson telling you about it.

**Verify §5:**

- [ ] `EditorBlocksFragment` is exported from `src/gql/graphql.ts`.
- [ ] `npm run type-check` is silent. Nothing consumes the fragment yet, so it should be.
- [ ] The collapsed member exists and has no `attributes` in it. If it does have `attributes`,
      your plugin version declares the field on the interface — tell Lesson 14.2, because the
      discriminator in `registry.ts` needs a different property.
- [ ] `git status --short` shows both `../wordpress-headless/schema.graphql` and `src/gql/`.

### Step 6: The side-by-side — the same post as `content` and as `editorBlocks`

This is the reveal, and it is worth doing by hand once.

```bash
# A. The blob you have been rendering since Module 09
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ post(id:\"blog-01\", idType:SLUG){ content } }"}' \
  | jq -r '.data.post.content' | head -c 600; echo

# B. The same body as structure
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ post(id:\"blog-01\", idType:SLUG){ editorBlocks(flat:true){ __typename clientId parentClientId name } } }"}' \
  | jq '.data.post.editorBlocks'

# C. And one block's typed attributes
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ post(id:\"blog-01\", idType:SLUG){ editorBlocks(flat:true){ __typename ... on BttIncidentCallout { attributes { severity incidentSlug headline } } } } }"}' \
  | jq '[.data.post.editorBlocks[] | select(.attributes)]'
```

Now derive the count rather than trusting anyone about it. `block_showcase()` in the Lesson 04.5
seeder emits eight top-level blocks, and one of them nests a paragraph:

| # | Serialised block | `parentClientId` |
|---|---|---|
| 1 | `core/heading` — "What happened" | `null` |
| 2 | `core/paragraph` | `null` |
| 3 | `btt/incident-callout` | `null` |
| 4 | `btt/blame-quote` | `null` |
| 5 | `core/paragraph` — "It worked on my machine." | the quote's `clientId` |
| 6 | `btt/scapegoat-picker` | `null` |
| 7 | `btt/incident-ticker` | `null` |
| 8 | `btt/tech-verdict-card` | `null` |
| 9 | `btt/hobt-cta` | `null` |

So: **nine entries in the flat list, eight of them top-level.** If you skipped 13.5's stretch
block, row 8 is still in `post_content` and still comes back — but with the interface
`__typename` rather than `BttTechVerdictCard`, because PHP never registered it.

### Step 7: Write the three notes, then commit

Three files, three different jobs. Never invent a fourth.

`docs/schema-notes.md` — what this plugin did to the schema, so the next upgrade has a baseline:

```markdown
<!-- docs/schema-notes.md — append -->
## WPGraphQL Content Blocks (Lesson 14.1)

Installed from a pinned GitHub release asset — the plugin is **not** in the .org directory, so
`wp plugin install wp-graphql-content-blocks` fails. Version pinned: `vX.Y.Z` (record yours).

| Added | Detail |
|---|---|
| `interface EditorBlock` | `clientId`, `parentClientId`, `name`, `renderedHtml` — no `attributes` |
| `interface NodeWithEditorBlocks` | carries `editorBlocks(flat: Boolean)`; implemented by `Post`, `Page`, `Incident`, `TechReview` |
| ~90 concrete block types | one per **PHP-registered** block, each with its own `attributes` object type |

`schema.graphql` grew from N to M lines (record both). Upgrading this plugin is a schema change:
`npm run schema:pull`, read the diff for **removals**, `npm run codegen`, `npm run type-check`.
Never `wp plugin update --all` on this project.
```

`docs/content-model.md` — the shape the front end consumes:

```markdown
<!-- docs/content-model.md — append -->
## `editorBlocks` (Lesson 14.1)

The body of every editor-composed node is `editorBlocks(flat: true)`: an ordered, flat list
where each entry carries `__typename`, `clientId`, `parentClientId`, `name` and its own typed
`attributes`. `parentClientId` is the tree; the array order is the document order.

- Every attribute is **nullable**, because an attribute at its default is omitted from the
  serialised comment entirely.
- `src/graphql/fragments/editorBlocks.graphql` is the single fragment. Its inline fragments
  **are** the set of blocks this app renders.
- Blocks registered in JavaScript but not in PHP have no concrete type and arrive as the bare
  interface.
```

`docs/api-contract.md` — the decision, with the five costs, because this is the one someone will
argue with:

```markdown
<!-- docs/api-contract.md — append -->
## Decision: `renderedHtml` is never rendered, and never selected (Lesson 14.1)

WPGraphQL Content Blocks returns `attributes` **and** `renderedHtml` per block. This app renders
`attributes` through React components and does not select `renderedHtml` at all.

| Cost of rendering `renderedHtml` | Symptom you can check |
|---|---|
| No `next/link` — raw `<a href>` | an in-content link reloads the tab |
| No `next/image` — raw `<img src>` | no `/_next/image` in the article body |
| WordPress class names Tailwind never compiled | `wp-block-*` in the rendered HTML |
| WordPress's locale, not the route's | an English string on a `/de/` route |
| A `dangerouslySetInnerHTML` surface writable with `edit_posts` | more than one file matches `grep -rl 'dangerouslySetInnerHTML' src/` |

**Exception:** inline rich text (`<strong>`, `<em>`, `<code>`, `<a>` inside a paragraph's own
`content`) is rendered as HTML through `src/components/blocks/RichText.tsx`, sanitized against a
strict allowlist. That is the only `dangerouslySetInnerHTML` in `next-app/`.

**Invariant:** `grep -rn 'renderedHtml' next-app/src/` returns nothing. It stays that way.

**Cost of the decision:** every insertable block needs a component; a block without one renders
nothing in production and a dev-only warning locally. Correct for a designed product with a known
block palette; wrong for a site where editors install arbitrary block plugins.
```

```bash
npm run verify
git add ../wordpress-headless/schema.graphql src/gql/
git commit -m "chore: refresh schema and codegen output for wp-graphql-content-blocks"
git add -A
git commit -m "feat(next): editorBlocks fragment, and the decision record rejecting renderedHtml"
```

---

## Verification

```bash
cd wordpress-headless

# 1. The plugin is active and PINNED to a real version
docker compose run --rm wpcli wp plugin list --name=wp-graphql-content-blocks \
  --fields=name,status,version --format=csv
# Expected: wp-graphql-content-blocks,active,<a concrete version>
#           "inactive" or an empty result means Step 1 did not finish.

# 2. WPGraphQL still answers, with no errors array
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ generalSettings { title } }"}' | jq '.errors'
# Expected: null
#           GraphQL reports failure as HTTP 200 with an `errors` array, so this
#           reads .errors and never the status code.

# 3. The interface exists and is an INTERFACE
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"EditorBlock\"){ kind } }"}' | jq -r '.data.__type.kind'
# Expected: INTERFACE

# 4. One of YOUR blocks is a concrete type with an `attributes` field
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"BttIncidentCallout\"){ fields { name } } }"}' \
  | jq -r '[.data.__type.fields[].name] | index("attributes") != null'
# Expected: true
#           false or a null __type → the block is not registered in PHP.

# 5. The committed schema carries the new types
grep -c 'BttIncidentCallout' schema.graphql
# Expected: 1 or more
grep -c 'interface NodeWithEditorBlocks' schema.graphql
# Expected: 1

# 6. The flat list for blog-01, and the counts DERIVED in Task Step 6
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ post(id:\"blog-01\", idType:SLUG){ editorBlocks(flat:true){ __typename parentClientId } } }"}' \
  | jq '.data.post.editorBlocks | { total: length, topLevel: (map(select(.parentClientId == null)) | length) }'
# Expected: { "total": 9, "topLevel": 8 }
#           9 = the 8 blocks block_showcase() emits + the paragraph nested inside
#           btt/blame-quote. If you skipped 13.5's stretch block the counts are the
#           same; only the verdict card's __typename differs.

# 7. Nesting is real: exactly one entry has a non-null parentClientId, and its
#    parent is the blame quote
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ post(id:\"blog-01\", idType:SLUG){ editorBlocks(flat:true){ __typename clientId parentClientId } } }"}' \
  | jq -r '.data.post.editorBlocks as $b
           | ($b | map(select(.parentClientId != null)) | length | tostring) + " nested; parent is "
           + (($b | map(select(.parentClientId != null))[0].parentClientId) as $p
              | ($b | map(select(.clientId == $p))[0].__typename))'
# Expected: 1 nested; parent is BttBlameQuote

# 8. The HOBT page carries the same showcase, so 14.4 has something to render
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ page(id:\"/hobt/\", idType:URI){ editorBlocks(flat:true){ __typename } } }"}' \
  | jq '.data.page.editorBlocks | length'
# Expected: 9

cd ../next-app

# 9. The committed generated output IS the output of the committed inputs
npm run codegen:check
# Expected: silent, exit 0. A diff here means src/gql/ was not committed.

# 10. type-check and lint are clean before anything consumes the fragment
npm run type-check && npm run lint
# Expected: no output from either

# 11. The fragment's generated type exists
grep -c 'EditorBlocksFragment' src/gql/graphql.ts
# Expected: 1 or more

# 12. NEGATIVE — nothing in the app renders renderedHtml, and this number stays 0
#     for the rest of the course. Module 24 turns it into a CI gate.
grep -rn 'renderedHtml' src/ | wc -l
# Expected: 0

# 13. NEGATIVE — and it is not SELECTED either. A field you do not render is a
#     field you do not ask for: it costs PHP render time and response bytes, and
#     an unrendered-but-available field is the fallback nobody removes.
grep -c 'renderedHtml' src/graphql/fragments/editorBlocks.graphql
# Expected: 0

# 14. NEGATIVE — there is still no schema under next-app/. Lesson 10.2's rule.
ls schema.graphql 2>&1 | grep -c 'No such file'
# Expected: 1

# 15. NEGATIVE — every inline fragment selects `attributes`, so the two counts match.
#     Lesson 14.2's completeness check depends on this and cannot warn you itself.
grep -c '\.\.\. on ' src/graphql/fragments/editorBlocks.graphql
grep -c 'attributes {' src/graphql/fragments/editorBlocks.graphql
# Expected: 1 and 1. The two numbers must stay equal for the rest of the module —
#           they become 6 and 6 in Lesson 14.3, 11 and 11 in 14.4, 12 and 12 in 14.5.

# 16. NEGATIVE — no component consumes blocks yet. src/components/blocks/ does not
#     exist until Lesson 14.2, and the three routes still render the blob.
ls src/components/blocks 2>&1 | grep -c 'No such file'
# Expected: 1
grep -rl 'dangerouslySetInnerHTML' src/app/ | wc -l
# Expected: 3   (incidents/[slug], blog/[slug], reviews/[slug] — 14.2 removes one)

# 17. Both notes landed in files that already existed
grep -c 'renderedHtml' ../docs/api-contract.md
# Expected: 1 or more
grep -c 'Content Blocks' ../docs/schema-notes.md
# Expected: 1 or more
```

If check 6 returns a total of `1`, WordPress is returning the nested shape: you passed
`flat: false`, or your plugin version defaults `flat` differently than the one this lesson was
written against. Pass the argument explicitly, everywhere — the fragment already does.

## Control Questions

1. GraphQL forbids a fragment from spreading itself. Explain, in terms of that single rule, why
   `flat: true` is not a performance optimisation but a **correctness** decision, and describe
   the exact content an editor could create that would break a nested selection unrolled to
   three levels of `innerBlocks`.
2. A colleague adds `renderedHtml` to `editorBlocks.graphql` "for debugging" and does not render
   it. Name the three costs from Key Concept 7 that they have already paid, and say which one
   makes the invariant unenforceable rather than merely violated.
3. `severity` arrives as `string`, not as a union of the four term slugs, even though Lesson
   13.3 gave the editor a `SelectControl` with exactly four options. Explain where the type
   information is lost, and say which of `block.json`, WPGraphQL, codegen or TypeScript you
   would have to change to recover it.
4. A block appears correctly in wp-admin, saves without the "unexpected content" warning, and
   arrives over GraphQL with no `attributes` field. Give the diagnosis, the one WP-CLI command
   that confirms it, and the reason this failure cannot be fixed anywhere in `next-app/`.
5. Codegen collapses the eighty block types you did not name into one union member. State the
   one property of that member that Lesson 14.2 turns into a compile-time completeness check,
   and say what would break that mechanism if a future plugin version moved `attributes` onto
   the `EditorBlock` interface.

## Learn More

- [WPGraphQL Content Blocks](https://github.com/wpengine/wp-graphql-content-blocks) — the
  plugin's own README is the authoritative description of `editorBlocks`, `flat` and how types
  are derived from `block.json`
- [WPGraphQL Content Blocks releases](https://github.com/wpengine/wp-graphql-content-blocks/releases)
  — where the pinned zip in Task §1 comes from; read one release note to see how often type
  names move
- [`parse_blocks()`](https://developer.wordpress.org/reference/functions/parse_blocks/) — the
  core function the plugin is a projection of, and the fastest way to check your intuition about
  what is actually stored in `post_content`
- [Block attributes](https://developer.wordpress.org/block-editor/reference-guides/block-api/block-attributes/)
  — the `type` values `block.json` allows, which is exactly the set that becomes your GraphQL
  scalar types
- [Key concepts of block development](https://developer.wordpress.org/block-editor/getting-started/fundamentals/)
  — the serialisation model in core's own words; worth rereading now that you have seen the
  GraphQL side
- [WPGraphQL — Interfaces](https://www.wpgraphql.com/docs/interfaces/) — how WPGraphQL exposes
  interfaces and why inline fragments are the only way to reach type-specific fields
- [GraphQL spec — fragment spreads must not form cycles](https://spec.graphql.org/October2021/#sec-Fragment-spreads-must-not-form-cycles)
  — the one paragraph that makes Key Concept 2's argument, in the specification's own words
- [graphql-codegen — the `client` preset](https://the-guild.dev/graphql/codegen/plugins/presets/preset-client)
  — read the section on how selection sets become types if you want to understand the collapse in
  Key Concept 9 rather than just accept it
- [Next.js — `fetch` caching and revalidation](https://nextjs.org/docs/app/api-reference/functions/fetch)
  — the mechanism behind the `revalidate` numbers in Key Concept 10, unchanged by this module
