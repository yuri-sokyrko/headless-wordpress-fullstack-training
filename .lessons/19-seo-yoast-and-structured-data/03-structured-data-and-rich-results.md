---
title: 'Structured Data & Rich Results'
module: 19
lesson: 3
teaches: [json-ld, schema-org, rich-results, breadcrumb-list, review-schema, faq-page]
produces: ['next-app/src/lib/seo/jsonLd.ts']
requires: [19.2, 14.2]
---

# Lesson 19.3 — Structured Data & Rich Results

## Quick Overview

Structured data is the one part of SEO that is genuinely a data-modelling exercise, which is
why it belongs in a course about content models. You are not writing marketing copy; you are
publishing a machine-readable claim about what a page *is*. Blame The Tech has four page types
that map cleanly onto schema.org vocabulary: a blog post is an `Article`, a tech review is a
`Review` with a `Rating` (the ratings in `techReviewFields` were designed for this from
Module 04), the HOBT landing page has a genuine `FAQPage`, and every page sits somewhere in a
`BreadcrumbList`. The site itself is an `Organization`. Five types, all built from data you
already fetch for rendering.

This lesson builds typed builders — one function per schema type, each taking the same
codegen'd data the page component takes and returning a plain object — and renders them as a
single `<script type="application/ld+json">`. Two disciplines matter more than the syntax.
First, **never emit a node you cannot fully populate**: a `Review` without a `reviewRating`, or
an `Article` with a placeholder `author`, is worse than no markup, because Google treats
mismatched structured data as a quality signal against you. Second, **avoid schema spam** —
marking a testimonial block up as `Review` to farm stars is a manual-action risk, and the
satirical ratings on `/reviews` are opinions about companies, which is exactly what `Review`
is *for* and exactly why the `itemReviewed` type must be honest.

By the end of this lesson you will have:

- `src/lib/seo/jsonLd.ts` — typed builders for `Article`, `Review`, `BreadcrumbList`,
  `Organization` and `FAQPage`, each with a "return `null` if incomplete" guard
- A single `<JsonLd>` render path, so one page never emits two competing `@graph` blocks
- `Organization` emitted once from the root layout, with `sameAs` from `siteSettings.socialLinks`
- `Review` on `/reviews/[slug]` built from `techReviewFields`, with `itemReviewed` as a
  `SoftwareApplication` or `Organization` — decided, not guessed
- `FAQPage` on `/hobt`, sourced from an editor-composed block rather than a hard-coded array
- A Rich Results test pass for one URL of each type, with the report saved next to the lesson notes

## Classic WP Analogy

In Classic WordPress you almost never wrote JSON-LD by hand. Yoast built a `@graph` for you —
`WebSite`, `WebPage`, `Organization`, `Person`, `BreadcrumbList`, all wired together with
`@id` references — and you extended it, if at all, through the
`wpseo_schema_graph_pieces` filter or by registering a piece class. It was powerful and almost
completely opaque: you got correct output and no understanding of it.

`wp-graphql-yoast-seo` does expose that graph as `seo.schema.raw`, a JSON string, and it is
tempting to fetch it and dump it into a script tag. **Don't**, and this is the decision the
lesson turns on. Yoast's graph is built for the URL WordPress thinks the page lives at, which
is `localhost:8080` or your Fly.io hostname — not your public site. Every `@id`, every `url`,
every breadcrumb item points at the wrong origin. You would have to string-replace hostnames
inside a JSON blob you did not build, on every request, forever. Building the graph yourself
from typed data is more code and enormously less risk.

So this is the place where the analogy stops being a bridge and becomes a warning: **the
Classic answer was "let the plugin do it", and the headless answer is "you own this now".**
That is a real cost — a few hundred lines you did not have before — and the compensation is
that structured data stops being magic. You will be able to answer "why does this page claim
to be an `Article` written by nobody?" by reading one function.

---

## Key Concepts

### 1. Structured data is a claim, which makes it a data-modelling problem

`<meta name="description">` is prose for a human. JSON-LD is a **statement to a machine**: this
page is an `Article`; its `author` is that `Person`; its `publisher` is this `Organization`; it
sits at position 3 in that `BreadcrumbList`. Every one of those is either true of your content
model or it is not, and a crawler treats a false claim as a signal about your site rather than a
typo.

That is why this belongs in a course about content models. You are not decorating a page — you
are serialising the model you designed in Module 04 into a vocabulary somebody else defined, and
the interesting work is the mapping, not the syntax.

```
   your content model                schema.org vocabulary
 ┌──────────────────────────┐      ┌─────────────────────────────┐
 │ post                     │─────▶│ Article                     │
 │   title, date, author    │      │   headline, datePublished,  │
 │                          │      │   author, publisher         │
 ├──────────────────────────┤      ├─────────────────────────────┤
 │ tech_review              │─────▶│ Review + Rating             │
 │   techReviewFields       │      │   itemReviewed, reviewRating│
 │   ratingOverall 1-10     │      │   ratingValue, bestRating   │
 ├──────────────────────────┤      ├─────────────────────────────┤
 │ siteSettings             │─────▶│ Organization                │
 │   socialLinks[]          │      │   sameAs[]                  │
 └──────────────────────────┘      └─────────────────────────────┘
        Module 04 designed              somebody else defined
        these field names               these property names
```

The honest framing of the whole lesson, stated once: **the Classic answer was "let the plugin do
it", and the headless answer is "you own this now."** Yoast built a `@graph` for free and you
understood none of it. This lesson costs a few hundred lines and buys you the ability to answer
"why does this page claim to be an `Article` written by nobody?" by reading one function.

### 2. Five types, and exactly where each one's data comes from

Nothing here is fetched specially. Every field is already on the page because something renders
it — which is the test for whether structured data is honest: **if you had to add a query to
support a claim, ask whether the page really is what you are claiming.**

| Type | Route | Source fields | The field that makes or breaks it |
|---|---|---|---|
| `Organization` | the root layout, once | `generalSettings.title`, `siteSettings.socialLinks` (`network`, `url`) | `sameAs` — an empty array is worse than no key |
| `BreadcrumbList` | every content route | the route's own segments and titles | `position`, which is 1-based and must be contiguous |
| `Article` | `/blog/[slug]` | `title`, `date`, `modifiedGmt`, `author.node.name`, `featuredImage` | `author` — a placeholder here is the canonical bad-markup example |
| `Review` | `/reviews/[slug]` | `techReviewFields.companyName`, `ratingOverall`, `verdict`, `reviewedAt` | `reviewRating`, without which the node is meaningless |
| `FAQPage` | `/hobt` | `editorBlocks` — an editor-composed heading/paragraph pair | whether a real FAQ exists on the page at all |

Two absences are deliberate. **Incidents get no `Article`**: an incident report is authored by a
denormalised `reporterDisplayName` rather than a WordPress user (appendix 03 §4.1), and an
`Article` whose `author` is a free-text string that may say "Anonymous" is precisely the node
Key Concept 3 forbids. They get a `BreadcrumbList` and nothing else, and that is the correct
amount of markup for them. **Scapegoat term pages get no node either** — schema.org has no type
that means "a taxonomy term archive", and `CollectionPage` adds no information a crawler cannot
see from the HTML.

### 3. Never emit a node you cannot fully populate

A `Review` without `reviewRating`. An `Article` whose `author` is `{ "@type": "Person", "name":
"" }`. A `BreadcrumbList` with one item. Each of those is **worse than emitting nothing**,
because incomplete or contradictory structured data is a quality signal against the whole
domain, not just the page.

So every builder in `jsonLd.ts` has the same shape:

```
   builder(input)  ──▶  is every REQUIRED property present and well-formed?
                          │                              │
                         no                             yes
                          ▼                              ▼
                       return null            return the node object
                          │
                    the render path FILTERS nulls out, so a missing
                    node is a missing node — never a null in a @graph
```

The guard belongs in the builder rather than at the call site, and the reason is arithmetic:
five builders and eleven call sites means eleven places to forget. One guard per builder means
five places to get right, and the type system helps — a builder returning `JsonLdNode | null`
forces every caller to deal with the `null`.

