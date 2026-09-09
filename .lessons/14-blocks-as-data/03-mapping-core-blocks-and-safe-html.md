---
title: 'Mapping Core Blocks & Safe HTML'
module: 14
lesson: 3
teaches: [core-block-mapping, dompurify, html-allowlist, dangerously-set-inner-html, xss-boundary, heading-level-mapping]
produces: ['next-app/src/components/blocks/RichText.tsx', 'next-app/src/components/blocks/CoreParagraph.tsx', 'next-app/src/components/blocks/CoreHeading.tsx', 'next-app/src/components/blocks/CoreList.tsx', 'next-app/src/components/blocks/CoreQuote.tsx', 'next-app/src/components/blocks/CoreCode.tsx', 'next-app/src/components/blocks/CoreListItem.tsx']
requires: [14.2]
---

# Lesson 14.3 — Mapping Core Blocks & Safe HTML

## Quick Overview

Editors write mostly core blocks — paragraphs, headings, lists, quotes and code — so these five
components carry the majority of the site's actual content. Each one is small, and each one
makes a decision that is easy to get subtly wrong: a heading maps its `level` attribute to a
real `<h1>`–`<h6>` element rather than a styled `<div>`, a list respects `ordered`, a code block
escapes rather than renders, and a quote keeps its citation semantically attached.

The substantial part is `RichText.tsx`. A paragraph's `content` attribute genuinely is HTML —
the editor produced `<strong>`, `<em>` and `<a>` inside it, and there is no structured
representation of inline formatting to fall back on. So this is the one place the course
accepts HTML from WordPress and renders it, and it does so through a single component that
sanitizes with `isomorphic-dompurify` against a **strict allowlist**: the inline tags and
nothing else. No `<script>`, no `<iframe>`, no `<style>`, no event-handler attributes, no
`javascript:` URLs. This is the only file in `next-app/` containing
`dangerouslySetInnerHTML`, that fact is enforceable with `grep`, and Module 24 turns the grep
into a CI gate.

By the end of this lesson you will have:

- `next-app/src/components/blocks/RichText.tsx` — `isomorphic-dompurify` with an explicit tag and attribute allowlist
- Five core block components — paragraph, heading, list, quote and code — registered in the Lesson 14.2 registry
- A heading component that maps `level` to the correct element and preserves document heading order
- A stored XSS attempt written into a post by an editor account, verified as inert on the front end
- A `grep` proving exactly one occurrence of `dangerouslySetInnerHTML` in `next-app/src/`

## Classic WP Analogy

You already run an HTML allowlist on every piece of user content in every plugin you ship:

| Classic WordPress | Here |
|---|---|
| `wp_kses_post($html)` | `DOMPurify.sanitize(html, { ALLOWED_TAGS: […] })` |
| `wp_kses($html, $custom_allowed)` | the strict allowlist in `RichText.tsx` |
| `esc_html()` on anything not meant to be markup | JSX escaping, which is the default |
| `esc_url()` on every `href` | DOMPurify's URI scheme filtering |
| `wp_allowed_protocols()` | the allowlist's `ALLOWED_URI_REGEXP` |
| One `wp_kses` call at the output boundary | one `RichText` component at the output boundary |

The instinct is identical, and if you have ever written `wp_kses($content, ['a' => ['href' =>
[]], 'strong' => [], 'em' => []])` you have written this component's configuration in another
language. The principle is the same too: allowlist, never denylist, and apply it at the point of
output rather than at the point of storage, because storage-time filtering is one plugin update
away from being bypassed.

The analogy breaks in three ways, all of which favour being stricter here than you would be in
PHP.

**`wp_kses_post()` is much more permissive than you probably think.** It is the allowlist for
content authored by users who hold `unfiltered_html`-adjacent trust, and it permits `<iframe>`,
`style` attributes, `data-*` attributes and a long tail of tags nobody audits. That is a
reasonable default for a Classic theme rendering into a page that WordPress also controls. It is
not a reasonable default for a React application where an injected `<iframe>` sits inside your
authenticated session's origin. The allowlist in `RichText.tsx` is roughly eight tags and three
attributes, and every addition to it should require an argument.

