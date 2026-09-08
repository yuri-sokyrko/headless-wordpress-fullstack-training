---
title: 'Dynamic Blocks & the Data Module'
module: 13
lesson: 4
teaches: [dynamic-blocks, render-php, save-returns-null, server-side-render, attribute-design-for-consumers, block-context]
produces: ['wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-ticker/block.json', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-ticker/index.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-ticker/edit.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-ticker/render.php', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/hobt-cta/block.json', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/hobt-cta/index.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/hobt-cta/edit.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/hobt-cta/save.js', 'wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/hobt-cta/editor.scss']
requires: [13.3]
---

# Lesson 13.4 — Dynamic Blocks & the Data Module

## Quick Overview

Some blocks cannot be static. `btt/incident-ticker` shows the five most recent S1 and S2
incidents, and freezing that list into `post_content` at save time would mean a ticker that is
wrong within a day. So it becomes a **dynamic block**: `save: () => null`, nothing but the
comment in the post content, and a `render: file:./render.php` that queries WordPress at request
time. `btt/hobt-cta` goes the other way — it is static, its attributes are simple, and it exists
to be a design exercise in what a block should store when the consumer is a typed React
component rather than a PHP template.

Dynamic blocks are also the one place in this module where headless costs you something real,
and the lesson says so plainly. `render.php` produces PHP-rendered HTML, and Module 14 has a
hard rule against rendering WordPress's HTML on the Next side — so the ticker's PHP output is
useful in wp-admin and in the WordPress-rendered preview, and completely unused by your actual
front end. Next re-runs the equivalent query itself. That means the ticker's logic exists twice,
in two languages, and keeping them agreeing is a maintenance cost you are choosing on purpose.
Naming that cost is more useful than pretending dynamic blocks are free.

By the end of this lesson you will have:

- `src/incident-ticker/*` — a dynamic block with `save: () => null` and `render: file:./render.php`
- A `render.php` using `WP_Query` with a `tax_query` on `severity`, output escaped with `esc_html()` and `wp_kses_post()`
- An `edit.js` that shows a live preview in the editor using `useSelect`, not a static placeholder
- `src/hobt-cta/*` — attributes designed for a typed consumer: a label, a variant from a closed set, a target and a `LeadSource` value
- A written comparison of what the ticker costs in a headless build versus a Classic one, and why it is still the right choice here

## Classic WP Analogy

A dynamic block is a shortcode with a user interface. That is not an approximation — the
mechanism is the same and even the PHP looks the same:

```
Classic: shortcode                          Dynamic block: render.php
──────────────────────────────────────────  ──────────────────────────────────────────
add_shortcode('btt_ticker', function($a) {  <?php
  $q = new WP_Query([                       // render.php receives $attributes,
    'post_type'      => 'incident',         // $content and $block
    'posts_per_page' => (int) $a['count'],  $q = new WP_Query([
    'tax_query'      => [[ … ]],              'post_type'      => 'incident',
  ]);                                         'posts_per_page' => $attributes['count'],
  ob_start();  /* … */  return ob_get_clean(); 'tax_query'      => [[ … ]],
});                                         ]);
                                            // echo directly; the block wrapper handles the rest
```

Both run on every request, both read attributes, both query the database, both must escape their
output. If you have written a shortcode that lists posts, you have written a dynamic block's
renderer. What the block adds is everything around it: an inserter entry, an inspector panel, a
live preview in the editor, undo support, and attributes with declared types instead of
`shortcode_atts()` defaults.

The analogy breaks in the direction that matters for this course. **A shortcode's output is the
deliverable; `render.php`'s output is not.** In a Classic build, `render.php` renders the thing
visitors see, and that is the end of the story. In this architecture, WPGraphQL Content Blocks
exposes the ticker block's `renderedHtml` — the output of that very PHP — and Lesson 14.1
establishes a hard rule against rendering it: it arrives with `wp-block-*` classes Tailwind
never compiled, raw `<a>` tags that bypass client-side navigation, WordPress's locale rather
than the route's, and HTML baked at WordPress render time with nothing to hang a cache tag on.
So Next reads the ticker's *attributes* — `count`, `severities` — and fires its own GraphQL
query, in TypeScript, with its own cache tags.

The cost, stated plainly: the ticker's selection logic is implemented twice, once in
`render.php` and once in a React component in Lesson 14.4, and a change to one is a silent
divergence from the other. The alternatives are worse. Rendering `renderedHtml` would breach a
security and design boundary the whole front end depends on; making the block static would make
it wrong; dropping the PHP renderer entirely would break the editor preview and the WordPress
preview route Module 17 relies on. Two implementations, documented and tested, is the least bad
option — and the second implementation is nine lines because the query already exists.

`btt/hobt-cta` has a smaller and happier break. In a Classic build you would store the
button's classes and markup, because markup is the output. Here you store **meaning**: a
`variant` from a closed set, a `leadSource` from the `LeadSource` enum in
[the content model contract](../appendix/03-content-model-reference.md#3-registered-graphql-enums),
and a target URL. The front end decides what a `primary` variant looks like. That is the whole
attribute-design principle for a headless block set: store what the editor decided, never how it
should look.

---

## Key Concepts

### 1. Four registration shapes, and "dynamic" means one specific thing

The word "dynamic" is used loosely enough to be actively misleading. Three of this plugin's six
blocks return `null` from `save()` and only **one** of them is dynamic. The distinction that
matters is whether **PHP runs at render time**.

| Shape | `save()` | PHP at render? | In `post_content` | Verdict |
|---|---|---|---|---|
| **Static** | returns markup | no | the comment **and** the markup | ✅ the default. `btt/incident-callout`, `btt/blame-quote` |
| **Null save, no renderer** | `() => null` | **no** | the comment only | ✅ correct when a React front end renders it. `btt/scapegoat-picker`, `btt/hobt-cta` |
| **Null save + `render: file:./render.php`** | `() => null` | **yes** | the comment only | ✅ the only genuinely dynamic shape here. `btt/incident-ticker` |
| **`render_callback` in `register_block_type()`** | `() => null` | yes | the comment only | ❌ legacy. Same behaviour, but the renderer is a closure in a PHP file instead of a declared file, so `block.json` stops being the whole description |

So there are two independent questions, and collapsing them is the mistake:

```
                     does save() emit markup?
                         yes            no
                   ┌──────────────┬──────────────────────────────┐
  does PHP run     │  static      │  "headless-shaped": data in  │
  at render        │  (13.2, 13.3)│  the comment, nothing else   │
  time?      no    │              │  (scapegoat-picker, hobt-cta)│
                   ├──────────────┼──────────────────────────────┤
             yes   │  rare, and   │  DYNAMIC                     │
                   │  usually a   │  (incident-ticker)           │
                   │  mistake     │                              │
                   └──────────────┴──────────────────────────────┘
```

`save: () => null` says "I contribute no HTML to the document". `render` says "ask PHP for HTML
when someone renders this document". A block can do the first without the second, and in a
headless build that combination is not a degenerate case — **it is the shape you want most
often**, because the document is a data structure and the rendering happens somewhere else
entirely.

`btt/incident-ticker` needs the third shape for one reason: its content is a *query result*, and
freezing a query result into `post_content` at save time produces a ticker that is wrong the
next time an incident is filed. `btt/hobt-cta` needs the second shape because a CTA's content
is four attributes an editor typed, and those do not go stale.

> **Never make a block dynamic to avoid the validator.** It works — a block with no saved markup
> cannot fail validation — and it is the wrong reason. You have traded a load-time comparison you
> can fix for a PHP execution on every request, plus a second implementation to keep in sync.
> Lesson 13.5's `deprecated` mechanism is the right answer to a changing `save()`.

### 2. `render.php`'s contract

WordPress `include`s the file inside a function scope, with three variables in place:

| Variable | Type | Is | Watch out for |
|---|---|---|---|
| `$attributes` | `array` | the block's attributes, **already validated against `block.json`'s schema and defaulted** | keys can still be missing if the schema has no `default` |
| `$content` | `string` | the serialised inner blocks, already rendered | empty for a block with no `InnerBlocks` |
| `$block` | `WP_Block` | the block instance: `$block->name`, `$block->context`, `$block->parsed_block` | `$block->context` is how `usesContext` arrives (Key Concept 8) |

Four rules, and each of them is a bug if you get it wrong:

- **`echo`, do not `return`.** The file's return value is discarded. `return;` on its own is how
  you render nothing, and it is the correct early exit.
- **Emit the block wrapper with `get_block_wrapper_attributes()`.** It assembles the generated
  class name plus everything `supports` contributed. Hand-writing `class="wp-block-btt-…"` works
  until someone enables an alignment support and wonders why it does nothing.
- **`get_block_wrapper_attributes()` returns *escaped* output.** It is a string of
  `key="value"` pairs, already run through `esc_attr()` internally. Wrapping it in `esc_attr()`
  yourself double-escapes and produces visibly broken HTML. This is the opposite of the usual
  WordPress instinct and it is the most common mistake in a first `render.php`.
- **Namespace your locals.** The file is `include`d into a scope you do not own. A `$count` or
  `$query` local is a collision waiting for a WordPress version that happens to use the same
  name. This plugin prefixes with `$btt_`.

`prepare_attributes_for_render()` is the step worth knowing about. Before the include, WordPress
validates `$attributes` against your `block.json` schema and substitutes the declared `default`
for anything invalid — including honouring an `enum`. That is a real difference from the editor:
**`enum` is enforced on the PHP render path and not on the JavaScript parse path.** So a
hand-edited `{"variant":"neon"}` in the database becomes `"primary"` in `render.php` and stays
`"neon"` in the editor and in the GraphQL attributes Module 14 reads. Neither side is wrong;
they are validating for different consumers, and Module 14's component has to narrow the value
itself.

### 3. `WP_Query` in a block: `tax_query`, `fields`, and the flags that matter

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-ticker/render.php — (illustration; the Task writes the real file)
$btt_query = new WP_Query(
	array(
		'post_type'              => 'incident',
		'post_status'            => 'publish',
		'posts_per_page'         => $btt_count,
		'fields'                 => 'ids',        // 1.
		'no_found_rows'          => true,         // 2.
		'update_post_meta_cache' => false,        // 3.
		'update_post_term_cache' => false,        // 3.
		'ignore_sticky_posts'    => true,         // 4.
		'tax_query'              => array( array( 'taxonomy' => 'severity', 'field' => 'slug', 'terms' => $btt_sevs ) ),
	)
);
```

| Flag | Without it | Why it matters here |
|---|---|---|
| `'fields' => 'ids'` | `SELECT wp_posts.*` and a full `WP_Post` hydration for every row | You need a title and a permalink. Fetching every column and then priming meta you never read is work you can decline. |
| `'no_found_rows' => true` | MySQL runs `SELECT FOUND_ROWS()` as a second query so `max_num_pages` can exist | The ticker never paginates. This is a free query removed, on a block that may appear on every article. |
| `update_post_meta_cache` / `update_post_term_cache` `=> false` | one extra query each, priming caches for meta and terms | You read neither. |
| `'ignore_sticky_posts' => true` | a sticky post is prepended and your `posts_per_page` is quietly off by one | The ticker is "most recent N", and a sticky incident is not more recent. |
| `'post_status' => 'publish'` | in an admin context, `WP_Query` can widen to include drafts | The ticker must never leak a pending incident, and Module 06 makes *every* public incident `pending` on submission. |

`'fields' => 'ids'` has a consequence you must then handle deliberately: `get_the_title( $id )`
on an unprimed ID is one `SELECT` per post, so five items become five queries and you have made
things worse. The fix is one line:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-ticker/render.php — (illustration)
_prime_post_caches( $btt_query->posts, false, false );  // one SELECT ... WHERE ID IN (…)
```

That is the honest shape of the trade: `ids` gives you control over what gets loaded, and
control means you now have to say what you want. Two queries total — the `tax_query` join and
one `IN` fetch — for any `count`.

`tax_query` with `'field' => 'slug'` rather than `term_id` is deliberate: the attribute stores
slugs (they are the closed set from
[appendix 03 §2](../appendix/03-content-model-reference.md#2-taxonomies)), and slugs are stable
across machines while term IDs are not. Lesson 12.4's determinism rule, applied inside a block.

### 4. Escaping is back, and each function has exactly one place

You are in PHP again. Every rule you suspended in Lesson 13.2's `save.js` returns, in full.

| Function | Use for | In this block |
|---|---|---|
| `esc_html()` | text inside an element | the incident title |
| `esc_url()` | a URL in `href` or `src` | the permalink |
| `esc_attr()` | a value inside an HTML attribute **you wrote by hand** | the `data-severities` list on the wrapper |
| `wp_kses_post()` | a string that is *supposed* to contain HTML | an excerpt, if the ticker ever shows one |
| *(nothing)* | `get_block_wrapper_attributes()` | it escapes itself. Key Concept 2 |

Three shapes to recognise as wrong on sight:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-ticker/render.php — (illustration of what NOT to write)
<?= $attributes['count'] ?>                              // ❌ short echo tag, unescaped
<?php echo $attributes['label']; ?>                      // ❌ raw attribute into markup
<div <?php echo esc_attr( get_block_wrapper_attributes() ); ?>>  // ❌ double-escaped
```

The first two are why the Verification block below greps for `<?=` and `echo $attributes` and
expects zero hits. An attribute is not trusted input just because an editor typed it — an
attribute is a string in a `longtext` column that anybody with database access, a REST write, or
a `wp post update` can set.

> **`esc_html()` on a value that is already safe is harmless. Forgetting it once is not.**
> Escape at the point of output, every time, without reasoning about provenance. Reasoning about
> provenance is how holes get argued into existence.

### 5. The editor preview: `useSelect`, not `<ServerSideRender />`

The ticker has to show something in the editor, and there are two ways.

| | `<ServerSideRender block="btt/incident-ticker" attributes={…} />` | `useSelect` on `core` |
|---|---|---|
| What it shows | the actual output of `render.php` | your own React rendering of the same data |
| Cost | **one HTTP round trip to `/wp-json/wp/v2/block-renderer/…` per attribute change** | reads a cached store; one REST call per distinct query, shared with the rest of the editor |
| Feels like | a spinner, then a flash of unstyled server HTML | the rest of the editor |
| Styling | wp-admin CSS applied to front-end markup, which is neither | yours |
| In a headless build | shows the editor HTML **that no visitor will ever see** | shows the data the front end will actually render |
| Verdict | ❌ | ✅ |

`ServerSideRender` is not a bad component; it is the right answer when `render.php` *is* the
deliverable and duplicating it in JavaScript would be a third implementation. Here `render.php`
is already the second implementation of something Module 14 implements a third time in
TypeScript, and showing an editor a preview of the output nobody consumes actively misleads
them. Use `useSelect`, and accept that the editor preview and `render.php` are two renderings
that can drift — the same cost Key Concept 6 is about, and it is the cost you already chose.

The preview needs one thing `render.php` does not: the REST API filters posts by taxonomy using
**term IDs**, not slugs. So the preview reads the `severity` terms first, maps the attribute's
slugs to IDs, and then queries. Two `useSelect` calls, and the second depends on the first —
which is exactly where Lesson 13.3's dependency-array rule earns its keep, because the mapped ID
array must be memoised or the second subscription churns forever.

### 6. The double-implementation cost, named and priced

The ticker's selection logic — "the most recent `count` incidents whose `severity` is in
`severities`" — exists twice by the end of Module 14:

```
      wordpress-headless/…/incident-ticker/render.php        next-app/src/components/blocks/IncidentTicker.tsx
      ─────────────────────────────────────────────────      ────────────────────────────────────────────────────
      WP_Query + tax_query on severity slugs                 fetchGraphQL(IncidentsBySeverity, { … })
      consumed by: the editor preview? no (Key Concept 5)    consumed by: every visitor
                   wp-admin's the_content()? nobody reads it
                   Module 17's WP preview route? yes
                   Module 14's front end? NO
```

A change to one is a silent divergence from the other. There is no compiler, no test that spans
both, and nothing that fails. That is a genuine, permanent maintenance cost and it is the price
of this block. The three alternatives are all worse:

| Alternative | Why it is worse |
|---|---|
| Render `renderedHtml` on the Next side | Breaches the boundary the whole front end depends on: `wp-block-*` classes Tailwind never compiled, raw `<a>` bypassing client navigation, WordPress's locale instead of the route's, HTML baked at WP render time with no cache tag to hang off, and a `dangerouslySetInnerHTML` fed by anyone with `edit_posts`. Module 14's README lists all five |
| Make the block static | The list is frozen at save time. Wrong within a day, and wrong in a way nobody notices for weeks |
| Delete `render.php` entirely | `the_content()` renders nothing for the block, so Module 17's WordPress-side preview shows a hole where the ticker is, and the block becomes invisible to any future non-Next consumer |
| **Keep both, document both, and test the one that ships** | ✅ Two implementations, one of which is load-bearing. The other is a fallback with a named purpose |

The mitigation that makes it tolerable: **the shared thing is the attribute contract, not the
code.** `count` and `severities` are written down in `docs/content-model.md`, both
implementations read the same two attributes, and the TypeScript one is nine lines because the
incidents query already exists from Module 10. Divergence in the *filter* is impossible; only
divergence in *presentation* is possible, and presentation is exactly what the front end is
supposed to own.

### 7. Attribute design for a typed consumer: store the decision, not the presentation

`btt/hobt-cta` is not here because a CTA is interesting. It is here as the worked example of the
question every attribute answers: **what did the editor decide, and what is a rendering
detail?**

| ❌ Store the presentation | ✅ Store the decision | Why |
|---|---|---|
| `className: "btn btn-lg btn-red"` | `variant: "primary"` | Tailwind compiled no `btn-red`. The front end owns what `primary` looks like, and can restyle every CTA on the site in one file |
| `buttonHtml: "<a class=…>Get Demo</a>"` | `label`, `href` | Markup in an attribute is markup you must sanitize, and it cannot become a `next/link` |
| `width: "320px"` | *(nothing)* | Layout is the front end's. An editor-set pixel width is a bug report from a phone |
| `trackingCode: "gtag('event',…)"` | `leadSource: "hobt-cta-block"` | Executable strings in content are an XSS surface. A named source is data |
| `isPrimary: true` + `isOutline: true` | `variant: "primary" \| "outline"` | Two booleans encode four states, two of which are nonsense. A closed string encodes exactly the states that exist |

`leadSource` is the attribute with a genuine subtlety, and it is a naming boundary you will meet
again in Module 16. It is stored **kebab-case** — `hobt-hero`, `hobt-cta-block`, `hobt-footer`,
`incident-sidebar` — because that is what the `wp_btt_leads.source` column holds
([appendix 03 §5](../appendix/03-content-model-reference.md#5-the-one-thing-that-is-not-a-post-wp_btt_leads))
and what the ACF select convention uses. The GraphQL enum is `SCREAMING_SNAKE_CASE` —
`HOBT_CTA_BLOCK` — because that is GraphQL's convention
([appendix 03 §3](../appendix/03-content-model-reference.md#3-registered-graphql-enums)).

```
   block attribute        the Next side maps           the mutation input
   leadSource:            kebab → enum, in ONE         submitHobtLead(
   "hobt-cta-block"  ───▶ place, on the way into  ───▶   source: HOBT_CTA_BLOCK
   (kebab, stored)        submitHobtLead                )      (enum, wire format)
                                                              │
                                                              ▼
                                                        wp_btt_leads.source
                                                        = 'hobt-cta-block'
                                                          (kebab, stored)
```

Kebab in, kebab out, enum on the wire. One mapping function, in Module 16, and nothing else in
the system has to know two spellings of the same value. The alternative — storing
`HOBT_CTA_BLOCK` in the attribute — would put a GraphQL wire format into WordPress content, and
the day the enum gains a value the content and the schema disagree.

### 8. Block context: `providesContext` and `usesContext`

Attributes flow nowhere. Context flows **down the block tree**, so a child can read something an
ancestor knows without either one being coupled to the other's attributes.

```
core/query  providesContext: { queryId: 'queryId' }
  └─ core/post-template   providesContext: { postId, postType }   ← core sets these
       └─ btt/tech-verdict-card   usesContext: [ 'postId' ]
              knows which post it is inside, without being told by an attribute
```

| | `providesContext` | `usesContext` |
|---|---|---|
| Declared in | `block.json`, as `{ "contextKeyName": "attributeName" }` | `block.json`, as `[ "contextKeyName" ]` |
| Value comes from | one of **this** block's attributes | the nearest ancestor that provides that key |
| Arrives in `edit` as | — | the `context` prop |
| Arrives in `render.php` as | — | `$block->context['postId']` |

`postId` and `postType` are provided by core in the editor and by the render pipeline on the
server, which is what makes context useful even when there is no `core/query` in sight. Lesson
13.5's optional `btt/tech-verdict-card` declares `usesContext: [ 'postId' ]` so a Block Binding
can read the surrounding post's ACF `verdict` field, rather than copying the value into an
attribute and going stale.

The reason it is only introduced here: context is the mechanism, and it does nothing on its own.
It becomes worth the paragraph in 13.5, where it feeds Block Bindings.

> **Context is not for passing your own state around.** If you catch yourself using
> `providesContext` between two blocks you wrote, so that one can configure the other, you
> probably wanted `InnerBlocks` with `allowedBlocks` and a shared parent — a relationship the
> editor can enforce, rather than one that silently degrades when the child is moved.

### 9. Caching a dynamic block's query, and why the answer is different here

In a Classic build, a `WP_Query` in a block that appears on every article is exactly where you
reach for a short transient:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-ticker/render.php — (illustration of the CLASSIC answer, deliberately not written in this course)
$ids = get_transient( 'btt_ticker_' . md5( wp_json_encode( $attributes ) ) );
if ( false === $ids ) {
	$ids = ( new WP_Query( … ) )->posts;
	set_transient( 'btt_ticker_' . md5( wp_json_encode( $attributes ) ), $ids, 60 );
}
```

Sixty seconds of staleness for one query instead of thousands. Obviously correct — in a Classic
build.

Here, the verdict flips, and the reason is worth stating precisely: **nobody visits the
PHP-rendered page.** The `btt-headless` theme redirects every front-end request to Next
(Lesson 02.4). The editor preview uses `useSelect`, not this renderer (Key Concept 5). So the
consumers of `render.php` are Module 17's preview route and any future non-Next reader — a
volume of requests measured in "a few per editing session". Caching that costs you:

| Cost | Detail |
|---|---|
| A cache key you must get right | `md5( wp_json_encode( $attributes ) )` is a fingerprint of *all* attributes, so an unrelated attribute change busts a cache it did not need to |
| An invalidation problem | Publishing an incident should clear it. Now you own a `save_post` hook, and Module 18 already owns one for a different cache |
| A staleness window in the one place staleness is expensive | Module 17's preview exists so an editor can see the truth before publishing. A 60-second cache in the preview path is a lie with a timer on it |
| Debugging surface | "the ticker is wrong" now has two possible causes |

**Verdict: no transient.** Two queries, a handful of times per session, is not a performance
problem, and the caching that matters in this architecture lives on the Next side where it is
tag-based and Module 18 makes it precise. Write the query plainly, and put the cache where the
traffic is.

---

## Task

### Step 1: Declare `btt/incident-ticker`

Note what is missing from this file: there is no `save` anywhere, and there will be no
`save.js`. `render` replaces it.

```json
{
  "$schema": "https://schemas.wp.org/trunk/block.json",
  "apiVersion": 3,
  "name": "btt/incident-ticker",
  "version": "0.1.0",
  "title": "Incident Ticker",
  "category": "btt",
  "description": "The most recent incidents at the severities you choose. Queried at render time, never frozen into the post.",
  "keywords": ["incident", "ticker", "recent", "severity"],
  "textdomain": "blame-the-tech-blocks",
  "attributes": {
    "count": {
      "type": "number",
      "default": 5
    },
    "severities": {
      "type": "array",
      "default": ["s1-catastrophic", "s2-major"],
      "items": {
        "type": "string"
      }
    }
  },
  "supports": {
    "className": true,
    "customClassName": false,
    "html": false,
    "anchor": false,
    "align": false,
    "color": false,
    "spacing": false,
    "typography": false,
    "reusable": false,
    "multiple": true
  },
  "editorScript": "file:./index.js",
  "render": "file:./render.php"
}
```

Path:
`wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-ticker/block.json`.
`items: { type: 'string' }` on `severities` is what makes WPGraphQL Content Blocks type it as a
list of strings in Module 14 rather than an opaque array. `reusable: false` because a reusable
"most recent five" is a shared pointer to a query, which is a concept nobody wants to debug.

> **The seeded fixture writes both attributes explicitly** —
> `{"count":5,"severities":["s1-catastrophic","s2-major"]}` — even though both equal their
> defaults. That is legal hand-written markup. Open `blog-01` in the editor, change anything,
> save, and Gutenberg will drop both from the comment because they match the defaults. The
> parsed attributes are identical either way, which is the point of Lesson 13.2 Key Concept 1
> and the reason Module 14 must apply the same defaults itself.

### Step 2: Write `render.php`

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-ticker/render.php
<?php
/**
 * Server render for btt/incident-ticker.
 *
 * NOTHING a visitor sees comes from this file. The btt-headless theme redirects
 * every front-end request to Next.js, and Module 14 renders this block from its
 * attributes in TypeScript. This renderer exists for `the_content()`, for
 * Module 17's WordPress-side preview route, and so the block is not invisible to
 * a future non-Next consumer. Lesson 13.4 Key Concept 6 prices that honestly.
 *
 * @package Blame\Blocks
 *
 * @var array<string, mixed> $attributes Validated and defaulted by WordPress.
 * @var string               $content    Serialised inner blocks. Empty here.
 * @var WP_Block             $block      The block instance.
 */

declare( strict_types=1 );

defined( 'ABSPATH' ) || exit;

// Locals are prefixed because this file is include()d into a scope we do not own.
// A bare $count or $query is a collision waiting for a WordPress release.
$btt_count = max( 1, min( 20, (int) ( $attributes['count'] ?? 5 ) ) );

// Never trust the array. `enum` on an ARRAY's items is not validated by
// prepare_attributes_for_render(), so intersect against the closed set from
// appendix 03 §2 ourselves.
$btt_severities = array_values(
	array_intersect(
		array_map( 'sanitize_title', (array) ( $attributes['severities'] ?? array() ) ),
		array( 's1-catastrophic', 's2-major', 's3-minor', 's4-cosmetic' )
	)
);

// No severities selected means no query and no markup. `return`, not `return ''`
// — this file's return value is discarded either way, and echoing nothing is the
// documented way for a block to render nothing.
if ( array() === $btt_severities ) {
	return;
}

$btt_query = new WP_Query(
	array(
		'post_type'   => 'incident',
		// Public incidents are created as `pending` by Module 06's mutation.
		// Without this, an admin-context render could leak an unmoderated one.
		'post_status' => 'publish',

		'posts_per_page'         => $btt_count,
		'orderby'                => 'date',
		'order'                  => 'DESC',

		// Key Concept 3, one line at a time.
		'fields'                 => 'ids',   // no full WP_Post hydration
		'no_found_rows'          => true,    // no SELECT FOUND_ROWS(); nothing paginates
		'update_post_meta_cache' => false,   // we read no meta
		'update_post_term_cache' => false,   // we read no terms
		'ignore_sticky_posts'    => true,    // "most recent" means most recent

		'tax_query'              => array(
			array(
				'taxonomy' => 'severity',
				// Slugs, not term IDs: slugs are stable across machines and term
				// IDs are a property of a table's history (Lesson 12.4).
				'field'    => 'slug',
				'terms'    => $btt_severities,
			),
		),
	)
);

if ( ! $btt_query->have_posts() ) {
	return;
}

// `fields => ids` means the posts are NOT in the cache, so get_the_title() below
// would be one SELECT each. One deliberate IN() fetch instead of five lookups.
_prime_post_caches( $btt_query->posts, false, false );

// get_block_wrapper_attributes() escapes its own output — do NOT wrap it in
// esc_attr(). `data-severities` is hand-written, so that one does need it.
?>
<div
	<?php echo get_block_wrapper_attributes( array( 'class' => 'btt-incident-ticker' ) ); ?>
	data-severities="<?php echo esc_attr( implode( ' ', $btt_severities ) ); ?>"
>
	<ul>
		<?php foreach ( $btt_query->posts as $btt_id ) : ?>
			<li>
				<a href="<?php echo esc_url( (string) get_permalink( $btt_id ) ); ?>">
					<?php echo esc_html( get_the_title( $btt_id ) ); ?>
				</a>
			</li>
		<?php endforeach; ?>
	</ul>
</div>
<?php
// wp_reset_postdata() is deliberately absent: `fields => ids` never touched the
// global $post, and `have_posts()` was called without `the_post()`. Calling it
// here would be cargo cult.
```

**Verify §2:**

- [ ] `docker compose exec wordpress php -l /var/www/html/wp-content/plugins/blame-the-tech-blocks/src/incident-ticker/render.php`
      prints `No syntax errors detected`. Run it from `wordpress-headless`. `wp-scripts` does
      **not** lint PHP, so a syntax error here is discovered by a white screen in wp-admin.
- [ ] The file contains no `<?=` and no `echo $attributes`.
- [ ] `get_block_wrapper_attributes()` is not wrapped in `esc_attr()`.

### Step 3: Write the editor preview

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-ticker/index.js
import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import Edit from './edit';

// NO `save` key. A block with `render` in block.json and no `save` serialises to
// the self-closing comment, and `render.php` produces the HTML at request time.
// (Passing `save: () => null` explicitly would be equivalent and noisier.)
registerBlockType( metadata.name, { edit: Edit } );
```

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/incident-ticker/edit.js
import { __, sprintf } from '@wordpress/i18n';
import { InspectorControls, useBlockProps } from '@wordpress/block-editor';
import { CheckboxControl, PanelBody, RangeControl, Spinner } from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { decodeEntities } from '@wordpress/html-entities';
import { useMemo } from '@wordpress/element';

import { SEVERITY_OPTIONS } from '../severities';

const TERMS_QUERY = { per_page: 100, orderby: 'slug', order: 'asc' };
const TERMS_ARGS = [ 'taxonomy', 'severity', TERMS_QUERY ];

export default function Edit( { attributes, setAttributes } ) {
	const { count, severities } = attributes;
	const blockProps = useBlockProps();

	// 1. The REST API filters posts by taxonomy using TERM IDS, so the slugs in
	//    the attribute have to be resolved first. render.php does not need this
	//    step, because tax_query accepts slugs directly — one of the small ways
	//    the two implementations differ. Key Concept 6.
	const terms = useSelect( ( select ) => select( coreStore ).getEntityRecords( ...TERMS_ARGS ), [] );

	// 2. MEMOISED. A fresh array here would be a fresh dependency for the
	//    subscription below on every render, and useSelect would churn forever.
	//    Lesson 13.3 Key Concept 7.
	const termIds = useMemo(
		() => ( terms ?? [] ).filter( ( t ) => severities.includes( t.slug ) ).map( ( t ) => t.id ),
		[ terms, severities ]
	);

	const incidents = useSelect(
		( select ) =>
			termIds.length
				? select( coreStore ).getEntityRecords( 'postType', 'incident', {
						per_page: count,
						severity: termIds,
						orderby: 'date',
						order: 'desc',
						status: 'publish',
					} )
				: [],
		[ count, termIds ]
	);

	const toggle = ( slug, isChecked ) =>
		setAttributes( {
			// setAttributes merges, but an ARRAY attribute still needs a NEW array.
			severities: isChecked
				? [ ...severities, slug ]
				: severities.filter( ( s ) => s !== slug ),
		} );

	return (
		<>
			<InspectorControls>
				<PanelBody title={ __( 'Ticker', 'blame-the-tech-blocks' ) }>
					<RangeControl
						__nextHasNoMarginBottom
						label={ __( 'How many', 'blame-the-tech-blocks' ) }
						value={ count }
						min={ 1 }
						max={ 20 }
						onChange={ ( value ) => setAttributes( { count: value } ) }
					/>
					{ SEVERITY_OPTIONS.map( ( { value, label } ) => (
						<CheckboxControl
							__nextHasNoMarginBottom
							key={ value }
							label={ label }
							checked={ severities.includes( value ) }
							onChange={ ( isChecked ) => toggle( value, isChecked ) }
						/>
					) ) }
				</PanelBody>
			</InspectorControls>

			<div { ...blockProps }>
				{ /* Three states again, and the empty one is a real editorial
				     state: unticking every severity is something an editor can do. */ }
				{ ! severities.length && (
					<p>{ __( 'No severities selected — this block will render nothing.', 'blame-the-tech-blocks' ) }</p>
				) }
				{ !! severities.length && undefined === incidents && <Spinner /> }
				{ !! severities.length && Array.isArray( incidents ) && 0 === incidents.length && (
					<p>{ __( 'No published incidents match.', 'blame-the-tech-blocks' ) }</p>
				) }
				{ !! severities.length && Array.isArray( incidents ) && incidents.length > 0 && (
					<ul>
						{ incidents.map( ( incident ) => (
							// REST returns `title` as { rendered }, HTML-encoded.
							<li key={ incident.id }>{ decodeEntities( incident.title.rendered ) }</li>
						) ) }
					</ul>
				) }
				<p>
					{ sprintf(
						/* translators: 1: item count, 2: comma-separated severity slugs. */
						__( 'Showing up to %1$d at severity %2$s', 'blame-the-tech-blocks' ),
						count,
						severities.join( ', ' ) || '—'
					) }
				</p>
			</div>
		</>
	);
}
```

> **This preview is not what `render.php` emits, and that is deliberate.** It shows the *data*
> the front end will use, styled like the editor, with no HTTP round trip per keystroke. A
> `<ServerSideRender />` here would show wp-admin a faithful preview of HTML no visitor will ever
> receive. Key Concept 5 has the full comparison.

### Step 4: Declare `btt/hobt-cta`

```json
{
  "$schema": "https://schemas.wp.org/trunk/block.json",
  "apiVersion": 3,
  "name": "btt/hobt-cta",
  "version": "0.1.0",
  "title": "HOBT CTA",
  "category": "btt",
  "description": "A call to action. Stores what the editor decided; the front end decides how it looks.",
  "keywords": ["cta", "button", "hobt", "demo"],
  "textdomain": "blame-the-tech-blocks",
  "attributes": {
    "label": {
      "type": "string",
      "default": "Get Demo"
    },
    "href": {
      "type": "string",
      "default": ""
    },
    "variant": {
      "type": "string",
      "default": "primary",
      "enum": ["primary", "outline"]
    },
    "leadSource": {
      "type": "string",
      "default": "hobt-cta-block",
      "enum": ["hobt-hero", "hobt-cta-block", "hobt-footer", "incident-sidebar"]
    }
  },
  "supports": {
    "className": true,
    "customClassName": false,
    "html": false,
    "anchor": false,
    "align": false,
    "color": false,
    "spacing": false,
    "typography": false,
    "reusable": false,
    "multiple": true
  },
  "editorScript": "file:./index.js",
  "editorStyle": "file:./index.css"
}
```

Four attributes and not one of them is a class name, a colour, a size or a pixel value. Read the
`supports` block the same way: **every presentation control is off**, because presentation is
`next-app`'s and a control that writes CSS into `post_content` for a front end that never reads
it is a control that lies. `className` is the one exception, for the same reason it was on
`btt/scapegoat-picker` in Lesson 13.3: `save()` emits nothing, so the class exists only on the
editor wrapper, where `editorStyle` needs it.

`enum` on `variant` and `leadSource` documents the closed sets. It is enforced by
`prepare_attributes_for_render()` on the PHP render path — which this block does not have — and
**not** by the JavaScript parser, so Module 14's component still narrows the value itself. Write
the `enum` anyway: it is the machine-readable form of the decision, and WPGraphQL Content Blocks
carries it into the schema.

### Step 5: Write `btt/hobt-cta`'s editor side and its null `save()`

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/hobt-cta/index.js
import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import Edit from './edit';
import save from './save';
import './editor.scss';

registerBlockType( metadata.name, { edit: Edit, save } );
```

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/hobt-cta/edit.js
import { __ } from '@wordpress/i18n';
import { InspectorControls, RichText, useBlockProps } from '@wordpress/block-editor';
import { PanelBody, SelectControl, TextControl } from '@wordpress/components';

// Kebab-case, matching wp_btt_leads.source and the ACF select convention.
// The GraphQL enum is SCREAMING_SNAKE and Module 16 maps between them, in one
// place, on the way into submitHobtLead. Key Concept 7.
const LEAD_SOURCES = [
	{ value: 'hobt-hero', label: __( 'HOBT hero', 'blame-the-tech-blocks' ) },
	{ value: 'hobt-cta-block', label: __( 'HOBT CTA block', 'blame-the-tech-blocks' ) },
	{ value: 'hobt-footer', label: __( 'HOBT footer', 'blame-the-tech-blocks' ) },
	{ value: 'incident-sidebar', label: __( 'Incident sidebar', 'blame-the-tech-blocks' ) },
];

const VARIANTS = [
	{ value: 'primary', label: __( 'Primary', 'blame-the-tech-blocks' ) },
	{ value: 'outline', label: __( 'Outline', 'blame-the-tech-blocks' ) },
];

export default function Edit( { attributes, setAttributes } ) {
	const { label, href, variant, leadSource } = attributes;
	const blockProps = useBlockProps( { 'data-variant': variant } );

	return (
		<>
			<InspectorControls>
				<PanelBody title={ __( 'Call to action', 'blame-the-tech-blocks' ) }>
					<TextControl
						__nextHasNoMarginBottom
						label={ __( 'Target', 'blame-the-tech-blocks' ) }
						value={ href }
						onChange={ ( value ) => setAttributes( { href: value } ) }
						placeholder="/hobt"
						help={ __(
							'A path on this site, or an absolute URL. Nothing validates it here; Module 16 validates on the server.',
							'blame-the-tech-blocks'
						) }
					/>
					<SelectControl
						__nextHasNoMarginBottom
						label={ __( 'Variant', 'blame-the-tech-blocks' ) }
						value={ variant }
						options={ VARIANTS }
						onChange={ ( value ) => setAttributes( { variant: value } ) }
						help={ __( 'What "primary" looks like is the front end’s decision.', 'blame-the-tech-blocks' ) }
					/>
					<SelectControl
						__nextHasNoMarginBottom
						label={ __( 'Lead source', 'blame-the-tech-blocks' ) }
						value={ leadSource }
						options={ LEAD_SOURCES }
						onChange={ ( value ) => setAttributes( { leadSource: value } ) }
						help={ __( 'Recorded against the lead. Kebab-case, matching wp_btt_leads.source.', 'blame-the-tech-blocks' ) }
					/>
				</PanelBody>
			</InspectorControls>

			{ /* The label is content, so it is inline — Lesson 13.3 Key Concept 4.
			     `allowedFormats: []` keeps it plain text: a button label with a
			     nested <strong> is a styling decision the front end owns. */ }
			<div { ...blockProps }>
				<RichText
					identifier="label"
					tagName="span"
					value={ label }
					onChange={ ( value ) => setAttributes( { label: value } ) }
					allowedFormats={ [] }
					placeholder={ __( 'Button label', 'blame-the-tech-blocks' ) }
				/>
			</div>
		</>
	);
}
```

```js
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/hobt-cta/save.js
//
// null, and NO render.php. This block is the second shape in Lesson 13.4 Key
// Concept 1: it contributes nothing to post_content but its comment, and no PHP
// runs for it at render time either. `the_content()` prints nothing for it.
//
// That is the right shape for a CTA in this architecture. The four attributes ARE
// the block, Lesson 14.4 renders them as a client island over the existing
// HobtCtaBand, and there is no markup for anyone to get wrong.
export default function save() {
	return null;
}
```

```scss
// wordpress-headless/wp-content/plugins/blame-the-tech-blocks/src/hobt-cta/editor.scss
//
// editorStyle → index.css. There is no saved markup, so a `style` sheet would
// have nothing to select. The two rules exist so the editor can tell the
// variants apart; the real button is a shadcn <Button> in next-app.

.wp-block-btt-hobt-cta {
	display: inline-block;
	padding: 0.5rem 1rem;
	border-radius: 0.375rem;
	font-weight: 600;

	&[data-variant='primary'] {
		background: #0f172a;
		color: #f8fafc;
	}

	&[data-variant='outline'] {
		border: 1px solid #0f172a;
		color: #0f172a;
	}
}
```

### Step 6: Build, insert, and watch PHP produce HTML nobody wants

```bash
cd wordpress-headless/wp-content/plugins/blame-the-tech-blocks
npm run build
```

Open the `block-scratchpad` draft and insert both blocks. Set the ticker to 3 items and untick
`S2 — Major`; watch the preview list change with no page reload and no round trip. Set the CTA's
target to `/hobt` and its variant to Outline. Save.

Then ask PHP for the rendered document. This is the only way to see `render.php`'s output at
all, and that fact is the lesson:

```bash
cd ../../../..
cd wordpress-headless
docker compose run --rm -T wpcli wp eval '
$p = get_page_by_path( "blog-01", OBJECT, "post" );
echo do_blocks( $p->post_content );' | grep -A6 'btt-incident-ticker'
```

**Verify §6:**

- [ ] You get a `<div class="wp-block-btt-incident-ticker btt-incident-ticker" data-severities="s1-catastrophic s2-major">`
      containing a `<ul>` with **five** `<li>` items, each an incident title in an `<a>`.
- [ ] `btt/hobt-cta` produced **nothing** in that output. Same `save: () => null`, no renderer,
      no HTML. Key Concept 1's two middle rows, side by side in one document.
- [ ] Now try to reach that HTML as a visitor would:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/blog/blog-01/
```

- [ ] **302.** The `btt-headless` theme redirects it to Next (Lesson 02.4). Nobody can load the
      page `render.php` renders into. Read Key Concept 6 again with that number in mind.
- [ ] And now the part that should bother you slightly:

```bash
curl -s http://localhost:3000/en/blog/blog-01 | grep -c 'btt-incident-ticker'
```

- [ ] **1 or more.** `content` from WPGraphQL is `the_content()`-filtered, so registering
      `render.php` just changed what your Next.js page renders **without you touching
      `next-app`**. That is not a feature; it is the `renderedHtml` coupling arriving through the
      back door, and removing it is precisely what Module 14 does when it drops `content` from
      `PostBySlug` in favour of `editorBlocks`.

### Step 7: Write both attribute tables, and the honest comparison

Append to `docs/content-model.md`:

```markdown
<!-- docs/content-model.md -->

### `btt/incident-ticker` — GraphQL type `BttIncidentTicker`

| Attribute | Type | Default | `source` | Lives in | Notes |
|---|---|---|---|---|---|
| `count` | `number` | `5` | — | the block comment | clamped to 1–20 in `render.php`; Module 14 clamps too |
| `severities` | `string[]` | `["s1-catastrophic","s2-major"]` | — | the block comment | subset of the four `severity` slugs. An empty array renders nothing |

**Dynamic**: `render: file:./render.php`, `save()` absent. The comment is the whole serialised
form. The selection logic is implemented twice — `render.php` and Lesson 14.4's
`IncidentTicker.tsx` — and only the second one is consumed by visitors. See Lesson 13.4 Key
Concept 6 for why the alternatives are worse.

### `btt/hobt-cta` — GraphQL type `BttHobtCta`

| Attribute | Type | Default | `source` | Lives in | Notes |
|---|---|---|---|---|---|
| `label` | `string` | `"Get Demo"` | — | the block comment | plain text |
| `href` | `string` | `""` | — | the block comment | path or absolute URL. **Not validated** |
| `variant` | `string` | `"primary"` | — | the block comment | `enum`: `primary` \| `outline`. Enforced on the PHP render path only |
| `leadSource` | `string` | `"hobt-cta-block"` | — | the block comment | `enum`, **kebab-case**: `hobt-hero` \| `hobt-cta-block` \| `hobt-footer` \| `incident-sidebar`. Maps to the `LeadSource` GraphQL enum (`HOBT_CTA_BLOCK`) in Module 16, in one place |

`save()` returns `null` and there is **no** renderer, so `the_content()` prints nothing for this
block. Attributes at their default are omitted from the comment — the seeded fixture is
`{"label":"Stop blaming the tech","href":"/hobt"}` with no `variant` and no `leadSource`.
```

And append the comparison the Quick Overview promised to `docs/architecture.md`:

```markdown
<!-- docs/architecture.md -->

## What a dynamic block costs, Classic versus headless (Lesson 13.4)

`btt/incident-ticker` queries incidents at render time. Same block, two architectures:

| | Classic WordPress | This build |
|---|---|---|
| Implementations of the selection logic | **one** — `render.php` | **two** — `render.php` and `IncidentTicker.tsx` |
| Who consumes `render.php` | every visitor | the WP-side preview route (Module 17) and `the_content()`. **No visitor** |
| Cost of a query per request | real, and the reason you add a transient | irrelevant — nobody requests the page |
| Where caching belongs | a WordPress transient, invalidated on `save_post` | Next's data cache, keyed by the tags in `src/lib/graphql/tags.ts` |
| Risk of the two drifting | n/a | **real and permanent** |
| What keeps drift bounded | n/a | both read the same two attributes, and the attribute contract is written down above |
| Cost of deleting `render.php` | the block stops working | the editor preview is unaffected; Module 17's preview shows a hole |

**Verdict: keep both.** The duplication is a known, bounded, documented cost, and every
alternative trades it for something worse — rendering `renderedHtml` breaches the front end's
one `dangerouslySetInnerHTML` boundary, a static block is wrong within a day, and dropping the
PHP breaks the preview path. Two implementations of a filter over two attributes is the cheapest
of four bad options, and it is only cheap because the attributes are a contract rather than an
accident.
```

---

## Verification

```bash
cd wordpress-headless/wp-content/plugins/blame-the-tech-blocks

# 1. Both blocks compiled, and the renderer was copied into the build
test -f build/incident-ticker/render.php && test -f build/hobt-cta/block.json && echo "both built"
# Expected: both built
#           render.php is copied by wp-scripts because block.json's `render` key
#           names it. It is NOT compiled — it is PHP, copied verbatim.

# 2. NEGATIVE — the ticker has no save at all. Not a save.js, not a `save` key.
test -f src/incident-ticker/save.js && echo "PRESENT" || echo "absent — correct"
# Expected: absent — correct
grep -c 'save' src/incident-ticker/block.json
# Expected: 0

# 3. NEGATIVE — no unescaped echo anywhere in render.php
grep -cE '<\?=|echo \$attributes|echo \$content' src/incident-ticker/render.php
# Expected: 0

# 4. NEGATIVE — and the wrapper is not double-escaped
grep -c 'esc_attr( get_block_wrapper_attributes' src/incident-ticker/render.php
# Expected: 0
grep -c 'echo get_block_wrapper_attributes' src/incident-ticker/render.php
# Expected: 1

# 5. NEGATIVE — ServerSideRender is nowhere in this plugin. Key Concept 5.
grep -rc 'ServerSideRender' src/ | grep -v ':0' | head
# Expected: no output

# 6. NEGATIVE — the CTA stores meaning, not presentation. No class, no colour,
#    no pixel value anywhere in its declaration.
grep -cE 'class=|"color"|px|rem|#[0-9a-f]{3}' src/hobt-cta/block.json
# Expected: 0
grep -c '"leadSource"' src/hobt-cta/block.json
# Expected: 1

# 7. The two closed sets are declared as enums
grep -c '"enum"' src/hobt-cta/block.json
# Expected: 2

# 8. The severity list is still shared, not copied
grep -c "from '../severities'" src/incident-ticker/edit.js
# Expected: 1
grep -rcE "'s1-catastrophic'" src/incident-ticker/edit.js
# Expected: 0
#           The slugs appear in src/severities.js and in render.php's allowlist,
#           and nowhere else. Two places, both deliberate: one per language.

cd ../../../..
cd wordpress-headless

# 9. PHP parses. wp-scripts does not lint PHP, so nothing else catches this.
docker compose exec wordpress php -l \
  /var/www/html/wp-content/plugins/blame-the-tech-blocks/build/incident-ticker/render.php
# Expected: No syntax errors detected in .../render.php

# 10. Five btt/ blocks registered now
docker compose run --rm -T wpcli wp eval '
$n = array_keys( WP_Block_Type_Registry::get_instance()->get_all_registered() );
echo count( array_filter( $n, static fn( $x ) => str_starts_with( $x, "btt/" ) ) ), PHP_EOL;'
# Expected: 5   (tech-verdict-card is Lesson 13.5's optional stretch)

# 11. THE DISTINCTION: exactly one btt/ block has a render callback
docker compose run --rm -T wpcli wp eval '
$reg = WP_Block_Type_Registry::get_instance()->get_all_registered();
foreach ( array( "btt/incident-ticker", "btt/hobt-cta", "btt/scapegoat-picker" ) as $name ) {
	$t = $reg[ $name ] ?? null;
	echo $name, " => ", ( $t && is_callable( $t->render_callback ) ) ? "DYNAMIC" : "no renderer", PHP_EOL;
}'
# Expected: btt/incident-ticker => DYNAMIC
#           btt/hobt-cta => no renderer
#           btt/scapegoat-picker => no renderer
#           Three blocks with no saved markup, one of which runs PHP. Key Concept 1.

# 12. Both new blocks serialise self-closing in the fixture
docker compose run --rm -T wpcli wp eval \
  'echo get_page_by_path( "blog-01", OBJECT, "post" )->post_content;' \
  | grep -cE 'wp:btt/(incident-ticker|hobt-cta) \{[^}]*\} /-->'
# Expected: 2

# 13. The renderer honours `count`: at most five items
docker compose run --rm -T wpcli wp eval '
$html = do_blocks( get_page_by_path( "blog-01", OBJECT, "post" )->post_content );
preg_match( "#<div[^>]*btt-incident-ticker.*?</div>#s", $html, $m );
echo substr_count( (string) ( $m[0] ?? "" ), "<li" ), PHP_EOL;'
# Expected: 5

# 14. ...and honours `severities`: every item it linked is S1 or S2
docker compose run --rm -T wpcli wp eval '
$html = do_blocks( get_page_by_path( "blog-01", OBJECT, "post" )->post_content );
preg_match_all( "#<a href=\"([^\"]+)\"#", $html, $m );
$n = 0; $bad = 0;
foreach ( $m[1] as $url ) {
	$id = url_to_postid( $url );
	if ( ! $id || "incident" !== get_post_type( $id ) ) { continue; }
	$n++;
	$slugs = wp_get_post_terms( $id, "severity", array( "fields" => "slugs" ) );
	if ( ! array_intersect( $slugs, array( "s1-catastrophic", "s2-major" ) ) ) { $bad++; }
}
echo "items=$n bad=$bad", PHP_EOL;'
# Expected: items=5 bad=0
#           bad>0 means the tax_query is not filtering — check `field => slug`.

# 15. NEGATIVE — nobody can load the page render.php renders into
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/blog/blog-01/
# Expected: 302
#           The btt-headless theme redirects it (Lesson 02.4). This is the number
#           to hold in your head while reading Key Concept 6.

# 16. NEGATIVE — the CTA renders nothing at all through the_content()
docker compose run --rm -T wpcli wp eval '
$html = do_blocks( get_page_by_path( "blog-01", OBJECT, "post" )->post_content );
echo substr_count( $html, "btt-hobt-cta" ), PHP_EOL;'
# Expected: 0

# 17. The ticker's PHP output DID reach the Next page, through `content`
cd ../next-app
curl -s http://localhost:3000/en/blog/blog-01 | grep -c 'btt-incident-ticker'
# Expected: 1 or more.
#           You changed no TypeScript and the front end changed anyway, because
#           `content` is the_content()-filtered on the WordPress side. This is the
#           renderedHtml coupling arriving through the back door. Module 14 drops
#           `content` from PostBySlug for exactly this reason.

# 18. NEGATIVE — and still nothing in next-app knows these blocks by name
grep -rc 'incident-ticker\|IncidentTicker\|hobt-cta' src/ 2>/dev/null | grep -v ':0' | head
# Expected: no output
```

Checks 15 and 17, in that order, are the module's most uncomfortable pair: the HTML `render.php`
produces is unreachable by any visitor, and it is on your front page anyway. Both are true, and
the second one is a bug you will fix in Module 14 rather than in Module 13.

## Control Questions

1. Three of this plugin's six blocks return `null` from `save()`. Exactly one is dynamic. State
   the property that separates them, and say what `the_content()` prints for each of the two
   non-dynamic ones.
2. `render.php` uses `'fields' => 'ids'` and then calls `_prime_post_caches()`. Explain what the
   query count would be without either line, with only the first, and with both — and say which
   of the three a naive reading of "ids is faster" produces.
3. `get_block_wrapper_attributes()` must not be wrapped in `esc_attr()`, while the
   `data-severities` attribute next to it must be. State the rule that decides which is which,
   in one sentence, and give the symptom of getting the first one wrong.
4. `leadSource` is stored as `hobt-cta-block` and travels to WordPress as `HOBT_CTA_BLOCK`. Name
   the layer that performs that mapping, and say what would go wrong if the block stored the
   `SCREAMING_SNAKE` form instead.
5. A colleague proposes deleting `render.php` on the grounds that no visitor ever sees its
   output. Give the two things that break, name the module that depends on each, and say what you
   would replace the renderer with if you did delete it.

## Learn More

- [Dynamic blocks](https://developer.wordpress.org/block-editor/how-to-guides/block-tutorial/creating-dynamic-blocks/) — the official walkthrough of `render`, `save: () => null` and `render_callback`, including the legacy form and why it is legacy
- [`block.json`'s `render` key](https://developer.wordpress.org/block-editor/reference-guides/block-api/block-metadata/#render) — the exact `file:./…` semantics and what is in scope inside the file
- [`get_block_wrapper_attributes()`](https://developer.wordpress.org/reference/functions/get_block_wrapper_attributes/) — read the source: it is short, and seeing it escape its own output settles Key Concept 4 permanently
- [`WP_Query` reference](https://developer.wordpress.org/reference/classes/wp_query/) — `tax_query`, `fields`, `no_found_rows` and the cache flags, with every accepted value
- [Taxonomy parameters in `WP_Query`](https://developer.wordpress.org/reference/classes/wp_query/#taxonomy-parameters) — `field => slug` versus `term_id`, and the `relation` key you will need the first time two taxonomies are involved
- [`WP_Block` and block context](https://developer.wordpress.org/block-editor/reference-guides/block-api/block-context/) — `providesContext`, `usesContext`, and how context reaches `render.php`
- [`ServerSideRender`](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-server-side-render/) — worth reading so that not using it is a decision rather than an omission
- [Transients API](https://developer.wordpress.org/apis/transients/) — the caching Key Concept 9 declines, and the invalidation problem it would hand you
- [WordPress REST API: taxonomy filtering](https://developer.wordpress.org/rest-api/reference/posts/#list-posts) — why the editor preview needs term IDs where `tax_query` accepts slugs