| Node | Required before it may be emitted |
|---|---|
| `Organization` | a non-empty `name`; `sameAs` omitted rather than empty |
| `BreadcrumbList` | **two or more** items, each with a name and a path |
| `Article` | non-empty `headline`, a parseable `datePublished`, a non-empty author name |
| `Review` | a non-empty `itemReviewed.name` and a `ratingValue` inside `[worstRating, bestRating]` |
| `FAQPage` | **two or more** complete question/answer pairs |

The two-item minimums are not arbitrary. A one-item breadcrumb is the page itself, which the
crawler already has; a one-question FAQ is a heading, which it also already has. A node that
restates what is visible adds risk and no information.

### 4. Schema spam is a manual-action risk, and `itemReviewed` is where you decide to be honest

The canonical abuse is marking a testimonial up as a `Review` so the page shows stars in search
results. It works, briefly, and it is a documented reason for a manual action — Google's
structured-data guidelines name self-serving reviews explicitly.

Blame The Tech is an interesting case precisely because it *looks* like that abuse and is not.
The ratings on `/reviews` are opinions about **companies and their tools**, published by a site
whose entire purpose is publishing opinions. That is what `Review` is for. What makes it honest
rather than spam is a property most people set by guessing: `itemReviewed`.

| `itemReviewed['@type']` | Fully populated needs | Can this content model supply it? |
|---|---|---|
| `SoftwareApplication` | `name`, `applicationCategory`, and an `operatingSystem` or `offers` | ❌ `techReviewFields` has `companyName` and ratings. There is no product name, no category, no platform. |
| `Product` | `name` plus at least one of `offers`, `review`, `aggregateRating` | ❌ same problem, and nothing here is sold |
| `Organization` | a non-empty `name` | ✅ `companyName` is exactly that |
| `Thing` | `name` | ✅ and says nothing |

**The verdict: `Organization`, always, with `companyName` as its `name`.** The decision procedure
is the one from Key Concept 3 applied to a nested node: pick the most specific type you can
**fully populate**, and no more specific. Claiming `SoftwareApplication` would require inventing
an `applicationCategory`, and an invented category is a false claim in the one property a crawler
can most easily check.

The reversal condition, so this is a decision and not a shrug: add a `subject_type` select
(`company` | `product`) and a `product_name` text field to the `Tech Review Fields` group, and
`reviewJsonLd` branches on it. That is a content-model change, which means it belongs in the
content model contract before it belongs in this file — the correct order, and the reason it is
not in this lesson.

`aggregateRating` is a related trap worth naming: it means "the average of many reviews of this
thing", and a single review must **never** carry one. One review is a `Review` with a
`reviewRating`. Getting those two confused is how a page ends up claiming a 9.4 average from a
sample of one.

### 5. One `@graph` per page, `@id` as the join, and where `Organization` lives

Structured data does not have a merge algorithm. Two `<script type="application/ld+json">`
blocks each containing an `@graph` are two competing descriptions of the same page, and nothing
tells a consumer which to believe. So the invariant is: **at most one `@graph` per document.**

That invariant collides with a genuine architectural fact: a layout and a page are two
independent renders and cannot combine return values. Only the Metadata API merges, and JSON-LD
is not part of the Metadata API. So the shape is:

```
   <body>
     ├─ from src/app/[locale]/layout.tsx
     │    <script type="application/ld+json">
     │      { "@context":…, "@type":"Organization",
     │        "@id":"https://…/#organization", … }        ← ONE node, no @graph
     │    </script>
     │
     └─ from src/app/[locale]/blog/[slug]/page.tsx
          <script type="application/ld+json">
            { "@context":…, "@graph":[
                { "@type":"Article", …,
                  "publisher": { "@id":"https://…/#organization" } },   ← a REFERENCE
                { "@type":"BreadcrumbList", … } ] }
          </script>
```

Two script elements, **one per rendering layer**, and exactly one `@graph`. The `Organization`
is *defined* once and *referenced* by `@id` everywhere else — which is what `@id` is for, and it
means the site's identity, social profiles and name exist in exactly one place in the whole
document.

The alternative was considered: emit nothing from the layout and have every route include the
`Organization` node in its own `@graph`, which would give a literal one script per page.
`SiteChrome` is already fetched by the layout with `{ revalidate: 3600, tags: [siteTag()] }`, so
a route re-fetching it costs zero WordPress requests (Lesson 19.2 Key Concept 6). **It was
rejected anyway**: every route would then have to *remember* to include site identity, and
forgetting is silent. The layout is the only place that legitimately knows who the site is.

The cost, stated plainly: `grep -c 'application/ld+json'` on a content route returns `2`, not
`1`, and anyone who has internalised "one script per page" will file a bug against it. The
defensible invariant is the one to check, and it is `grep -c '"@graph"'` equals `1` plus
`"@type":"Organization"` appearing exactly once.

### 6. The render path: one function, one escape, and why `dangerouslySetInnerHTML` is not a violation

React has no way to write text content into a `<script>` element. `{JSON.stringify(node)}` as a
child renders escaped HTML entities and produces invalid JSON; `dangerouslySetInnerHTML` is the
only mechanism, and it is what every framework's JSON-LD helper uses.

That collides with a standing invariant from Module 14: **`dangerouslySetInnerHTML` appears in
exactly one sanitising component and nowhere else.** Read the invariant's actual reason and the
collision dissolves:

| The Module 14 rule | This case |
|---|---|
| Guards **user-authored HTML** being parsed as HTML into the document | The payload is `JSON.stringify` output of objects **your code built** |
| The risk is an injected `<img onerror>` or `<script>` becoming live DOM | `application/ld+json` has a **raw text** content model. Nothing inside it is parsed as HTML, ever. |
| The remedy is a sanitiser with an allowlist | The remedy is escaping `<` and `>`, which is lossless in JSON |
| One component, so there is one place to audit | One function in `jsonLd.ts`, so there is one place to audit |

So the invariant's *shape* is preserved — one place in the codebase, auditable with one `grep` —
and its subject is different. After this lesson, `grep -rl dangerouslySetInnerHTML src/` returns
exactly **two** files: `components/blocks/RichText.tsx` and `lib/seo/jsonLd.ts`. Two, forever,
and any third is a bug.

The escape itself is the one place a real vulnerability could live. Editorial text reaches
`reviewBody` and `FAQPage` answers, and a review that says *"their docs literally do this:
`</script><script>alert(1)</script>`"* would, unescaped, terminate the JSON-LD element and open
a live script:

```
   JSON.stringify → …"reviewBody":"their docs do </script><script>alert(1)</script>"…
                                                 ▲
                            the HTML parser ends the ld+json element HERE
                            and everything after it is executable JavaScript
```

`<` is valid JSON and parses back to `<`, so replacing every `<` and `>` with its escape is
**lossless** — the consumer sees the original characters and the HTML parser sees none. Doing it
inside `serializeJsonLd()` rather than at each call site is what makes it true everywhere. Task
§7 feeds that exact string through and asserts the output.

The render path returns **props**, not JSX, for one reason: `jsonLd.ts` is a `.ts` file and
therefore cannot contain a `<script>` element, and adding a `.tsx` component would add a second
file to audit. So the routes write `<script {...props} />`, one spread per route, and the spread
is greppable.

### 7. Typing the builders against codegen'd input makes a schema change a compile error

Each builder takes a narrow structural type describing only the fields it reads, and the routes
pass codegen'd fragment data straight in. Rename `ratingOverall` in SCF, run
`npm run schema:pull` and `npm run codegen`, and `reviewJsonLd`'s call site stops compiling.

That is the whole reason not to reach for `schema-dts`. It would give you nominal types for
schema.org's vocabulary — useful — and it would check the **output** side while leaving the
input side untyped, which is where the bugs are. A wrong property name in the output is caught by
the validator in Task §8 in about ten seconds; a wrong *field* name silently produces
`undefined`, the guard fires, and the node vanishes with no error anywhere. Hand-written types on
the input side catch the expensive class.

**The verdict: hand-written types, locally, no new dependency.** The precedent is Lesson 10.1's
`TypedDocumentNode`, and the course's bias throughout. The cost, stated plainly: nothing stops
you writing `"@type": "Artcile"`, and only the validator will tell you.