**The trust boundary is different.** In Classic WordPress, `the_content()` output is authored by
people with `edit_posts`, and the site's own admin surface is the same origin, so the
"editors are trusted" assumption is at least coherent.
[The capability matrix](../appendix/03-content-model-reference.md#6-roles-and-capabilities) in
this app gives `edit_posts` to editors only and deliberately withholds it from
`incident_reporter` — but "only editors" is still a larger set than "only you", and a
compromised editor account should not be able to run script in your visitors' browsers.
Sanitizing is what makes that true.

**React defaults to safe, and PHP defaults to unsafe.** In PHP, `echo $x` is an XSS hole and you
must remember `esc_html()`. In JSX, `{x}` is escaped and injecting HTML requires typing
`dangerouslySetInnerHTML` — a name chosen to be unpleasant. That inversion is a genuine security
win, and it means the rule here can be absolute rather than aspirational: **one file, reviewed,
tested, and grep-enforceable.** Any second occurrence in this codebase is a bug, regardless of
what it renders.

---

## Key Concepts

### 1. `isomorphic-dompurify`, and why not `dompurify`

DOMPurify is the sanitizer to use; it is the one with a decade of adversarial attention on it
and a maintained bypass history. The question is which package to install.

DOMPurify works by **parsing the string into a real DOM**, walking it, and serialising what
survives. In a browser that DOM is free — `window.document` is right there. In a Node process
rendering a Server Component there is no `window`, so plain `dompurify` needs one supplied:

```
   dompurify (browser)              dompurify (Node)                 isomorphic-dompurify
   ──────────────────────           ─────────────────────────        ────────────────────────
   import DOMPurify from            import { JSDOM } from 'jsdom'    import DOMPurify from
     'dompurify'                    import createDOMPurify from       'isomorphic-dompurify'
   DOMPurify.sanitize(html)           'dompurify'
                                    const w = new JSDOM('').window   DOMPurify.sanitize(html)
                                    const P = createDOMPurify(w)
                                    P.sanitize(html)
```

| | `dompurify` | **`isomorphic-dompurify`** |
|---|---|---|
| Works in an RSC render | only with a `jsdom` window you construct | ✅ yes, unchanged |
| Works in a client component | ✅ | ✅ |
| Works under Vitest in plain Node (Module 12, 23) | needs the same setup, in the test file | ✅ yes |
| Setup code you own and can get wrong | ~4 lines, in every entry point | none |
| Verdict | ❌ | ✅ **this course** |

The wrapper picks the window for you — `jsdom` on the server, the real one in the browser — and
exposes the same `sanitize` API in both. That is worth a dependency, because the alternative is
four lines of environment detection in a security-critical file, repeated wherever it is
imported, with an `if` that is only ever exercised in one direction locally.

**The cost, stated plainly:** you take `jsdom` as a transitive dependency, which is not small,
and it lands in the server bundle. That is a real number Module 21 will see. It is the right
trade here because the alternative is not "no sanitizer" — it is "a sanitizer with a bespoke
bootstrap", and bespoke bootstraps in security code are how bypasses happen.

> **Check the licence before you install.** `isomorphic-dompurify` is MIT and DOMPurify itself is
> dual-licensed Apache-2.0 / MPL-2.0. Both are fine for a proprietary module; a GPL sanitizer
> would not be, and Task §1 checks rather than assumes.

### 2. The allowlist, written out

The configuration **is** the security boundary, so it goes in one object with a comment per key.

| Key | Value | Why |
|---|---|---|
| `ALLOWED_TAGS` | `a b br code em i mark s strong sub sup` | Inline formatting an editor can produce in a paragraph. Eleven tags. Nothing that lays out, embeds, scripts or styles |
| `ALLOWED_ATTR` | `href title rel target` | Everything a link needs and nothing else. No `id`, no `class`, no `style` |
| `ALLOWED_URI_REGEXP` | `^(?:https?:\|mailto:\|\/(?!\/)\|#)` | `https`, `http`, `mailto`, a site-relative path, or a fragment. The `(?!\/)` is what rejects protocol-relative `//evil.example` |
| `FORBID_TAGS` | `script style iframe object embed form input img svg` | Redundant with the allowlist **on purpose** — a future edit that widens `ALLOWED_TAGS` cannot let these back in by accident |
| `FORBID_ATTR` | `style srcset sizes formaction` | Same argument, one level down |
| `KEEP_CONTENT` | `true` | `<span>hello</span>` becomes `hello`, not nothing. A paste from Word should lose its markup, not its words |
| `ALLOW_DATA_ATTR` | `false` | DOMPurify permits `data-*` by default. This app has one `data-*` convention (`data-block`) and it is written by components, never by editors |
| `ALLOW_ARIA_ATTR` | `false` | An `aria-label` an editor pasted from somewhere is a claim about accessibility nobody reviewed. `docs/accessibility.md` is the review surface, and it lists attributes the source contains |

Two profiles, one file. `'inline'` is the eleven tags above and is what a paragraph, a heading
and a citation get. `'list'` is the same eleven **plus `li`**, and exists for exactly one input:
a pre-6.0 `core/list` whose items live in a `values` attribute as an HTML string rather than as
child blocks (Key Concept 8). Two named profiles in one reviewed file is a different thing from
two sanitizers in two files, and the grep-enforceable invariant survives it.

> **`ALLOWED_URI_REGEXP` is not the same check as `ALLOWED_ATTR: ['href']`.** Allowing the
> attribute permits `href="javascript:alert(1)"`; the URI regexp is what removes it. DOMPurify
> drops the *attribute* and keeps the `<a>` and its text, so the link becomes inert prose — which
> is the correct outcome, and Task §6 asserts it.

### 3. `wp_kses_post()`, compared concretely

You have written this component's configuration in PHP. What you may not have looked at is how
wide `wp_kses_post()`'s allowlist actually is.

| Input | `wp_kses_post()` | `RichText` |
|---|---|---|
| `<strong>`, `<em>`, `<a href>` | ✅ kept | ✅ kept |
| `<script>` | ❌ stripped | ❌ stripped |
| `onerror=` / any `on*` handler | ❌ stripped | ❌ stripped |
| `href="javascript:…"` | ❌ stripped | ❌ stripped |
| `<iframe>` | **✅ kept** | ❌ stripped |
| `style="…"` | **✅ kept** (a filtered subset) | ❌ stripped |
| `data-*` | **✅ kept** | ❌ stripped |
| `<table>`, `<div>`, `<span>`, `<h2>` | **✅ kept** | ❌ stripped, text preserved |
| `<img src>` | **✅ kept** | ❌ stripped — images are `core/image` and Lesson 14.5 |

The two agree on the classic XSS vectors. They disagree completely about everything else, and
the disagreement is the point: `wp_kses_post()` is an allowlist for content authored by people
WordPress considers trusted, rendering into a page WordPress also controls. Neither half of that
sentence is true here.

**Why a React app's origin is a worse place to host an injected `<iframe>` than a Classic
theme's page.** In a Classic theme, an injected iframe is an embed on a page. In this app, the
same iframe sits on the origin that holds the session cookies from Module 15 — `btt_at` and
`btt_rt` — and shares an origin with every Server Action endpoint. An iframe cannot read an
httpOnly cookie, but it can render a convincing login form on your domain, and it makes the
"same-origin" reasoning that CSRF protection depends on much less comfortable. Refusing
`<iframe>` costs an editor an embed they were not asked to make; permitting it costs you the
argument.

### 4. The trust boundary is not "administrators"

The instinct behind `wp_kses_post()` is "editors are trusted". Check what that set actually is.

`edit_posts` in this app belongs to `administrator` and `editor`.
[Appendix 03 §6](../appendix/03-content-model-reference.md#6-roles-and-capabilities) withholds
it from `incident_reporter`, which is the role Module 15 hands to every public registration — so
the set is genuinely small, and it is still not "only you".

| Who can put a string into a paragraph's `content` | Consequence if `RichText` did not sanitize |
|---|---|
| You | fine |
| Your colleague with the `editor` role | fine until they are phished |
| Anyone who obtains an `editor` session | stored XSS on every page that block appears on, running in your visitors' browsers |
| `incident_reporter` (Module 15) | **cannot** — no `edit_posts`, and `createIncident` forces `post_status = 'pending'` |

The fourth row is the one worth noticing: the capability matrix from Module 03 is already doing
most of this work, and sanitizing is what covers the case the capability matrix cannot — a
legitimate account behaving illegitimately. Defence in depth means both, not either.

### 5. Sanitize at output, not at storage

The tempting alternative is a WordPress-side filter that cleans `post_content` on save. Reject
it, and the reason generalises well beyond this app.

```
   SANITIZE AT STORAGE                        SANITIZE AT OUTPUT (this course)
   ─────────────────────────────────          ─────────────────────────────────────
   save_post → wp_kses → DB                   DB holds whatever was written
        │                                          │
        │ one plugin writing directly              │ every render path goes
        │ with wp_update_post( … ), one             │ through RichText
        │ importer, one wp-cli command,             │
        │ one REST call → BYPASSED                  ▼
        ▼                                      sanitized, always
   DB now holds a payload you believe
   is clean, and nothing re-checks it
```

Three concrete bypasses of storage-time filtering, all of them things that happen: a plugin that
calls `wp_update_post()` outside the hook you filtered; `wp post create --post_content=…` from
WP-CLI; a database restore from a backup taken before the filter existed. Every one of them
leaves a payload in the database that a storage-time model considers already-cleaned.

Output-time sanitizing has the opposite property: it does not care how the string arrived. And
it composes with WordPress keeping its own `wp_kses_post()` on the REST path, which it does —
you get both, and neither is load-bearing alone.

**The cost:** you sanitize the same string on every render rather than once on save. For a
paragraph that is microseconds, and it is cached behind Lesson 10.3's `revalidate` windows
anyway. For a 200-block page it is measurable, and Module 21 is where you would measure it.

### 6. One file, and the grep that proves it

The invariant is: **`dangerouslySetInnerHTML` appears in exactly one file in `next-app/`.**

```bash
grep -rl 'dangerouslySetInnerHTML' src/
# src/components/blocks/RichText.tsx
```

That is not a slogan; it is a property with three deliberate consequences.

| Consequence | Detail |
|---|---|
| It is reviewable | One file, forty lines, one configuration object. A reviewer can hold the whole XSS surface in their head |
| It is testable | Module 23 unit-tests `RichText` against a payload list. There is nowhere else for a payload to enter |
| It is enforceable by a machine | `grep -rl … \| wc -l` equals 1. Module 24 turns that into a CI gate, and Lesson 24.2 adds a lint rule so the failure arrives in your editor rather than in CI |

The rule that keeps it true is worth stating as a rule: **if a second occurrence seems
necessary, the design is wrong.** The two temptations you will actually meet are an excerpt
(`<p>` wrapped by WordPress — render `RichText` on it, or use the plain-text field) and Yoast's
schema JSON in Module 19 (that goes in a `<script type="application/ld+json">` via `children`,
not via `dangerouslySetInnerHTML`, and Lesson 19.3 says so).

### 7. Headings: `level` → a real element, clamped

`core/heading` stores a `level` number. Map it to a real `<h2>`–`<h6>`.

Not a styled `<div>`, and not because of a rule. A heading element does four things a `<div>`
does not: it appears in the screen reader's heading list, it is a navigation target (`H` in
NVDA, VO-U in VoiceOver), it defines the document outline browsers and search engines read, and
it is what `getByRole('heading', { level })` finds — which is how every Playwright assertion in
this course addresses a page.

**The clamp, and it is a decision with a cost.** `level: 1` becomes an `<h2>`:

| Option | What it costs |
|---|---|
| Render `<h1>` when the editor picks H1 | Two `<h1>` elements on the page. Lesson 11.4 gave the route the page's single `<h1>`, Lesson 12.3's smoke spec asserts `toHaveCount(1)` on all nine routes, and a screen-reader user gets two competing page titles |
| **Clamp to `<h2>`** | The editor's choice is silently overridden. Their H1 renders visually smaller than they expected, and nothing in wp-admin tells them why |

Clamp. An editor-composed **body** sits underneath a route-owned title, so `h2` is the correct
top level for it, and "the editor's H1 renders as an H2" is a smaller problem than "the page has
two titles". Write it down where an editor can find it — Task §7 adds the row — and note that
`theme.json` from Lesson 13.5 is where you would remove H1 from the level control entirely if
you wanted the editor's UI to agree with the front end.

**And the honest admission: you do not control the resulting heading order.** An editor can put
an `h4` directly under an `h2`, or start the body with an `h6`. `BlockRenderer` sees one block at
a time and has no view of the outline. Options for later, none of them free:

- Track the last emitted level in the renderer and clamp each heading to "at most one deeper".
  Cheap, and it silently rewrites the editor's structure.
- Report it. Module 22's axe run flags `heading-order`, and Module 23's agentic exploration can
  read a page's outline and file a finding.
- Fix it in the editor. `theme.json` and a block variation can constrain what is insertable.

This course reports rather than rewrites. Lesson 11.4 already wrote the gap into
`docs/accessibility.md` as "heading levels inside `dangerouslySetInnerHTML` content cannot be
audited, owner: Module 14" — Task §7 replaces that row, because the reason changed even though
the gap did not.

> **The linter cannot see these headings.** `jsx-a11y/heading-has-content` only fires on a
> literal `<h2>` in JSX. `CoreHeading` renders `<Tag>` where `Tag` is computed, so the rule never
> matches it. That is one more reason the accessibility note is written by hand.

### 8. Lists and quotes: children, and the legacy attribute

Modern core blocks store their contents as **child blocks**, not as attribute strings. Since
WordPress 6.0, `core/list` holds `core/list-item` children and `core/quote` holds paragraphs.
That is why this lesson registers **six** components for five block types: `CoreListItem` is a
block in its own right and needs its own row in the registry and its own inline fragment.

Verify it rather than believing it, because it depends on your content's age as well as your
WordPress version:

```bash
# Does a list arrive as children, or as a `values` string? Ask a real post.
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ post(id:\"blog-01\", idType:SLUG){ editorBlocks(flat:true){ __typename parentClientId } } }"}' \
  | jq -r '.data.post.editorBlocks[].__typename' | sort | uniq -c
```

The seeded posts contain no list, so Task §6's scratch post is where you will actually see it. A
list authored today shows `CoreList` **plus** one `CoreListItem` per row, each with the list's
`clientId` as its parent. A list pasted from a 5.x-era post can arrive as a single `CoreList`
with its rows inside `attributes.values`.

So `CoreList` handles both: render `children` when the renderer handed you some, otherwise fall
back to `RichText` with the `'list'` profile on `values`.

**`CoreQuote` deliberately gets no such fallback, and the asymmetry is the interesting part.** A
legacy list with no fallback renders `<ul></ul>` — an empty list element, which is invalid HTML
and reads as "list, 0 items" to a screen reader. A legacy quote with no fallback renders an
empty `<blockquote>` with its citation intact: sparse, valid, and obviously incomplete to
whoever looks at the page. One is a bug, the other is a gap. Spend the fallback on the bug.

The markup for a quote is `<figure>` / `<blockquote>` / `<figcaption>` / `<cite>`, matching
`HobtTestimonials` from Lesson 11.5. Not `<blockquote>` with a nested `<footer>`: a `<footer>`
inside a `<blockquote>` is not a `contentinfo` landmark, so it would be *legal* — and Lesson
11.4 put exactly one `contentinfo` in the layout, so a `grep` for `<footer>` under
`src/components/blocks/` returning nothing is a cheaper invariant than a rule about nesting
contexts that a future component has to remember.

### 9. Code: escape, never render, and the entity trap

`core/code` is the one block where markup staying visible **is** the feature. So `CoreCode` does
not import `RichText`, and Verification asserts that it does not.

There is a trap in the way, and it catches everyone once. `core/code` stores its content
**already HTML-escaped**: type `<script>` into a code block and `post_content` holds
`&lt;script&gt;`. Put that string straight into JSX and React escapes the `&` as well, so the
reader sees the literal text `&lt;script&gt;`.

```
   what the editor typed      what is stored        naive {content}      after decoding
   ────────────────────       ──────────────        ───────────────      ──────────────
   <script>x</script>         &lt;script&gt;x…     &lt;script&gt;x…    <script>x</script>
                                                   ↑ visibly wrong      ↑ correct, and
                                                                          still TEXT
```

The fix is to decode the five entities core produces and hand the result to JSX as a **text
child**. Be precise about what that is and is not: it is a decode, not a render. React escapes
the text again on the way out, so the browser receives `&lt;script&gt;` in the response body and
paints `<script>`. There is no path from `CoreCode` to markup, which is why it can afford to
decode and `RichText` cannot afford to skip DOMPurify.

`&amp;` decodes **last**, or `&amp;lt;` becomes `<` in two passes rather than the literal
`&lt;` the editor wrote. That ordering bug is subtle, survives a casual review, and is exactly
the kind of thing Module 23 writes a unit test for.

`<pre><code>` and not a styled `<div>`: `<pre>` is what preserves whitespace and tells assistive
technology that line breaks are meaningful, and `<code>` is what says the content is code.

### 10. `prose` exists, and block components do not use it

Lesson 11.1's `tailwind.config.ts` includes the typography plugin, so `prose` is available: one
class on a wrapper and every `<p>`, `<h2>`, `<ul>` and `<a>` inside it gets sensible editorial
styling. It is a genuinely good class and this module does not wrap the block tree in it.

| | `<div className="prose">` around the tree | **Targeted classes per component** |
|---|---|---|
| Styling arrives | for every descendant, by tag | per component, by decision |
| A `btt/hobt-cta` inside it | inherits article link styling on its CTA | unaffected |
| Overriding one element | `prose-headings:` variants, or a `not-prose` island | edit the component |
| Where the styling lives | in a config file, keyed on tag names | next to the markup it styles |
| Verdict | ✅ for an article rendered from one HTML blob | ✅ **here** |

The deciding argument: **an editor-composed page is not an article.** `prose` assumes a
continuous body of text where every heading and paragraph belongs to the same document. An
editor-composed page interleaves narrative with a CTA band, a live ticker and a term card, and
`prose` styles those too — an `<a>` inside `HobtCtaBand` picks up article-link underlines,
`ScapegoatPicker`'s heading picks up article-heading margins, and you end up sprinkling
`not-prose` on half the registry. That is `prose` fighting the design rather than serving it.

So each component carries the classes it needs, and inline elements *inside* `RichText` output
are styled with Tailwind's arbitrary-variant syntax on the parent — `[&_a]:underline`,
`[&_code]:bg-muted` — because the `<a>` in question was written by DOMPurify and no class of
yours will ever be on it. That is a genuinely useful trick and this is the one place in the
course that needs it.

---

## Task

### Step 1: Check the licence, then install the sanitizer

```bash
cd next-app

npm view isomorphic-dompurify license
# Expected: MIT
npm view dompurify license
# Expected: Apache-2.0 OR MPL-2.0 (the order varies by version)

npm install isomorphic-dompurify
```

A **runtime** dependency, not a dev one: it runs on every render of every paragraph.

**Verify §1:**

- [ ] Both licences are as above. Neither is GPL, which matters — a GPL dependency inside a
      proprietary module is a licensing problem, not a preference.
- [ ] `npm ls jsdom` shows it arriving transitively. That is expected and it is the cost named in
      Key Concept 1; write the number from `npm ls --all isomorphic-dompurify | wc -l` down for
      Module 21.
- [ ] `package.json` lists it under `dependencies`.

### Step 2: Extend the fragment, then regenerate

Five inline fragments added to the file from Lesson 14.1. An anchored edit — leave the header
comment and the interface fields exactly as they are.

```graphql
# next-app/src/graphql/fragments/editorBlocks.graphql — added after `... on CoreParagraph`
    ... on CoreHeading {
      attributes {
        content
        level
      }
    }
    # core/list holds core/list-item CHILDREN since WP 6.0. `values` is the legacy
    # attribute and CoreList falls back to it — Lesson 14.3 Key Concept 8.
    ... on CoreList {
      attributes {
        ordered
        values
      }
    }
    ... on CoreListItem {
      attributes {
        content
      }
    }
    # No `value` here: a legacy quote's body is deliberately not rendered.
    ... on CoreQuote {
      attributes {
        citation
      }
    }
    ... on CoreCode {
      attributes {
        content
      }
    }
```

```bash
npm run codegen
npm run type-check
```

**Verify §2:**

- [ ] The file now has **six** `... on` lines and **six** `attributes {` lines. The two counts
      must match — Lesson 14.1 Key Concept 9.
- [ ] `npm run type-check` **fails** with `TS1360`, naming `CoreHeading` as missing from
      `BlockRegistry`. That is Layer 1 of Lesson 14.2's check working exactly as advertised, from
      the fragment side. You are about to fix it by writing the components.

### Step 3: Write `RichText.tsx`

The one file. Read every comment.

```tsx
// next-app/src/components/blocks/RichText.tsx
// THE ONLY dangerouslySetInnerHTML IN next-app/. Module 24 turns the grep that
// proves it into a CI gate and Lesson 24.2 adds a lint rule. If a second
// occurrence seems necessary, the design is wrong — Key Concept 6.
//
// No `import 'server-only'`, deliberately: Module 23 renders block components in
// a plain Node process, and working there is the entire reason this package is
// the isomorphic build.
import DOMPurify from 'isomorphic-dompurify';
import type { ElementType, ReactNode } from 'react';

/** Inline formatting, and nothing else. Every addition needs an argument. */
const INLINE_TAGS = ['a', 'b', 'br', 'code', 'em', 'i', 'mark', 's', 'strong', 'sub', 'sup'];

/** The same, plus `li`, for a legacy core/list `values` string. Key Concept 8. */
const LIST_TAGS = [...INLINE_TAGS, 'li'];

/** Everything a link needs. No `id`, no `class`, no `style`. */
const ALLOWED_ATTR = ['href', 'title', 'rel', 'target'];

/**
 * https, http, mailto, a site-relative path, or a fragment. The `(?!\/)` is what
 * rejects protocol-relative `//evil.example`. `javascript:`, `data:` and
 * `vbscript:` match nothing here, so DOMPurify drops the ATTRIBUTE and keeps the
 * <a> and its text — the link becomes inert prose, which is the right outcome.
 */
const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:|\/(?!\/)|#)/i;

// Module scope, not inside the component: DOMPurify hooks are global to the
// instance, so registering per render would add one hook per paragraph.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  // Text and comment nodes reach hooks too, and they have no getAttribute.
  if (!('getAttribute' in node)) return;
  if (node.nodeName !== 'A') return;
  if (node.getAttribute('target') !== '_blank') return;

  // FORCE rel, do not strip target. An editor who asked for a new tab meant it;
  // what they did not mean was to hand the opened page a window.opener handle on
  // yours. Modern browsers imply noopener for _blank, older ones do not, and an
  // editor cannot be asked to remember which.
  node.setAttribute('rel', 'noopener noreferrer');
});

export function RichText({
  as: Tag = 'span',
  html,
  className,
  profile = 'inline',
  dataBlock,
}: {
  /** The element to render. `p`, `h2`, `cite`, `ul` — the caller decides. */
  readonly as?: ElementType;
  readonly html: string | null | undefined;
  readonly className?: string;
  /** `'list'` adds `li` and nothing else. Key Concept 2. */
  readonly profile?: 'inline' | 'list';
  /** Lets the caller keep the data-block convention on the element we render. */
  readonly dataBlock?: string;
}): ReactNode {
  // An empty attribute is a real thing editors leave behind. Render nothing
  // rather than an element with a margin, which shows up as a mystery gap.
  if (html === null || html === undefined || html.trim() === '') return null;

  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: profile === 'list' ? LIST_TAGS : INLINE_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    // Redundant with the allowlist ON PURPOSE: a future edit that widens
    // ALLOWED_TAGS cannot let these back in by accident.
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'img', 'svg'],
    FORBID_ATTR: ['style', 'srcset', 'sizes', 'formaction'],
    // `<span>hello</span>` becomes `hello`, not nothing. A paste from Word should
    // lose its markup, not its words.
    KEEP_CONTENT: true,
    // DOMPurify permits data-* by default. `data-block` is written by components,
    // never by editors.
    ALLOW_DATA_ATTR: false,
    // An aria-* an editor pasted is an accessibility claim nobody reviewed.
    ALLOW_ARIA_ATTR: false,
  });

  return (
    <Tag className={className} data-block={dataBlock} dangerouslySetInnerHTML={{ __html: clean }} />
  );
}
```

**Verify §3:**

- [ ] `grep -rl 'dangerouslySetInnerHTML' src/` prints exactly this file and nothing else.
- [ ] `npm run lint` is clean. If the hook's `node` parameter is typed as a bare `Node` by your
      version's types, the `'getAttribute' in node` guard is what keeps it compiling — do not
      delete it.

### Step 4: Write the six core block components

`CoreParagraph` is a **rewrite** — Lesson 14.2's placeholder escaped its own HTML, and this is
where that ends.

```tsx
// next-app/src/components/blocks/CoreParagraph.tsx
// Replaces Lesson 14.2's placeholder. The body now goes through RichText, so
// <strong> and <a> render as markup instead of as visible tags.
import { RichText } from '@/components/blocks/RichText';
import type { BlockComponentProps } from '@/components/blocks/registry';