### 8. `FAQPage` has no block behind it, and pretending otherwise would be the fragile choice

Read Module 13's block set — `btt/incident-callout`, `btt/blame-quote`,
`btt/scapegoat-picker`, `btt/incident-ticker`, `btt/hobt-cta`, and the optional
`btt/tech-verdict-card`. **None of them is a FAQ.** Neither is the `HOBT Promo` field group
(appendix 03 §4.4), which has `modules` and `testimonials` and no questions.

So the honest source is an **editorial convention walked out of `editorBlocks`**: a
`core/heading` whose text ends in a question mark, followed by the `core/paragraph` blocks under
it. State the fragility plainly, because it is real:

- An editor who writes "How long does it take" with no question mark contributes no entry, and
  nothing warns them.
- A rhetorical heading — "Why would you even do this?" — becomes a question in your structured
  data.
- Reordering blocks in Gutenberg changes which paragraph answers which question.
- The `flat: true` list (Lesson 14.1) means "under it" is a **sequence** rule, not a nesting one.

| Source for `FAQPage` | Cost | Verdict |
|---|---|---|
| Walk `core/heading` ending in `?` plus the following `core/paragraph` | fragile: rests on a convention nothing enforces | ✅ **today** — no new block, no content-model change, and it works on content that already exists |
| A `btt/faq` block with a repeatable question/answer pair | correct and self-documenting; costs a Module 13 block, a Module 14 component, a schema pull and a codegen run | ✅ the right answer the moment FAQ markup carries commercial weight |
| An SCF repeater on `HOBT Promo` | cheapest to validate | ❌ the FAQ then cannot live in the page body, where the editor composes everything else |

> **Google no longer shows FAQ rich results for sites like this one.** Since August 2023 the FAQ
> rich result is limited to well-known authoritative government and health sites, so emitting
> `FAQPage` here earns **no stars and no accordion in the SERP**. It is still valid, still
> machine-readable, and still consumed by things that are not Google. Emit it because it is true,
> not because it pays — and if a stakeholder asks for FAQ markup expecting rich results, this
> paragraph is the answer.

### 9. Validating structured data when your site is not public

The Rich Results Test fetches a URL. Yours is `http://localhost:3000`, which Google cannot
reach, and there is no version of this lesson that involves opening a tunnel to your laptop.

Two honest options:

| Tool | Takes | Checks | Use it |
|---|---|---|---|
| [Schema Markup Validator](https://validator.schema.org/) | a **code snippet** or a URL | schema.org validity: unknown types, unknown properties, wrong value shapes | ✅ **now**, by pasting the JSON your own page emitted |
| [Rich Results Test](https://search.google.com/test/rich-results) | a URL, or a code snippet | Google's *eligibility* rules, which are stricter and narrower than schema.org's | ✅ on the Vercel preview URL in Module 24 |

The distinction matters more than it looks. The Schema Markup Validator answers "is this valid
schema.org?" and the Rich Results Test answers "would Google show a rich result?" — and a node
can pass the first and fail the second, which is exactly what `FAQPage` now does for this site.
Run the first today, on real output, and defer the second to a deployed URL. **Do not write a
verification step that needs a public tunnel**, and do not paste customer content into either
tool without thinking about it first.

Extracting the payload to paste is one command, and Task §8 has it: `curl` the page, pull the
script contents out, and `jq` it. Reading your own JSON-LD as JSON — rather than as a blob inside
HTML — is also the fastest way to notice that the escape in Key Concept 6 worked.

### 10. What you now own, and what it bought

Add it up: five builders, one serialiser, one render path, five call sites, and a unit-test file.
Yoast did all of that for free and you are choosing to replace it.

| | Yoast's `@graph` | Yours |
|---|---|---|
| Lines you maintain | 0 | ~250 |
| Correct `@id` and `url` for the public site | ❌ — `home_url()`, Lesson 19.1 §5 | ✅ from `NEXT_PUBLIC_SITE_URL` |
| Nodes you cannot explain | most of them | none |
| A wrong field name is | invisible | a compile error |
| A half-populated node is | emitted | `null`, and filtered out |
| Behaviour after a plugin update | may change silently | unchanged |
| Verdict | ❌ | ✅ |

The compensation for those 250 lines is not correctness in the abstract — it is that structured
data stops being magic. When Search Console reports "Missing field author" in six weeks, the
investigation is one function, one guard and one field name, and it takes minutes rather than an
afternoon of reading a plugin's filter chain.

---

## Task

### Step 1: The scaffolding — one serialiser, one render path

Start with the parts every builder shares: the node type, the site context, the escape, and the
function that turns nodes into `<script>` props.

```ts
// next-app/src/lib/seo/jsonLd.ts
// Typed JSON-LD builders. Five schema.org types, each with a "return null if
// incomplete" guard, plus the ONE place in this codebase that escapes a payload for a
// <script> element. Lesson 19.3.
//
// No 'server-only': pure functions over plain data, unit-tested in plain Node
// (Lesson 12.1), same reasoning as tags.ts and yoastToMetadata.ts.
import { originsFromEnv, stripTags } from '@/lib/seo/yoastToMetadata';

/** A schema.org node. `@type` is the only property every node must have. */
export type JsonLdNode = { readonly '@type': string } & Readonly<Record<string, unknown>>;

/** Passed in so the builders are pure; defaults to Lesson 19.2's one env reader. */
export type JsonLdContext = { readonly siteUrl: string };

function resolveContext(context?: JsonLdContext): JsonLdContext {
  return context ?? { siteUrl: originsFromEnv().siteUrl };
}

function absolute(path: string, siteUrl: string): string {
  return new URL(path, siteUrl).toString();
}

/**
 * The site's identity node id. Defined ONCE, in the root layout (Step 5); every
 * other node points at this string instead of restating the organisation.
 * That is what `@id` is for — Key Concept 5.
 */
export function organizationId(siteUrl: string): string {
  return `${absolute('/', siteUrl)}#organization`;
}

/**
 * WPGraphQL's `*Gmt` fields are GMT with NO offset marker — `2024-09-02T08:00:00`.
 * schema.org wants an ISO 8601 value, so append the `Z` that WordPress omits.
 * An SCF Date Picker value is a plain date and is already valid. Anything
 * unparseable returns null, which trips the caller's guard.
 */
export function isoInstant(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (raw === '') return null;

  // SCF Date Picker: a Date, not a DateTime. schema.org accepts both.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`;
  return Number.isNaN(Date.parse(withZone)) ? null : withZone;
}

/**
 * THE escape, and the only security-relevant line in the file.
 *
 * Editorial text reaches `reviewBody` and FAQ answers. A review that quotes
 * `</script><script>alert(1)</script>` would, unescaped, terminate the ld+json
 * element and open a live script — the HTML parser does not know it is inside JSON.
 *
 * `<` parses back to `<`, so this is LOSSLESS: the consumer reads the original
 * characters and the HTML parser never sees a tag. U+2028/U+2029 are escaped for the
 * consumers that hand the payload to a JavaScript parser.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export type JsonLdScriptProps = {
  readonly type: 'application/ld+json';
  readonly dangerouslySetInnerHTML: { readonly __html: string };
};

/**
 * Turn nodes into props for ONE <script>. Nulls are filtered out here, which is what
 * makes every builder's incompleteness guard usable: a missing node is a missing
 * node, never a `null` inside a @graph.
 *
 * Returns null when nothing survives, so a route renders no script at all rather
 * than an empty graph.
 *
 * Props rather than JSX, because this is a `.ts` file and a second `.tsx` component
 * would be a second place to audit — Key Concept 6.
 */
export function jsonLdScriptProps(
  nodes: ReadonlyArray<JsonLdNode | null>
): JsonLdScriptProps | null {
  const graph = nodes.filter((node): node is JsonLdNode => node !== null);
  const [only] = graph;
  if (only === undefined) return null;

  const payload =
    graph.length === 1
      ? { '@context': 'https://schema.org', ...only }
      : { '@context': 'https://schema.org', '@graph': graph };

  return {
    type: 'application/ld+json',
    dangerouslySetInnerHTML: { __html: serializeJsonLd(payload) },
  };
}
```

**Verify §1:**

- [ ] `grep -c 'dangerouslySetInnerHTML' src/lib/seo/jsonLd.ts` is `1`. One place, one escape.
- [ ] `grep -rl dangerouslySetInnerHTML src/ | wc -l` is `2` — this file and
      `components/blocks/RichText.tsx`. A third is a bug, permanently.
- [ ] `npm run type-check` is silent.

### Step 2: `Organization` and `BreadcrumbList`

Append to the same file. These two are the site-wide pair: one identity, one position.

```ts
// next-app/src/lib/seo/jsonLd.ts (appended)

export type OrganizationInput = {
  readonly name: string | null | undefined;
  readonly description: string | null | undefined;
  /** siteSettings.socialLinks — `network` and `url`, appendix 03 §4.5. */
  readonly socialLinks:
    | ReadonlyArray<{ readonly network?: string | null; readonly url?: string | null } | null>
    | null
    | undefined;
};

export function organizationJsonLd(
  input: OrganizationInput,
  context?: JsonLdContext
): JsonLdNode | null {
  const { siteUrl } = resolveContext(context);
  const name = (input.name ?? '').trim();

  // An Organization with no name is not an organisation. Guard, not a placeholder.
  if (name === '') return null;

  // Only absolute http(s) URLs. An editor who typed "twitter.com/x" without a scheme
  // would otherwise put a relative URL in sameAs, which is a broken claim.
  const sameAs = (input.socialLinks ?? [])
    .map((link) => (link?.url ?? '').trim())
    .filter((url) => /^https?:\/\//.test(url));

  const node: Record<string, unknown> = {
    '@type': 'Organization',
    '@id': organizationId(siteUrl),
    name,
    url: absolute('/', siteUrl),
  };

  const description = stripTags(input.description ?? '');
  if (description !== '') node.description = description;

  // OMIT rather than emit an empty array: "this organisation has no social presence"
  // is a claim, and an absent key is not.
  if (sameAs.length > 0) node.sameAs = sameAs;

  return node as JsonLdNode;
}

export type BreadcrumbItem = { readonly name: string; readonly path: string };

export function breadcrumbJsonLd(
  trail: ReadonlyArray<BreadcrumbItem>,
  context?: JsonLdContext
): JsonLdNode | null {
  const { siteUrl } = resolveContext(context);

  const items = trail.filter((item) => item.name.trim() !== '' && item.path.trim() !== '');

  // A one-item breadcrumb is the page itself, which the crawler already has.
  // Two is the minimum that carries information — Key Concept 3.
  if (items.length < 2) return null;

  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      // 1-based and CONTIGUOUS. A gap invalidates the whole list.
      position: index + 1,
      name: item.name.trim(),
      item: absolute(item.path, siteUrl),
    })),
  };
}
```

**Verify §2:**

- [ ] `organizationJsonLd({ name: '', description: null, socialLinks: null })` returns `null`.
      Step 7 asserts it; try it in `node --input-type=module` if you want to see it now.
- [ ] `breadcrumbJsonLd([{ name: 'Home', path: '/en' }])` returns `null` — one item is not a
      trail.
- [ ] Every `item` in a breadcrumb is **absolute**. A relative `item` is the most common
      breadcrumb error in Search Console.

### Step 3: `Article` and `Review`, and the two fields they need

`Article` needs an author and both dates, and `PostBySlug` selects neither today. Two one-line
document edits first — **edits**, so not `produces:` entries.

```graphql
# next-app/src/graphql/posts.graphql (fragment) — three lines added to PostBySlug.
# `date` on PostCardFields is in the site timezone; JSON-LD wants an instant, so take
# the Gmt pair. `author` costs four levels of the depth budget (Lesson 10.5 §4) and it
# is spent deliberately: an Article whose author is a placeholder must return null,
# which makes this field load-bearing rather than decorative.
    ...PostCardFields
    ...SeoFields
    content
    dateGmt
    modifiedGmt
    author {
      node {
        name
      }
    }