export function CoreParagraph({ block }: BlockComponentProps<'CoreParagraph'>) {
  return (
    <RichText
      as="p"
      dataBlock={block.__typename}
      html={block.attributes?.content}
      // Arbitrary variants, because the <a> and <code> in here were written by
      // DOMPurify and no class of ours will ever be on them. Key Concept 10.
      className="my-4 leading-relaxed [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1"
    />
  );
}
```

```tsx
// next-app/src/components/blocks/CoreHeading.tsx
import { RichText } from '@/components/blocks/RichText';
import type { BlockComponentProps } from '@/components/blocks/registry';

type Level = 2 | 3 | 4 | 5 | 6;

// Exhaustive by construction: widen `Level` and these two stop compiling until
// you add the row. The Record trick from Lesson 07.4.
const TAG: Record<Level, 'h2' | 'h3' | 'h4' | 'h5' | 'h6'> = {
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
  6: 'h6',
};
const SIZE: Record<Level, string> = {
  2: 'text-2xl',
  3: 'text-xl',
  4: 'text-lg',
  5: 'text-base',
  6: 'text-sm',
};

export function CoreHeading({ block }: BlockComponentProps<'CoreHeading'>) {
  const raw = block.attributes?.level;

  // CLAMPED to 2-6. An editor who picks H1 in Gutenberg gets an <h2> here: the
  // route owns the page's single <h1> (Lesson 11.4) and Lesson 12.3's smoke spec
  // asserts toHaveCount(1) on every route. Key Concept 7 states what it costs.
  // `level` arrives as Float, so Math.trunc rather than a cast.
  const level: Level =
    typeof raw === 'number' && raw >= 2 && raw <= 6 ? (Math.trunc(raw) as Level) : 2;

  return (
    <RichText
      as={TAG[level]}
      dataBlock={block.__typename}
      html={block.attributes?.content}
      className={`mt-8 mb-3 font-semibold tracking-tight ${SIZE[level]}`}
    />
  );
}
```

```tsx
// next-app/src/components/blocks/CoreList.tsx
import { RichText } from '@/components/blocks/RichText';
import type { BlockComponentProps } from '@/components/blocks/registry';