```

```graphql
# next-app/src/graphql/reviews.graphql (fragment) — ONE line added to the
# techReviewFields selection inside ReviewBySlug, which already selects ratingDx,
# ratingDocs, ratingIncidentResponse, reviewedAt, pros and cons. `companyName`,
# `ratingOverall` and `verdict` come from TechReviewCardFields and are already here.
      reviewedAt
      companyName
```

Then the two builders:

```ts
// next-app/src/lib/seo/jsonLd.ts (appended)

/** Google's documented ceiling for `headline`. Longer is truncated or ignored. */
const HEADLINE_MAX = 110;

export type ArticleInput = {
  readonly headline: string | null | undefined;
  readonly description: string | null | undefined;
  readonly path: string;
  readonly datePublishedGmt: string | null | undefined;
  readonly dateModifiedGmt: string | null | undefined;
  readonly authorName: string | null | undefined;
  readonly imageUrl: string | null | undefined;
};

export function articleJsonLd(input: ArticleInput, context?: JsonLdContext): JsonLdNode | null {
  const { siteUrl } = resolveContext(context);

  const headline = stripTags(input.headline ?? '').slice(0, HEADLINE_MAX);
  const author = (input.authorName ?? '').trim();
  const datePublished = isoInstant(input.datePublishedGmt);

  // THE guard. An Article with a placeholder author, or with no publication date, is
  // worse than no markup — Key Concept 3. This is also why incidents get no Article:
  // their author is a denormalised free-text field that may say "Anonymous".
  if (headline === '' || author === '' || datePublished === null) return null;

  const node: Record<string, unknown> = {
    '@type': 'Article',
    '@id': `${absolute(input.path, siteUrl)}#article`,
    headline,
    datePublished,
    dateModified: isoInstant(input.dateModifiedGmt) ?? datePublished,
    author: { '@type': 'Person', name: author },
    // A REFERENCE, not a copy. The Organization is defined once, in the layout.
    publisher: { '@id': organizationId(siteUrl) },
    mainEntityOfPage: { '@id': absolute(input.path, siteUrl) },
  };

  const description = stripTags(input.description ?? '');
  if (description !== '') node.description = description;
  if ((input.imageUrl ?? '').trim() !== '') node.image = [input.imageUrl];

  return node as JsonLdNode;
}

export type ReviewInput = {
  /** techReviewFields.companyName. The thing being reviewed. */
  readonly itemName: string | null | undefined;
  readonly ratingValue: number | null | undefined;
  readonly reviewBody: string | null | undefined;
  readonly path: string;
  readonly datePublished: string | null | undefined;
};

const RATING_WORST = 1;
const RATING_BEST = 10;

export function reviewJsonLd(input: ReviewInput, context?: JsonLdContext): JsonLdNode | null {
  const { siteUrl } = resolveContext(context);

  const itemName = (input.itemName ?? '').trim();
  const rating = input.ratingValue;

  // A Review without a reviewRating is meaningless, and a rating outside the scale
  // is a bug in the content, not something to clamp silently.
  if (
    itemName === '' ||
    typeof rating !== 'number' ||
    !Number.isFinite(rating) ||
    rating < RATING_WORST ||
    rating > RATING_BEST
  ) {
    return null;
  }

  const node: Record<string, unknown> = {
    '@type': 'Review',
    '@id': `${absolute(input.path, siteUrl)}#review`,
    // Organization, ALWAYS — Key Concept 4. `companyName` is the only identifying
    // field the content model has, and SoftwareApplication would need an
    // applicationCategory we would have to invent.
    itemReviewed: { '@type': 'Organization', name: itemName },
    reviewRating: {
      '@type': 'Rating',
      ratingValue: rating,
      bestRating: RATING_BEST,
      worstRating: RATING_WORST,
    },
    // The SITE publishes the review, so the author is the organisation, by reference.
    author: { '@id': organizationId(siteUrl) },
  };

  const body = stripTags(input.reviewBody ?? '');
  if (body !== '') node.reviewBody = body;

  const datePublished = isoInstant(input.datePublished);
  if (datePublished !== null) node.datePublished = datePublished;

  // NEVER an aggregateRating on a single review — Key Concept 4. One review is a
  // Review with a reviewRating; an average of one is a claim about a sample size.
  return node as JsonLdNode;
}
```

**Verify §3:**

- [ ] `npm run codegen` after the two document edits, then `npm run type-check`. The generated
      `PostBySlugQuery` now carries `dateGmt`, `modifiedGmt` and `author`.
- [ ] `grep -c 'aggregateRating' src/lib/seo/jsonLd.ts` is `1` — the comment saying never, and
      no code.
- [ ] `articleJsonLd` with `authorName: ''` returns `null`. Step 7 asserts it.

### Step 4: `FAQPage`, walked out of `editorBlocks`

No block carries a FAQ (Key Concept 8), so the source is an editorial convention: a heading that
ends in a question mark, answered by the paragraphs that follow it.

```ts
// next-app/src/lib/seo/jsonLd.ts (appended)

export type FaqEntry = { readonly question: string; readonly answer: string };

/**
 * `unknown` rather than the generated block union, deliberately. The union's members
 * DISAGREE about the shape of `attributes` — CoreImage's is nothing like
 * CoreHeading's — so a structural parameter type would reject half of them at the
 * call site. Narrowing at run time is the honest cost of walking a heterogeneous
 * list, and it is contained in this one function.
 */
function readBlock(value: unknown): { typename: string; content: string } | null {
  if (typeof value !== 'object' || value === null) return null;

  const block = value as { __typename?: unknown; attributes?: unknown };
  const attributes =
    typeof block.attributes === 'object' && block.attributes !== null
      ? (block.attributes as { content?: unknown })
      : {};

  return {
    typename: typeof block.__typename === 'string' ? block.__typename : '',
    content: typeof attributes.content === 'string' ? attributes.content : '',
  };
}

/**
 * A `core/heading` whose text ends in `?`, followed by the `core/paragraph` blocks
 * under it. `flat: true` (Lesson 14.1) means "under it" is a SEQUENCE rule, not a
 * nesting one — which is exactly the fragility Key Concept 8 names. Any other block
 * type ends the answer, so a CTA band between a question and a paragraph correctly
 * stops that paragraph from being treated as the answer.
 */
export function faqEntriesFromBlocks(
  blocks: ReadonlyArray<unknown> | null | undefined
): ReadonlyArray<FaqEntry> {
  const entries: FaqEntry[] = [];
  let question: string | null = null;
  let answer: string[] = [];

  const flush = (): void => {
    const pending = question;
    if (pending !== null && answer.length > 0) {
      entries.push({ question: pending, answer: answer.join(' ') });
    }
    question = null;
    answer = [];
  };

  for (const raw of blocks ?? []) {
    const block = readBlock(raw);
    if (block === null) continue;

    if (block.typename === 'CoreHeading') {
      flush();
      const text = stripTags(block.content);
      question = text.endsWith('?') ? text : null;
      continue;
    }

    if (question !== null && block.typename === 'CoreParagraph') {
      const text = stripTags(block.content);
      if (text !== '') answer.push(text);
      continue;
    }

    if (question !== null) flush();
  }

  flush();
  return entries;
}

export function faqJsonLd(entries: ReadonlyArray<FaqEntry>): JsonLdNode | null {
  const complete = entries.filter(
    (entry) => entry.question.trim() !== '' && entry.answer.trim() !== ''
  );

  // One question is a heading, which the crawler already has. Two is the minimum.
  if (complete.length < 2) return null;

  return {
    '@type': 'FAQPage',
    mainEntity: complete.map((entry) => ({
      '@type': 'Question',
      name: entry.question.trim(),
      acceptedAnswer: { '@type': 'Answer', text: entry.answer.trim() },
    })),
  };
}
```

**Verify §4:**

- [ ] Open `/hobt` in Gutenberg and confirm at least two headings end in `?`, each followed by a
      paragraph. If the seeded page has none, add two — the builder returning `null` on real
      content is a correct outcome, but you cannot validate a node that does not exist.
- [ ] `faqEntriesFromBlocks(null)` returns `[]` and `faqJsonLd([])` returns `null`.
- [ ] `grep -c 'FAQPage' src/lib/seo/jsonLd.ts` is `1`.

### Step 5: Mount `Organization` once, in the root layout

An **edit** to the file Lesson 09.1 created and Lesson 10.5 gave the chrome fetch to. The data is
already there; this adds one `const` and one line of JSX.

```tsx
// next-app/src/app/[locale]/layout.tsx (fragment) — the import, added
import { jsonLdScriptProps, organizationJsonLd } from '@/lib/seo/jsonLd';
```

```tsx
// next-app/src/app/[locale]/layout.tsx (fragment) — added AFTER the existing
// `chrome` fetch from Lesson 10.5. No new query: SiteChrome already selects
// generalSettings and siteSettings.socialLinks.
  const organization = jsonLdScriptProps([
    organizationJsonLd({
      name: chrome.generalSettings?.title,
      description: chrome.generalSettings?.description,
      socialLinks: chrome.siteSettings?.socialLinks,
    }),
  ]);
```

```tsx
// next-app/src/app/[locale]/layout.tsx (fragment) — the LAST child of <body>.
// One node, no @graph: this is the site's identity, and every route's graph points
// at its @id rather than restating it. Key Concept 5.
      {organization !== null && <script {...organization} />}
```

**Verify §5:**

- [ ] The script is inside `<body>`, not `<head>`. Both are valid for `ld+json`; `<body>` is
      where a Server Component can put it without fighting the Metadata API.
- [ ] `curl -s http://localhost:3000/en | grep -c 'application/ld+json'` is `1` on the home
      page — the layout's node and nothing else.
- [ ] `curl -s http://localhost:3000/en | grep -c '"@graph"'` is `0` there. A single node needs
      no graph.

### Step 6: Wire each type to its route

Six routes. `/blog/[slug]` is shown in full; the table maps the rest.

```tsx
// next-app/src/app/[locale]/blog/[slug]/page.tsx (fragment) — the import and one
// const inside the component, after the existing fetch. `post` is the fetched node.
import { articleJsonLd, breadcrumbJsonLd, jsonLdScriptProps } from '@/lib/seo/jsonLd';
import { stripTags } from '@/lib/seo/yoastToMetadata';

// …inside the component, after `if (data.post == null) notFound();`
  const jsonLd = jsonLdScriptProps([
    articleJsonLd({
      headline: post.title,
      description: stripTags(post.excerpt ?? ''),
      path: `/${locale}/blog/${slug}`,
      datePublishedGmt: post.dateGmt,
      dateModifiedGmt: post.modifiedGmt,
      // If this is empty the Article node disappears, on purpose. A post with no
      // WordPress author is a content bug and structured data should not paper
      // over it — Key Concept 3.
      authorName: post.author?.node?.name,
      imageUrl: post.featuredImage?.node?.sourceUrl,
    }),
    breadcrumbJsonLd([
      { name: 'Home', path: `/${locale}` },
      { name: 'The blog', path: `/${locale}/blog` },
      { name: post.title ?? 'Post', path: `/${locale}/blog/${slug}` },
    ]),
  ]);
```

```tsx
// next-app/src/app/[locale]/blog/[slug]/page.tsx (fragment) — ONE line of JSX, as
// the first child of the returned fragment. One spread per route, greppable.
      {jsonLd !== null && <script {...jsonLd} />}
```

| Route | Nodes in its graph | Notes |
|---|---|---|
| `/blog/[slug]` | `Article` + `BreadcrumbList` | shown above |
| `/reviews/[slug]` | `Review` + `BreadcrumbList` | `itemName: techReviewFields.companyName`, `ratingValue: ratingOverall`, `datePublished: reviewedAt` |
| `/hobt` | `FAQPage` + `BreadcrumbList` | `faqJsonLd(faqEntriesFromBlocks(page.editorBlocks))` |
| `/incidents/[slug]` | `BreadcrumbList` **only** | no `Article`: the author is `reporterDisplayName`, a free-text field — Key Concept 2 |
| `/[...slug]` | `BreadcrumbList` only | the trail is the URI's own segments |
| `/scapegoats/[slug]` | nothing | schema.org has no type meaning "taxonomy term archive" that adds information |