export function CoreList({ block, children }: BlockComponentProps<'CoreList'>) {
  const ordered = block.attributes?.ordered === true;
  const Tag = ordered ? 'ol' : 'ul';
  const className = `my-4 pl-6 ${ordered ? 'list-decimal' : 'list-disc'}`;

  // BlockRenderer passes `null` — not an empty array — when a block has no
  // children in the flat list, so this distinguishes "modern list with
  // core/list-item children" from "legacy list with a values string".
  if (children !== null && children !== undefined) {
    return (
      <Tag data-block={block.__typename} className={className}>
        {children}
      </Tag>
    );
  }

  // Legacy (pre-6.0) list: the rows are an HTML string of <li>s in `values`.
  // The 'list' profile is the inline allowlist plus `li`, and nothing more.
  return (
    <RichText
      as={Tag}
      profile="list"
      dataBlock={block.__typename}
      html={block.attributes?.values}
      className={className}
    />
  );
}
```

```tsx
// next-app/src/components/blocks/CoreListItem.tsx
import { RichText } from '@/components/blocks/RichText';
import type { BlockComponentProps } from '@/components/blocks/registry';

export function CoreListItem({ block, children }: BlockComponentProps<'CoreListItem'>) {
  return (
    <li data-block={block.__typename} className="my-1">
      <RichText html={block.attributes?.content} className="[&_a]:underline" />
      {/* A nested list is a child block of the ITEM, not of the outer list. */}
      {children}
    </li>
  );
}
```

```tsx
// next-app/src/components/blocks/CoreQuote.tsx
import { RichText } from '@/components/blocks/RichText';
import type { BlockComponentProps } from '@/components/blocks/registry';