```tsx
// next-app/src/app/[locale]/reviews/[slug]/page.tsx (fragment) — the same shape.
  const jsonLd = jsonLdScriptProps([
    reviewJsonLd({
      itemName: review.techReviewFields?.companyName,
      ratingValue: review.techReviewFields?.ratingOverall,
      reviewBody: review.techReviewFields?.verdict,
      path: `/${locale}/reviews/${slug}`,
      datePublished: review.techReviewFields?.reviewedAt,
    }),
    breadcrumbJsonLd([
      { name: 'Home', path: `/${locale}` },
      { name: 'Tech reviews', path: `/${locale}/reviews` },
      { name: review.title ?? 'Review', path: `/${locale}/reviews/${slug}` },
    ]),
  ]);
```

```tsx
// next-app/src/app/[locale]/hobt/page.tsx (fragment) — the same shape. The FAQ comes
// out of the block tree the editor composed, not from a hard-coded array.
  const jsonLd = jsonLdScriptProps([
    faqJsonLd(faqEntriesFromBlocks(data.page?.editorBlocks?.nodes)),
    breadcrumbJsonLd([
      { name: 'Home', path: `/${locale}` },
      { name: data.page?.title ?? 'HOBT', path: `/${locale}/hobt` },
    ]),
  ]);
```

**Verify §6:**

- [ ] `grep -rc 'jsonLdScriptProps' src/app | grep -v ':0'` lists **six** files: the layout and
      five routes.
- [ ] `grep -rc '<script {...' src/app | grep -v ':0'` lists the same six. One spread per
      layer, and no route renders two.
- [ ] `npm run type-check` is silent. If `editorBlocks?.nodes` does not compile on `/hobt`,
      check whether your `EditorBlocks` fragment returns a connection or a list — Lesson 14.1
      settled that shape and this line follows it.

### Step 7: Unit-test the guards and the escape

The `null` guards are exactly what a unit test is for: five pure functions, and the interesting
cases are all the negative ones.

```ts
// next-app/src/lib/seo/jsonLd.test.ts
import { describe, expect, it } from 'vitest';

import {
  articleJsonLd,
  breadcrumbJsonLd,
  faqEntriesFromBlocks,
  faqJsonLd,
  isoInstant,
  jsonLdScriptProps,
  organizationJsonLd,
  reviewJsonLd,
  serializeJsonLd,
  type JsonLdContext,
} from '@/lib/seo/jsonLd';

const CTX: JsonLdContext = { siteUrl: 'https://blamethe.tech' };

describe('incompleteness guards', () => {
  it('drops an Organization with no name', () => {
    expect(organizationJsonLd({ name: '  ', description: null, socialLinks: null }, CTX)).toBeNull();
  });

  it('omits sameAs rather than emitting an empty array', () => {
    const node = organizationJsonLd({ name: 'Blame The Tech', description: null, socialLinks: [] }, CTX);
    expect(node).not.toBeNull();
    expect(node && 'sameAs' in node).toBe(false);
  });

  it('rejects a social link with no scheme', () => {
    const node = organizationJsonLd(
      { name: 'x', description: null, socialLinks: [{ network: 'github', url: 'github.com/x' }] },
      CTX
    );
    expect(node && 'sameAs' in node).toBe(false);
  });

  it('drops a one-item breadcrumb', () => {
    expect(breadcrumbJsonLd([{ name: 'Home', path: '/en' }], CTX)).toBeNull();
  });

  it('numbers breadcrumb positions from 1, contiguously, with absolute items', () => {
    const node = breadcrumbJsonLd(
      [
        { name: 'Home', path: '/en' },
        { name: 'The blog', path: '/en/blog' },
      ],
      CTX
    );
    expect(node?.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://blamethe.tech/en' },
      { '@type': 'ListItem', position: 2, name: 'The blog', item: 'https://blamethe.tech/en/blog' },
    ]);
  });

  it('drops an Article with a placeholder author', () => {
    expect(
      articleJsonLd(
        {
          headline: 'A real headline',
          description: null,
          path: '/en/blog/blog-01',
          datePublishedGmt: '2024-09-02T08:00:00',
          dateModifiedGmt: null,
          authorName: '',
          imageUrl: null,
        },
        CTX
      )
    ).toBeNull();
  });

  it('references the publisher by @id instead of restating it', () => {
    const node = articleJsonLd(
      {
        headline: 'A real headline',
        description: null,
        path: '/en/blog/blog-01',
        datePublishedGmt: '2024-09-02T08:00:00',
        dateModifiedGmt: null,
        authorName: 'The Reporter',
        imageUrl: null,
      },
      CTX
    );
    expect(node?.publisher).toEqual({ '@id': 'https://blamethe.tech/#organization' });
    // WordPress omits the zone marker; schema.org needs one.
    expect(node?.datePublished).toBe('2024-09-02T08:00:00Z');
    // dateModified falls back to datePublished rather than going missing.
    expect(node?.dateModified).toBe('2024-09-02T08:00:00Z');
  });

  it('drops a Review with no rating, and one outside the scale', () => {
    const base = { itemName: 'Acme', reviewBody: null, path: '/en/reviews/review-01', datePublished: null };
    expect(reviewJsonLd({ ...base, ratingValue: null }, CTX)).toBeNull();
    expect(reviewJsonLd({ ...base, ratingValue: 0 }, CTX)).toBeNull();
    expect(reviewJsonLd({ ...base, ratingValue: 11 }, CTX)).toBeNull();
    expect(reviewJsonLd({ ...base, ratingValue: Number.NaN }, CTX)).toBeNull();
  });

  it('reviews an Organization, never a SoftwareApplication', () => {
    const node = reviewJsonLd(
      { itemName: 'Acme', ratingValue: 7, reviewBody: null, path: '/en/reviews/review-01', datePublished: '2024-09-02' },
      CTX
    );
    expect(node?.itemReviewed).toEqual({ '@type': 'Organization', name: 'Acme' });
    expect(node?.reviewRating).toEqual({ '@type': 'Rating', ratingValue: 7, bestRating: 10, worstRating: 1 });
    // An SCF Date Picker value is already a valid schema.org Date.
    expect(node?.datePublished).toBe('2024-09-02');
    // A single review must never carry an average.
    expect('aggregateRating' in (node ?? {})).toBe(false);
  });

  it('drops a FAQPage with fewer than two complete pairs', () => {
    expect(faqJsonLd([])).toBeNull();
    expect(faqJsonLd([{ question: 'Why?', answer: 'Because.' }])).toBeNull();
    expect(faqJsonLd([{ question: 'Why?', answer: '' }, { question: 'How?', answer: 'Slowly.' }])).toBeNull();
  });
});

describe('faqEntriesFromBlocks', () => {
  const heading = (content: string) => ({ __typename: 'CoreHeading', attributes: { content } });
  const paragraph = (content: string) => ({ __typename: 'CoreParagraph', attributes: { content } });

  it('pairs a question heading with the paragraphs under it', () => {
    expect(
      faqEntriesFromBlocks([
        heading('Not a question'),
        paragraph('ignored'),
        heading('Who gets blamed?'),
        paragraph('The <em>intern</em>.'),
        paragraph('Always.'),
        heading('How long does it take?'),
        paragraph('Ninety minutes.'),
      ])
    ).toEqual([
      { question: 'Who gets blamed?', answer: 'The intern . Always.' },
      { question: 'How long does it take?', answer: 'Ninety minutes.' },
    ]);
  });

  it('lets a non-paragraph block end the answer', () => {
    expect(
      faqEntriesFromBlocks([
        heading('Who gets blamed?'),
        { __typename: 'BttHobtCta', attributes: { url: '/x' } },
        paragraph('not the answer'),
      ])
    ).toEqual([]);
  });

  it('survives nulls and unexpected shapes', () => {
    expect(faqEntriesFromBlocks(null)).toEqual([]);
    expect(faqEntriesFromBlocks([null, 42, 'nope'])).toEqual([]);
  });
});

describe('serialization', () => {
  it('escapes a </script> in editorial text', () => {
    const html = serializeJsonLd({ reviewBody: 'their docs do </script><script>alert(1)</script>' });
    expect(html).not.toContain('</script>');
    expect(html).not.toContain('<');
    // Lossless: escaping is reversible, so the consumer reads the original text.
    expect(JSON.parse(html).reviewBody).toBe('their docs do </script><script>alert(1)</script>');
  });

  it('escapes the line separators too', () => {
    expect(serializeJsonLd({ a: '\u2028' })).toContain('\\u2028');
  });
});

describe('jsonLdScriptProps', () => {
  it('returns null when every node was dropped', () => {
    expect(jsonLdScriptProps([null, null])).toBeNull();
  });

  it('emits a bare node for one, and a @graph for two', () => {
    const one = jsonLdScriptProps([{ '@type': 'Organization' }]);
    expect(one?.dangerouslySetInnerHTML.__html).not.toContain('@graph');
    const two = jsonLdScriptProps([{ '@type': 'Organization' }, { '@type': 'BreadcrumbList' }]);
    expect(two?.dangerouslySetInnerHTML.__html).toContain('@graph');
    expect(two?.type).toBe('application/ld+json');
  });
});

describe('isoInstant', () => {
  it('handles the three shapes WordPress and SCF actually send', () => {
    expect(isoInstant('2024-09-02T08:00:00')).toBe('2024-09-02T08:00:00Z');
    expect(isoInstant('2024-09-02')).toBe('2024-09-02');
    expect(isoInstant('not a date')).toBeNull();
    expect(isoInstant(null)).toBeNull();
  });
});
```

```bash
npm run test:run
# Expected: every test passes. `npm test` is WATCH mode and never returns.
```

**Verify §7:**

- [ ] All tests pass, including the `</script>` one. That single assertion is the whole reason
      `dangerouslySetInnerHTML` in this file is defensible.
- [ ] Break a guard on purpose — make `articleJsonLd` accept an empty author — and watch the
      test fail by name. Put it back.
- [ ] `npm run test:coverage` shows `src/lib/seo/jsonLd.ts` well covered. No thresholds
      (Lesson 12.1); the number is information, not a gate.

### Step 8: Validate the real output, then commit

You cannot run the Rich Results Test against `localhost` and you are not opening a tunnel.
Extract your own JSON-LD and paste it into the Schema Markup Validator, which accepts a snippet
(Key Concept 9).

```bash
npm run build && npm run start & SERVER_PID=$!
sleep 6

# One file per type, so each can be pasted separately and the report saved.
mkdir -p /tmp/btt-jsonld
for route in /en /en/blog/blog-01 /en/reviews/review-01 /en/hobt /en/incidents/incident-01; do
  name=$(echo "$route" | tr '/' '_')
  curl -s "http://localhost:3000$route" \
    | perl -0777 -ne 'while (/<script type="application\/ld\+json">(.*?)<\/script>/gs) { print "$1\n" }' \
    > "/tmp/btt-jsonld$name.json"
  printf '%s  %s bytes  ' "$route" "$(wc -c < "/tmp/btt-jsonld$name.json")"
  jq -r '["@type: " + (.["@type"] // ((.["@graph"] // []) | map(.["@type"]) | join(", ")))] | .[]' \
    "/tmp/btt-jsonld$name.json" 2>/dev/null | head -1 || echo '(two scripts — see below)'
done
kill "$SERVER_PID"
```

A content route emits **two** scripts (the layout's `Organization` and the route's `@graph`), so
`jq` on the concatenation will complain. Split them by hand for the validator, or read them with
`jq -s` and paste one at a time.