export function CoreQuote({ block, children }: BlockComponentProps<'CoreQuote'>) {
  const citation = block.attributes?.citation;

  // <figure>/<blockquote>/<figcaption>/<cite>, the same pairing
  // HobtTestimonials uses in Lesson 11.5. NOT a <footer> inside the blockquote:
  // that would be legal, and `grep '<footer'` returning nothing under
  // src/components/blocks/ is a cheaper invariant than a rule about nesting
  // contexts. Key Concept 8.
  return (
    <figure data-block={block.__typename} className="my-6">
      <blockquote className="border-l-4 border-border pl-4 italic">{children}</blockquote>
      {citation !== null && citation !== undefined && citation.trim() !== '' ? (
        <figcaption className="mt-2 pl-4 text-sm text-muted-foreground">
          <RichText as="cite" html={citation} className="not-italic" />
        </figcaption>
      ) : null}
    </figure>
  );
}
```

```tsx
// next-app/src/components/blocks/CoreCode.tsx
// Does NOT import RichText, and Verification asserts it. Code is the one block
// where markup staying visible IS the feature — Key Concept 9.
import type { BlockComponentProps } from '@/components/blocks/registry';

/**
 * core/code stores its content already HTML-ESCAPED, so `<script>` is on disk as
 * `&lt;script&gt;`. Handed straight to JSX, React escapes the ampersand too and
 * the reader sees `&lt;script&gt;`. So decode — and note what this is NOT: not a
 * render. The result goes into JSX as a TEXT child, React escapes it again on the
 * way out, and there is no path from here to markup.
 *
 * `&amp;` is LAST. Decode it first and `&amp;lt;` becomes `<` in two passes
 * rather than the literal `&lt;` the editor typed.
 */
const ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#0?39;/g, "'"],
  [/&amp;/g, '&'],
];

function decodeEntities(value: string): string {
  return ENTITIES.reduce((acc, [pattern, char]) => acc.replace(pattern, char), value);
}

export function CoreCode({ block }: BlockComponentProps<'CoreCode'>) {
  const raw = block.attributes?.content ?? '';
  if (raw.trim() === '') return null;

  // <pre> preserves whitespace and tells assistive technology line breaks are
  // meaningful; <code> says the content is code. A styled <div> says neither.
  return (
    <pre
      data-block={block.__typename}
      className="my-4 overflow-x-auto rounded-md bg-muted p-4 text-sm"
    >
      <code>{decodeEntities(raw)}</code>
    </pre>
  );
}
```

### Step 5: Register all six

Two anchored edits to `registry.ts`. Nothing else in that file changes.

```ts
// next-app/src/components/blocks/registry.ts — the imports, added
import { CoreCode } from '@/components/blocks/CoreCode';
import { CoreHeading } from '@/components/blocks/CoreHeading';
import { CoreList } from '@/components/blocks/CoreList';
import { CoreListItem } from '@/components/blocks/CoreListItem';
import { CoreQuote } from '@/components/blocks/CoreQuote';
```

```ts
// next-app/src/components/blocks/registry.ts — the map, edited
export const blockRegistry = {
  CoreParagraph,
  CoreHeading,
  CoreList,
  CoreListItem,
  CoreQuote,
  CoreCode,
  // 14.4 → BttIncidentCallout, BttBlameQuote, BttScapegoatPicker,
  //        BttIncidentTicker, BttHobtCta
  // 14.5 → CoreImage
} satisfies BlockRegistry;
```

```bash
npm run verify
```

**Verify §5:**

- [ ] `npm run type-check` is silent. The `TS1360` from §2 is gone, and it went away because you
      wrote the components rather than because you edited the check.
- [ ] `/en/blog/blog-01` now shows a real `<h2>` "What happened" and a formatted paragraph, with
      **six** red boxes left — the callout, the quote, the picker, the ticker, the verdict card
      and the CTA. All six are Lesson 14.4's.
- [ ] `/en/blog/blog-01` still has exactly one `<h1>` and one `<main>`.

### Step 6: The stored-XSS round trip

An argument you have read is not an argument you believe. Put a payload in the database, as an
editor, and watch it come out inert.

```bash
cd ../wordpress-headless

# The seeded `editor` user — NOT an administrator. That is the trust boundary from
# Key Concept 4, and this is the point of using their account.
EDITOR_ID=$(docker compose run --rm -T wpcli wp user get editor --field=ID | tr -d '\r')
echo "editor is user $EDITOR_ID"

# Six payloads in one paragraph, plus a list so Key Concept 8 gets exercised.
POST_ID=$(docker compose run --rm -T wpcli wp post create --porcelain \
  --post_type=post --post_status=publish --post_author="$EDITOR_ID" \
  --post_title='XSS probe (delete me)' --post_name=xss-probe \
  --post_content='<!-- wp:paragraph --><p>Before. <img src=x onerror=alert(1)> <a href="javascript:alert(2)">click</a> <a href="https://example.test" target="_blank">out</a> <span style="color:red">styled</span> <strong>bold</strong> After.</p><!-- /wp:paragraph --><!-- wp:list --><ul class="wp-block-list"><!-- wp:list-item --><li>row one</li><!-- /wp:list-item --><!-- wp:list-item --><li>row two</li><!-- /wp:list-item --></ul><!-- /wp:list --><!-- wp:code --><pre class="wp-block-code"><code>&lt;script&gt;alert(3)&lt;/script&gt;</code></pre><!-- /wp:code -->' \
  | tr -d '\r')