Then, for one URL of each type — `Article`, `Review`, `FAQPage`, `BreadcrumbList`,
`Organization` — paste the payload into
[validator.schema.org](https://validator.schema.org/) and record the result:

```bash
cat >> ../docs/schema-notes.md <<'NOTES'

## JSON-LD validation (Lesson 19.3)

Validated with validator.schema.org, pasting the payload emitted by the running app.
The Rich Results Test needs a PUBLIC URL and is deferred to the Vercel preview in Lesson 24.7.

| Type | Route validated | Errors | Warnings | Note |
|---|---|---|---|---|
| Organization | /en | 0 | | |
| Article | /en/blog/blog-01 | 0 | | |
| Review | /en/reviews/review-01 | 0 | | itemReviewed is Organization by decision — Lesson 19.3 §4 |
| BreadcrumbList | /en/incidents/incident-01 | 0 | | |
| FAQPage | /en/hobt | 0 | | Valid schema.org; Google shows no FAQ rich result for a site like this |
NOTES

npm run type-check && npm run lint && npm run test:run
git add -A
git commit -m "feat(next): typed json-ld builders for five schema types"
```

**Verify §8:**

- [ ] Every type reports **zero errors** in the validator. Fill in the warnings column honestly
      — a missing recommended property is worth recording, not hiding.
- [ ] The `FAQPage` row says what Key Concept 8's blockquote says. A stakeholder will ask.
- [ ] `grep -c 'JSON-LD validation' ../docs/schema-notes.md` is `1`.

---

## Verification

```bash
cd next-app

# 1. Every builder guards its own completeness, and the tests prove it
npm run test:run
# Expected: all pass, including the </script> escape test and every "drops a …" case

# 2. Types and lint clean
npm run type-check && npm run lint
# Expected: no output

# 3. NEGATIVE — dangerouslySetInnerHTML lives in exactly TWO files, forever
grep -rl dangerouslySetInnerHTML src/
# Expected, exactly two lines:
#   src/components/blocks/RichText.tsx     (Module 14, sanitises user HTML)
#   src/lib/seo/jsonLd.ts                  (this lesson, escapes for a raw-text element)
grep -rl dangerouslySetInnerHTML src/ | wc -l
# Expected: 2. A third is a bug, and this is the check that finds it.

# 4. One spread per layer, six layers, and no route rendering two
grep -rc 'jsonLdScriptProps' src/app | grep -v ':0$'
# Expected: six files — src/app/[locale]/layout.tsx plus blog/[slug], reviews/[slug],
#           hobt, incidents/[slug] and [...slug]

# 5. Build and serve, so the assertions below read shipped HTML rather than a tree
rm -rf .next
npm run build
npm run start > /tmp/btt-jsonld-start.log 2>&1 & SERVER_PID=$!
sleep 6

# 6. The home page carries the site identity, once, with no graph wrapper
curl -s http://localhost:3000/en | grep -c 'application/ld+json'
# Expected: 1 — the layout's Organization
curl -s http://localhost:3000/en | grep -c '"@graph"'
# Expected: 0 — a single node needs no graph
curl -s http://localhost:3000/en | grep -o '"@type":"Organization"' | wc -l
# Expected: 1

# 7. A content route: two scripts, ONE graph, and the organisation still defined once
curl -s http://localhost:3000/en/blog/blog-01 | grep -c 'application/ld+json'
# Expected: 2 — one per rendering layer (the layout, and the route). Key Concept 5
#           explains why this is 2 and not 1, and why 2 is the defensible number.
curl -s http://localhost:3000/en/blog/blog-01 | grep -c '"@graph"'
# Expected: 1 — the route's graph. THIS is the invariant that matters: a page must
#           never carry two competing graphs.
curl -s http://localhost:3000/en/blog/blog-01 | grep -o '"@type":"Organization"' | wc -l
# Expected: 1 — defined in the layout, REFERENCED by @id from the Article's publisher

# 8. Each type is on its own route, and nowhere else
for pair in '/en/blog/blog-01:Article' '/en/reviews/review-01:Review' \
            '/en/hobt:FAQPage' '/en/incidents/incident-01:BreadcrumbList'; do
  route=${pair%%:*}; type=${pair##*:}
  printf '%s  %s=%s\n' "$route" "$type" \
    "$(curl -s "http://localhost:3000$route" | grep -c "\"@type\":\"$type\"")"
done
# Expected: 1 for each pair. Article only on the post, Review only on the review,
#           FAQPage only on /hobt.

# 9. NEGATIVE — an incident emits a BreadcrumbList and NO Article. Its author is a
#    denormalised free-text field, so an Article node would be a claim you cannot
#    support (Key Concept 2).
curl -s http://localhost:3000/en/incidents/incident-01 | grep -c '"@type":"Article"'
# Expected: 0
curl -s http://localhost:3000/en/incidents/incident-01 | grep -c '"@type":"BreadcrumbList"'
# Expected: 1

# 10. NEGATIVE — `seo.schema.raw` is STILL selected nowhere. Two plugins and 250 lines
#     later, Yoast's own graph has not crept back in.
grep -rn 'schema *{' src/graphql/ ; echo "exit=$?"
# Expected: no matches, exit=1
curl -s http://localhost:3000/en/blog/blog-01 | grep -c 'localhost:8080'
# Expected: 0 — no @id, url or image points at the WordPress origin

# 11. NEGATIVE — a review with the rating removed emits NO Review node rather than a
#     broken one. Blank the field, revalidate through a rebuild, observe, restore.
REVIEW_ID=$(docker compose -f ../wordpress-headless/docker-compose.yml run --rm -T wpcli \
  wp post list --post_type=tech_review --name=review-01 --field=ID | tr -d '\r')
docker compose -f ../wordpress-headless/docker-compose.yml run --rm -T wpcli \
  wp post meta update "$REVIEW_ID" rating_overall ''
kill "$SERVER_PID"
rm -rf .next && npm run build > /dev/null 2>&1
npm run start > /dev/null 2>&1 & SERVER_PID=$!
sleep 6
curl -s http://localhost:3000/en/reviews/review-01 | grep -c '"@type":"Review"'
# Expected: 0 — the guard fired and the node vanished
curl -s http://localhost:3000/en/reviews/review-01 | grep -c '"@type":"BreadcrumbList"'
# Expected: 1 — the OTHER node in the graph is unaffected, which is what filtering
#           nulls in the render path buys you
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/reviews/review-01
# Expected: 200. A missing rating is a content problem, not a page failure.

# 12. Put the rating back
docker compose -f ../wordpress-headless/docker-compose.yml run --rm -T wpcli \
  wp post meta update "$REVIEW_ID" rating_overall 7
# Expected: Success

# 13. NEGATIVE — a </script> in editorial text does not break out of the element.
#     Feed one in through a field that reaches reviewBody, and prove it.
docker compose -f ../wordpress-headless/docker-compose.yml run --rm -T wpcli \
  wp post meta update "$REVIEW_ID" verdict 'their docs literally do </script><script>alert(1)</script>'
kill "$SERVER_PID"
rm -rf .next && npm run build > /dev/null 2>&1
npm run start > /dev/null 2>&1 & SERVER_PID=$!
sleep 6
curl -s http://localhost:3000/en/reviews/review-01 | grep -c '\\u003cscript'
# Expected: 1 or more — the escaped form is present
curl -s http://localhost:3000/en/reviews/review-01 | grep -c 'alert(1)</script>'
# Expected: 0 — no unescaped closing tag anywhere, so nothing became executable
curl -s http://localhost:3000/en/reviews/review-01 | grep -c 'application/ld+json'
# Expected: 2 — still two script ELEMENTS. A break-out would have produced a third.

# 14. Restore the verdict to a legal value for the seeded select field
docker compose -f ../wordpress-headless/docker-compose.yml run --rm -T wpcli \
  wp post meta update "$REVIEW_ID" verdict 'avoid'
kill "$SERVER_PID"

# 15. NEGATIVE — /hobt's FAQ comes from the block tree, not from a hard-coded array
grep -rn "acceptedAnswer" src/app ; echo "exit=$?"
# Expected: no matches, exit=1 — the only place that word appears is jsonLd.ts
grep -c 'faqEntriesFromBlocks' 'src/app/[locale]/hobt/page.tsx'
# Expected: 1

# 16. The payload parses as JSON after the escape — which is the proof it is lossless
rm -rf .next && npm run build > /dev/null 2>&1
npm run start > /dev/null 2>&1 & SERVER_PID=$!
sleep 6
curl -s http://localhost:3000/en/hobt \
  | perl -0777 -ne 'while (/<script type="application\/ld\+json">(.*?)<\/script>/gs) { print "$1\n" }' \
  | jq -s '.[] | (.["@type"] // ([.["@graph"][]["@type"]] | join(", ")))'
# Expected: two lines — "Organization", then "FAQPage, BreadcrumbList".
#           A jq parse error means the escape broke the JSON rather than protecting it.
kill "$SERVER_PID"

# 17. The validation results are recorded where the next person will look
grep -c 'JSON-LD validation' ../docs/schema-notes.md
# Expected: 1
grep -c 'validator.schema.org' ../docs/schema-notes.md
# Expected: 1 or more — including the note that the Rich Results Test needs a public
#           URL and is deferred to Lesson 24.7

# 18. Nothing is left broken
rm -rf .next && npm run build > /dev/null 2>&1 && echo 'clean build ok'
# Expected: clean build ok
git status --short
# Expected: nothing unexpected — no .bak, no .next
```

If check 13's second command is anything but `0`, stop: an unescaped `</script>` in a JSON-LD
payload is a live cross-site-scripting hole reachable by anyone with `edit_posts`, which in this
application includes editors. Read `serializeJsonLd` and the test in Task §7 before you touch
anything else.

## Control Questions

1. `articleJsonLd` returns `null` when the author name is empty, and `/incidents/[slug]` emits no
   `Article` at all. Explain both decisions from the same principle, and say what a crawler does
   with a node that names an author who does not exist.
2. `itemReviewed` is `Organization` on every review, and never `SoftwareApplication`. Give the
   decision procedure that produced that answer, the exact content-model change that would
   reverse it, and say why that change belongs in the content model contract before it belongs
   in `jsonLd.ts`.
3. A content route emits **two** `<script type="application/ld+json">` elements and exactly one
   `@graph`. Say why the second number is the invariant worth checking, and describe the
   alternative design that would have given one script per page and why it was rejected.
4. `jsonLd.ts` contains the second and last `dangerouslySetInnerHTML` in the codebase. Reconstruct
   the argument that this does not weaken Module 14's invariant, then name the one line in the
   file that the argument depends on and say what happens if it is wrong.
5. `/hobt`'s `FAQPage` is walked out of `core/heading` and `core/paragraph` blocks. Give two ways
   an editor could break it without any error appearing anywhere, and say what the `btt/faq`
   block would cost and what it would buy.

## Learn More

- [Google Search Central — structured data general guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
  — the policy page that defines what counts as spam, including self-serving reviews; read it
  once before you mark up anything that could be mistaken for a testimonial
- [Google Search Central — `Review` snippet](https://developers.google.com/search/docs/appearance/structured-data/review-snippet)
  — the required and recommended properties, and the explicit rules about what may and may not
  carry a rating
- [Google Search Central — `Article`](https://developers.google.com/search/docs/appearance/structured-data/article)
  — where the 110-character `headline` guidance comes from, and what Google does with a missing
  `author`
- [Google Search Central — `BreadcrumbList`](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb)
  — the `position` rules, which are the most common source of a silently invalid list
- [Google Search Central — FAQ rich result eligibility](https://developers.google.com/search/docs/appearance/structured-data/faqpage)
  — the August 2023 change that limits FAQ rich results to authoritative government and health
  sites, which is the honest answer to "why don't we see the accordion?"
- [Schema Markup Validator](https://validator.schema.org/) — accepts a pasted snippet, so it
  works against a `localhost` build; this is the tool Task §8 uses
- [Rich Results Test](https://search.google.com/test/rich-results) — Google's eligibility
  checker, which needs a public URL; run it on the Vercel preview in Lesson 24.7
- [schema.org — `@id` and node identity](https://schema.org/docs/datamodel.html) — the data model
  page that explains why referencing a node beats restating it, which is Key Concept 5's whole
  mechanism
- [JSON-LD 1.1 specification](https://www.w3.org/TR/json-ld11/) — read the `@graph` and `@id`
  sections; the rest is more than you need and the two you need are short
- [HTML Standard — the `script` element's content model](https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements)
  — the normative reason `</script>` inside a data block terminates the element, which is the
  vulnerability Key Concept 6's escape closes