echo "post $POST_ID"

# Confirm the payload really is in the database. This is the "stored" in stored XSS.
docker compose run --rm -T wpcli wp post get "$POST_ID" --field=content | grep -c onerror
# Expected: 1 — WordPress stored it verbatim. Nothing has sanitized anything yet.
```

> **Do it once through wp-admin as well.** Log in at `http://localhost:8080/wp-admin` as
> `editor` with the password from your session's `$BTT_EDITOR_PASSWORD`, open the probe post,
> switch a paragraph to "Edit as HTML", and paste the payload there. The WP-CLI version above is
> the reproducible one; the by-hand version is what convinces you the editor UI accepts it, which
> is the part people assume is false.

```bash
cd ../next-app

# The front end. `npm run dev` running in another terminal.
curl -s http://localhost:3000/en/blog/xss-probe > /tmp/xss.html

grep -o 'onerror' /tmp/xss.html | wc -l
# Expected: 0 — <img> is forbidden, and it had no text content to keep.
grep -o 'javascript:' /tmp/xss.html | wc -l
# Expected: 0 — ALLOWED_URI_REGEXP dropped the href…
grep -o '>click<' /tmp/xss.html | wc -l
# Expected: 1 — …and KEEP_CONTENT kept the <a> and its text. An inert link.
grep -o 'rel="noopener noreferrer"' /tmp/xss.html | wc -l
# Expected: 1 — the afterSanitizeAttributes hook, doing its one job.
grep -o 'style=' /tmp/xss.html | wc -l
# Expected: 0
grep -o 'styled' /tmp/xss.html | wc -l
# Expected: 1 — the <span> went, its words stayed. KEEP_CONTENT.
grep -o '<strong>bold</strong>' /tmp/xss.html | wc -l
# Expected: 1 — legitimate inline markup is untouched. A sanitizer that broke this
#           would be a sanitizer everyone turns off.
grep -o 'row one' /tmp/xss.html | wc -l
# Expected: 1 — the list rendered through CoreList + CoreListItem children.
grep -o '&lt;script&gt;alert(3)' /tmp/xss.html | wc -l
# Expected: 1 — CoreCode decoded the entities and JSX re-escaped them, so the
#           response body carries entities and the browser PAINTS <script>.
rm /tmp/xss.html
```

**Verify §6:**

- [ ] Open `/en/blog/xss-probe` in a browser with the console visible. **No alert fires**, and
      the console is clean. This is the check that actually matters; the greps are how you put it
      in CI.
- [ ] The code block displays `<script>alert(3)</script>` as visible text, and view-source shows
      `&lt;script&gt;`.
- [ ] The `example.test` link opens in a new tab and its `rel` is set.

### Step 7: Delete the scratch post, then write the accessibility row

**Delete the probe.** It is not seed data, and leaving it costs you more than it looks like.

```bash
cd ../wordpress-headless
docker compose run --rm wpcli wp post delete "$POST_ID" --force

docker compose run --rm wpcli wp post list --post_type=post --format=count
# Expected: 10
```

Ten is the number the seeder produces and the number Module 14's own Starting State asserts. An
eleventh post is not harmless: it appears on the first page of `/en/blog` and changes what
Lesson 12.3's list assertions see, it lands in Module 19's sitemap, and it makes the seeded
corpus differ between your machine and CI — which is the whole class of problem Lesson 12.4
exists to prevent. `--force` rather than a trash, because a trashed post is still a post.

Then the accessibility note. Lesson 11.4 created `docs/accessibility.md` with a standing rule,
and it also wrote a "known gap" row that this lesson has to correct: the gap is no longer that
heading levels are unauditable inside a blob, it is that they are auditable and still not
controllable.

```markdown
<!-- docs/accessibility.md — replace the Module 14 row under "Known gaps, owned by a later module" -->
| Heading levels in editor-composed bodies are not controlled: `CoreHeading` clamps `level` to `h2`–`h6`, but nothing stops an editor putting an `h4` directly under an `h2` | Module 22 (`heading-order` in the axe run) |
```

```markdown
<!-- docs/accessibility.md — append to the "Every aria-* in src/, and why" section -->
### Editor-composed content (Lesson 14.3)

No `aria-*` attribute is added by any block component, and none is accepted from editor
content: `RichText` sets `ALLOW_ARIA_ATTR: false`, so an `aria-label` pasted into a paragraph is
dropped. An accessibility claim that nobody reviewed is worse than none.

| Decision | Consequence |
|---|---|
| `CoreHeading` clamps `level` to 2–6 | The route keeps the page's only `<h1>`. An editor choosing H1 gets an `<h2>`, and nothing in wp-admin tells them so. Remove H1 from the level control in `theme.json` if that matters |
| `CoreCode` renders `<pre><code>` | Whitespace is meaningful and the content announces as code |
| `CoreQuote` renders `<figure>`/`<blockquote>`/`<figcaption>`/`<cite>` | The quote and its attribution are semantically paired without ARIA |
| `CoreList` renders a real `<ul>`/`<ol>` | "list, 2 items" is announced. This is why the legacy `values` fallback exists — an empty `<ul>` announces "list, 0 items" |
| `jsx-a11y/heading-has-content` cannot see `CoreHeading` | The element is computed, not literal, so the rule never fires. This table is the review surface instead |
```

```bash
cd ../next-app
npm run verify
npm test -- --run
git add -A
git commit -m "feat(next): core block components and one sanitizing RichText"
```

---

## Verification

```bash
cd next-app

# 1. The gate: type-check, lint, format
npm run verify
# Expected: exit 0, silent

# 2. The seven files exist
ls src/components/blocks/
# Expected: BlockRenderer.tsx  CoreCode.tsx  CoreHeading.tsx  CoreList.tsx
#           CoreListItem.tsx  CoreParagraph.tsx  CoreQuote.tsx  RichText.tsx
#           UnknownBlock.tsx  registry.ts

# 3. The registry has six rows and the fragment has six inline fragments
grep -c '\.\.\. on ' src/graphql/fragments/editorBlocks.graphql
# Expected: 6
grep -c 'attributes {' src/graphql/fragments/editorBlocks.graphql
# Expected: 6 — always equal to the line above

# 4. The blog detail route renders core blocks as real elements.
#    `npm run dev` in another terminal.
curl -s http://localhost:3000/en/blog/blog-01 | grep -o 'data-block="[A-Za-z]*"' | sort | uniq -c
# Expected: 1 data-block="CoreHeading"
#           1 data-block="CoreParagraph"
#           6 data-block="UnknownBlock"
#           block_showcase() emits 8 top-level blocks. The heading and the
#           paragraph are yours now; the six btt/* ones arrive in Lesson 14.4.

# 5. The heading is a real h2, and the page still has exactly one h1
curl -s http://localhost:3000/en/blog/blog-01 | grep -o '<h2' | wc -l
# Expected: 1
curl -s http://localhost:3000/en/blog/blog-01 | grep -o '<h1' | wc -l
# Expected: 1 — Lesson 12.3's smoke spec asserts this on all nine routes, and the
#           CoreHeading clamp is what keeps it true when an editor picks H1.
curl -s http://localhost:3000/en/blog/blog-01 | grep -o '<main' | wc -l
# Expected: 1

# 6. NEGATIVE — dangerouslySetInnerHTML is in EXACTLY one file, and it is RichText
grep -rl 'dangerouslySetInnerHTML' src/ | wc -l
# Expected: 1
grep -rl 'dangerouslySetInnerHTML' src/
# Expected: src/components/blocks/RichText.tsx
#           Anything else is a bug regardless of what it renders. Module 24 turns
#           this pair of commands into a CI gate.

# 7. NEGATIVE — the allowlist has no layout, embedding, scripting or styling tag
grep -c 'ALLOWED_TAGS' src/components/blocks/RichText.tsx
# Expected: 1 — one configuration, one place
sed -n '/_TAGS = \[/p' src/components/blocks/RichText.tsx
# Expected: two lines — INLINE_TAGS with its eleven inline tags, and LIST_TAGS
#           adding 'li' and nothing else.
sed -n '/_TAGS = \[/p' src/components/blocks/RichText.tsx \
  | grep -cE "iframe|script|style|img|div|span|table|h[1-6]"
# Expected: 0 — nothing that lays out, embeds, scripts or styles is in an ALLOW
#           list. The same names appear in FORBID_TAGS, which is deliberate.

# 8. NEGATIVE — CoreCode does not sanitize-and-render, it escapes
grep -c 'RichText' src/components/blocks/CoreCode.tsx
# Expected: 0
grep -c 'dangerouslySetInnerHTML' src/components/blocks/CoreCode.tsx
# Expected: 0

# 9. NEGATIVE — no block component opens a second landmark. CoreQuote uses
#    <figure>/<figcaption>, not <blockquote><footer>, precisely so this stays true.
grep -rn '<main\|<header\|<footer' src/components/blocks/
# Expected: no output

# 10. NEGATIVE — still nothing renders or selects renderedHtml
grep -rn 'renderedHtml' src/ | wc -l
# Expected: 0

# 11. NEGATIVE — the seeded corpus is untouched. The probe post from Task §6 is
#     gone, and gone means deleted rather than trashed.
cd ../wordpress-headless
docker compose run --rm wpcli wp post list --post_type=post --format=count
# Expected: 10
docker compose run --rm wpcli wp post list --post_type=post --post_status=trash --format=count
# Expected: 0
cd ../next-app

# 12. NEGATIVE — Module 12's suites are still green. RichText is new code on the
#     blog detail route, which smoke.spec.ts visits.
npm test -- --run
# Expected: 0 failures
npx playwright test
# Expected: 0 failures
```

If check 4 shows `7 data-block="UnknownBlock"` and no `CoreHeading`, the registry compiled but
the fragment did not: run `npm run codegen` after editing a `.graphql` file, every time. If it
shows a `CoreListItem` on `blog-01`, you are looking at the probe post's cached render — the
seeded showcase contains no list.

## Control Questions

1. `RichText` sets both `ALLOWED_TAGS` (which omits `<iframe>`) and `FORBID_TAGS` (which names
   it). Explain what the second one buys, given that the first already excludes it, and describe
   the specific future change it is defending against.
2. A colleague proposes moving sanitizing to a `save_post` filter in `blame-the-tech-core` so
   the front end can render `content` directly. Give three ways a payload reaches
   `post_content` without passing through that filter, and say which one a database restore
   would reproduce.
3. `CoreCode` decodes `&lt;` to `<` and `CoreHeading` does not. Explain why the decode is safe in
   one and would be a vulnerability in the other, in terms of what JSX does with a string child
   versus what `dangerouslySetInnerHTML` does with one.
4. `CoreHeading` clamps `level: 1` to `<h2>`. Name the specific test in Lesson 12.3's
   `e2e/smoke.spec.ts` that would fail without the clamp, say what the failure message would be,
   and give the change to `theme.json` that would make the editor's UI agree with the front end.
5. The module wraps nothing in Tailwind's `prose` class. Pick two of the five `btt/*` blocks from
   Module 13 and describe, concretely, what `prose` would do to each of them that you would then
   have to undo.

## Learn More

- [DOMPurify](https://github.com/cure53/DOMPurify) — read the "Can I configure DOMPurify?"
  section next to Key Concept 2; every key in the Task's configuration object is documented
  there
- [`isomorphic-dompurify`](https://github.com/kkomelin/isomorphic-dompurify) — the wrapper, and a
  short README that is mostly about the `jsdom` question from Key Concept 1
- [DOMPurify hooks](https://github.com/cure53/DOMPurify/blob/main/demos/README.md) — the
  `afterSanitizeAttributes` demo is where the `target="_blank"` recipe in Task §3 comes from
- [`wp_kses_post()`](https://developer.wordpress.org/reference/functions/wp_kses_post/) — follow
  it through to `wp_kses_allowed_html()` and read the actual `post` allowlist; the table in Key
  Concept 3 is much more persuasive once you have
- [React — `dangerouslySetInnerHTML`](https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html)
  — React's own framing of why the name is unpleasant, and what it does not protect you from
- [OWASP — XSS prevention cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
  — rule 6 is "sanitize HTML markup with a library designed for the job", which is this lesson in
  one sentence
- [MDN — `rel="noopener"`](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/rel/noopener)
  — what the hook in Task §3 is preventing, and which browsers already imply it
- [W3C WAI — headings tutorial](https://www.w3.org/WAI/tutorials/page-structure/headings/) —
  read this before deciding you disagree with the clamp in Key Concept 7
- [Tailwind typography plugin](https://github.com/tailwindlabs/tailwindcss-typography) — the
  `prose` class Key Concept 10 declines to use, including the `not-prose` escape hatch that the
  argument turns on
