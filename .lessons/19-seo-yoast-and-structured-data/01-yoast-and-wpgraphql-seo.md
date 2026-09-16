---
title: 'Yoast & WPGraphQL SEO'
module: 19
lesson: 1
teaches: [yoast-seo, wp-graphql-yoast-seo, graphql-fragments, editor-owned-metadata]
produces: ['next-app/src/graphql/fragments/SeoFields.graphql', 'wordpress-headless/schema.graphql']
requires: [10.2, 18.4]
---

# Lesson 19.1 — Yoast & WPGraphQL SEO

## Quick Overview

Yoast SEO is probably the plugin you have installed more times than any other, and in a
Classic build you never think about how its output reaches the page — `wp_head()` fires, Yoast
hooks it, and the `<head>` fills up. In a headless build that hook has no page to fill. The
plugin is still the right place for the data, because it is where the content team already
works and where the readability and snippet-preview tooling lives, but the data now has to
travel over GraphQL like everything else. `wp-graphql-yoast-seo` is the bridge: install it and
every content node in the schema grows an `seo` field carrying title, meta description,
canonical, the robots directives, the OpenGraph and Twitter sets, and a breadcrumb trail.

That field is large, and you will want it on incidents, reviews, posts, pages, scapegoat terms
and the front page — six or more queries. So you write it **once** as a GraphQL fragment and
spread it into every document. This lesson is where that fragment gets designed: which fields
you actually consume, which ones you deliberately ignore (Yoast's `schema.raw` is the big one
— Lesson 19.3 explains why you build JSON-LD yourself instead), and how to refresh
`schema.graphql` and regenerate types so the fragment is type-checked rather than hopeful.

By the end of this lesson you will have:

- Yoast SEO and `wp-graphql-yoast-seo` installed, pinned and activated in the WordPress stack
- Yoast's own front-end output (its sitemap and `wp_head` injection) configured for a headless
  site, so it is not competing with Next.js
- `next-app/src/graphql/fragments/SeoFields.graphql` — one fragment, spread into every content query
- A refreshed committed `wordpress-headless/schema.graphql` and regenerated `src/gql/` types
- A GraphiQL query that returns real `seo` values for a seeded incident, proving the editor's
  sidebar input is reachable from the front end

## Classic WP Analogy

| Classic WordPress | Headless with WPGraphQL Yoast SEO |
|---|---|
| `wp_head()` in `header.php` | Nothing. There is no PHP-rendered `<head>` to hook. |
| Yoast hooks `wp_head` and prints tags | Yoast stores the same data in post meta; the plugin exposes it as `seo { ... }` |
| `WPSEO_Frontend::get_title()` | `seo.title` on the content node |
| Yoast's XML sitemap at `/sitemap_index.xml` | Still generated, but on the wrong host — Lesson 19.4 decides what to do about it |
| The Yoast sidebar in the editor | **Unchanged.** This is the whole point. |

The analogy holds unusually well right up to one detail, and that detail matters: **in Classic
WordPress, Yoast renders the tags itself, so its output is authoritative. Here, Yoast only
supplies values — your code decides what becomes a tag.** Every transformation, every
fallback, every "the editor left this blank so use the excerpt" rule is now yours to write and
yours to get wrong. A Classic site with a blank Yoast description still emits a sensible
description because Yoast has internal templates; a headless site emits nothing at all unless
you wrote the fallback.

The second place it breaks is variables. Yoast's title templates (`%%title%% %%sep%%
%%sitename%%`) are resolved server-side, and `wp-graphql-yoast-seo` returns the **resolved**
string — which is good — but only for values Yoast itself computed. Anything Yoast would have
computed at render time from the current request (a paginated archive's "Page 2 of 7", for
instance) does not exist, because there is no request. Archive and pagination titles are yours
to build, and Lesson 19.2 does exactly that.

---

## Key Concepts

### 1. Yoast is the right *store* even when it renders nothing

Strip Yoast of its rendering job and ask what is left. The answer is most of the reason you
installed it.

| What Yoast gives you | Survives going headless? | Why it matters here |
|---|---|---|
| The sidebar an editor already knows | ✅ unchanged | The workflow is the product. Nobody has to learn a new place to type a title. |
| Snippet preview — the Google-shaped box | ✅ unchanged | It previews *your* fallbacks badly and its own values well. Key Concept 9. |
| Readability and keyphrase analysis | ✅ unchanged | Runs in the editor against `post_content`, which has not moved. |
| Per-post `noindex` / `nofollow` toggles | ✅ as **data** | Your code has to act on it. Key Concept 6 is how it arrives. |
| Title templates (`%%title%% %%sep%% %%sitename%%`) | ✅ **resolved server-side** | You receive the finished string, not the template. Key Concept 8. |
| Bulk editing titles and descriptions | ✅ unchanged | Still the fastest way to fix 200 blank descriptions. |
| `wp_head()` tag output | ❌ never runs | The `btt-headless` theme redirects every front-end request (Lesson 02.4). |
| Yoast's `@graph` JSON-LD | ❌ unusable | Built for the WordPress origin. Key Concept 5. |
| The XML sitemap | ❌ wrong host, wrong URLs | Lesson 19.4 decides what to do about it. |
| `redirect_canonical()`-style URL tidying | ❌ never runs | Which is why Lesson 19.4 has to own trailing slashes itself. |

Seven rows survive and four do not, and the four that do not are all *rendering*. That is the
shape of the whole module: **Yoast keeps the authoring surface, you take over the output.**

The alternative — an SCF field group with `seo_title`, `seo_description` and `seo_noindex` — is
genuinely cheaper to install and it is the wrong choice. You would be rebuilding the snippet
preview, the character counters, the bulk editor and the readability analysis, and you would be
asking a content team to abandon the one SEO tool they have muscle memory for. **The verdict:
Yoast, as a store.** The cost, stated plainly: a large, opinionated, frequently-updated plugin
stays in your dependency tree purely for its admin screens, and its front-end half is dead code
in your install forever.

### 2. `wp-graphql-yoast-seo` is a bridge, and you must introspect it rather than trust this page

The bridge plugin does one thing: it walks Yoast's meta and exposes it as GraphQL. It adds

- an **interface**, so one fragment can serve every content type;
- object types for the payload — `PostTypeSEO` for post types, `TaxonomySEO` for terms;
- an `seo` field on each type that participates.

```
   Yoast (post meta)              wp-graphql-yoast-seo             next-app
 ┌──────────────────────┐        ┌──────────────────────┐       ┌────────────────────┐
 │ _yoast_wpseo_title   │──────▶ │  seo: PostTypeSEO    │──────▶│ SeoFields fragment │
 │ _yoast_wpseo_metadesc│        │    title             │       │  ↓ codegen         │
 │ _yoast_wpseo_meta-   │        │    metaDesc          │       │ SeoFieldsFragment  │
 │   robots-noindex     │        │    canonical         │       │  ↓ 19.2            │
 │ …                    │        │    metaRobotsNoindex │       │ Metadata object    │
 └──────────────────────┘        └──────────────────────┘       └────────────────────┘
        authored by an editor           resolved per node             one tag per concern
```

That interface is **`ContentNode`**, WPGraphQL's own, and the bridge adds `seo` to it rather
than declaring one of its own. Measured on `wp-graphql-yoast-seo` 5.1.0: the plugin calls
`register_graphql_field('ContentNode', 'seo', …)` and `register_graphql_field('NodeWithTitle',
'seo', …)`, and has done since 4.18.0. There is no `NodeWithSeo`, in any release. That matters
because [appendix 05 §9](../appendix/05-graphql-cheatsheet.md#9-query-patterns-this-app-actually-uses)
and Lessons 05.3 and 10.5 all promised a `SeoFields` fragment, and `ContentNode` is its type
condition.

> **Introspect your own installation anyway.** Lesson 14.1 established this discipline for
> `NodeWithEditorBlocks` and it applies for exactly the same reason: the interface name is the
> fragment's **type condition**, and a fragment on a type that does not exist fails validation
> for the *whole document* — not just the file that spread it. Task §3 has you print the
> interface list on `Incident` from your own schema, so that the one thing you cannot check by
> reading is the one thing you measure. If it disagrees with this page, believe your schema.

### 3. A schema diff is a contract change, and this one is large

`npm run schema:pull` after installing these two plugins produces the biggest diff in the
course. Yoast's bridge registers a payload type per post type and per taxonomy, plus enums and
breadcrumb types. Several hundred added lines is normal and it is not a reason to skim.

Read it looking for exactly four things:

| Look for | Why | If it is missing |
|---|---|---|
| `seo: PostTypeSEO` on `interface ContentNode` | It is the fragment's type condition | The bridge plugin is inactive — Task §3 |
| `type PostTypeSEO` | The payload shape for posts, incidents, reviews, pages | Same |
| `type TaxonomySEO` | The payload shape for **terms** — a different type, which is why Key Concept 4 leaves scapegoats out | Same |
| `seo: PostTypeSEO` on `Incident`, `Post`, `TechReview`, `Page` | The field you are about to select | The post type was registered without Yoast support |

And **nothing else**. If the diff removed a type, renamed a field or changed a nullability
marker on something you already query, that is not a Yoast change — it is drift you have just
discovered, and it belongs in a separate commit with a separate explanation. Reading a schema
diff like a pull request is the habit Lesson 10.2 was arguing for; this is the lesson where it
pays for itself.

### 4. Designing the fragment: the fields you consume and the fields you refuse

`PostTypeSEO` is wide. Selecting all of it would compile, type-check and cost you a resolver
call per field per node on every request — the exact overfetch Lesson 10.5 taught you to audit
for. So the fragment is a **decision**, field by field.

| Yoast field | Verdict | Why |
|---|---|---|
| `title` | ✅ consume | The resolved title string. Lesson 19.2's primary source. |
| `metaDesc` | ✅ consume | The description. Blank about a third of the time on a real site. |
| `canonical` | ✅ consume | As a **signal**, not a value — Lesson 19.2 Key Concept 5 explains why. |
| `metaRobotsNoindex` | ✅ consume | A string. Key Concept 6. |
| `metaRobotsNofollow` | ✅ consume | Same shape, same trap. |
| `opengraphTitle` / `opengraphDescription` | ✅ consume | Editors legitimately want a different social headline. |
| `opengraphImage` | ✅ consume, via `MediaFields` | The editor's card beats a generated one. |
| `opengraphUrl` | ❌ refuse | Carries the WordPress host, and Lesson 19.2 computes `og:url` from the route anyway. |
| `schema { raw }` | ❌ refuse | Key Concept 5. This is the important one. |
| `fullHead` | ❌ refuse | A pre-rendered HTML string of Yoast's entire `<head>`. Same wrong-host problem as `schema.raw`, plus it would put raw HTML through React. |
| `breadcrumbs` | ❌ refuse | Built from WordPress's URL hierarchy, not your routes. Lesson 19.3 builds `BreadcrumbList` from the route. |
| `focuskw`, `cornerstone`, `readingTime` | ❌ refuse | Editorial metadata about the content, not statements to a crawler. |
| `metaKeywords` | ❌ refuse | No search engine has used it since 2009. |
| `twitterTitle` / `twitterDescription` / `twitterImage` | ❌ refuse **for now** | Next derives Twitter tags from `openGraph` when `twitter` is absent, so selecting them buys a third title for a fourth of the field set. Reversal condition: the moment an editor asks for a different X card than the OpenGraph one. |

That is eight fields in and twelve out, and the twelve-out list is the more valuable half of the
table because every one of them is a field someone will ask you to add.

Note the composition choice. `opengraphImage` spreads the existing `MediaFields` fragment rather
than re-selecting `sourceUrl`, because `next/image` needs `mediaDetails { width height }` to
reserve space (Lesson 14.5) and a social card needs real dimensions in `og:image:width`. One
media field set in the whole app, spread everywhere — the rule from Lesson 10.5 §2.

> **`SeoFields` spreads into documents, never into other fragments.** `IncidentDetailFields`
> spreads `IncidentCardFields` because a detail page is a superset of a card. SEO is
> orthogonal: it is not part of what a card renders, and putting it inside a card fragment
> would drag eight `<head>` fields into every list query. So the spread site is
> `incident(id: …) { ...IncidentDetailFields ...SeoFields }` — two independent field sets at
> the same level, exactly as Lesson 10.5 §1 said a flattened fragment behaves.

### 5. `seo.schema.raw` is never selected, and this is the module's load-bearing refusal

Yoast builds a genuinely good `@graph` — `WebSite`, `WebPage`, `Organization`, `BreadcrumbList`,
all cross-referenced by `@id`. The bridge exposes it as `seo.schema.raw`, a JSON string. Fetch
it, dump it into a `<script>`, done in one line.

Here is what that one line contains:

```
{ "@graph": [
    { "@type": "WebPage",
      "@id":  "http://localhost:8080/incidents/incident-01/",      ← wrong origin
      "url":  "http://localhost:8080/incidents/incident-01/",      ← wrong origin
      "isPartOf": { "@id": "http://localhost:8080/#website" },     ← wrong origin
      "breadcrumb": { "@id": "…/incidents/incident-01/#breadcrumb" },
      "potentialAction": [ { "target": "http://localhost:8080/?s={search_term_string}" } ] },
    …
] }
```

Every `@id`, every `url`, every breadcrumb `item`, and the site search action, all point at the
host WordPress thinks it lives on. `home_url()` is `http://localhost:8080` locally and your
Fly.io hostname in production (Module 24), and **neither is ever the address a reader typed.**

So the only way to use it is to string-replace hostnames inside a JSON blob you did not author,
on every request, forever. Enumerate what that commits you to:

- A regex over a JSON string, before parsing, on every page render.
- Silent breakage whenever Yoast adds a node type or changes an `@id` shape — a plugin update,
  not a code change of yours.
- No type safety. `raw` is `String`, so codegen gives you `string` and the compiler has nothing
  to check.
- `potentialAction` advertising a search endpoint on a host you do not want indexed at all.
- And you still cannot fix the *paths*: WordPress's `/incidents/incident-01/` is not your
  `/en/incidents/incident-01`. The locale prefix means the two URL spaces genuinely differ.

That last bullet is the one that closes the argument. Host-swapping cannot work when the
**path** is wrong too, and the path is wrong by design.

> **The verdict: build the graph yourself, from typed data.** Lesson 19.3 does it in about two
> hundred lines. The cost, stated plainly: those are two hundred lines you did not have before,
> and Yoast maintains its version for free. What you buy is that "why does this page claim to be
> an `Article` written by nobody?" is answerable by reading one function, and that every URL in
> your structured data is generated from the same `NEXT_PUBLIC_SITE_URL` as every other URL in
> the app.

### 6. `metaRobotsNoindex` is a string, and this is the likeliest bug in the module

The field is named like a boolean, it is toggled like a boolean in the sidebar, and it arrives
as a string.

| Sidebar state | `metaRobotsNoindex` value | `Boolean(value)` | Correct test |
|---|---|---|---|
| "Allow search engines to show this?" = **Yes** | `"index"` | `true` ⚠️ | `value === 'noindex'` → `false` ✅ |
| = **No** | `"noindex"` | `true` ⚠️ | `value === 'noindex'` → `true` ✅ |
| Field never touched | `null` or `"index"` | `false` / `true` | `value === 'noindex'` → `false` ✅ |

`Boolean('index')` is `true`. So the obvious mapping —

```graphql
# (illustration of the WRONG mental model, not a file)
# if (seo.metaRobotsNoindex) { robots.index = false }
```

— marks **every page on the site `noindex`**, including the pages the editor explicitly allowed.
It type-checks. It renders. Nothing in the app looks wrong. Six weeks later the site is gone
from search and the cause is a truthy string.

`metaRobotsNofollow` behaves identically, with `"nofollow"` and `"follow"`. Lesson 19.2 puts
both comparisons in one function with a unit test whose entire job is asserting that
`'index'` maps to `index: true`.

### 7. Configuring Yoast for a headless install — and what is already handled for you

Two of the three things you would normally have to disable are already dead, and knowing *why*
saves you from turning off something you need.

| Yoast front-end behaviour | Status in this install | Because |
|---|---|---|
| `wp_head()` tag output | **never runs** | `btt_headless_redirect()` fires on `template_redirect`, before any template loads (Lesson 02.4). No template, no `wp_head()`. |
| `redirect_canonical()`-ish URL tidying | **never runs** | Same reason. Which is why trailing slashes become *your* problem in Lesson 19.4. |
| The XML sitemap at `/sitemap_index.xml` | **reachable or not — go and find out** | Yoast renders it early, the theme redirects late, and which one wins depends on hook order in your version. Task §2 measures it instead of guessing. |

So there is no `remove_action` to write, and that is worth noticing: in a Classic build,
suppressing a plugin's `wp_head()` output means guessing a priority and hoping. Here the whole
hook never fires. **A redirect at `template_redirect` is a stronger guarantee than any number of
`remove_action` calls**, because it is one decision instead of one per plugin.

What you *do* configure is the part that changes the values you receive: the title separator and
the per-post-type title template. Task §2 sets the separator to an em dash, because Lesson
19.2's fallback title is `` `${node.title} — Blame The Tech` `` and **a Yoast-supplied title and
a code-supplied title that disagree about their separator are visibly two systems.** That is a
one-character setting with a real editorial cost if you skip it.

The XML sitemap decision itself is **deferred to Lesson 19.4**, deliberately. You cannot sensibly
decide whether to switch Yoast's sitemap off before you have decided who generates yours.

### 8. Title templates resolve server-side — which is good, and incomplete

`wp-graphql-yoast-seo` returns `seo.title` already resolved: `%%title%% %%sep%% %%sitename%%`
comes back as `DNS outage blamed on the intern — Blame The Tech`. You never see a template and
you never implement one. That is a real gift, and it has a sharp edge.

Yoast resolves **what Yoast computed for that node**. Anything it would have computed from *the
current request* does not exist, because in a headless read there is no request:

| Title Yoast would render Classically | Available over GraphQL? | Who owns it |
|---|---|---|
| A single post's title | ✅ resolved | Yoast |
| A page's title | ✅ resolved | Yoast |
| A term archive's title | ⚠️ on `TaxonomySEO`, per term | Yoast, if you query terms |
| A post-type archive's title (`/incidents`) | ❌ | **you** — there is no node to hang it on |
| `Page 2 of 7` | ❌ | **you** — pagination is a property of your route |
| A search-results title | ❌ | **you** |
| A 404 title | ❌ | **you** |

Four of those seven are yours, and all four are *route-level* rather than node-level. That is
the clean way to hold it in your head: **Yoast owns node titles; your router owns everything
else.** Lesson 19.2 builds the archive and pagination titles by hand for exactly this reason,
and it is not a workaround — a title that depends on `?page=3` could not have come from post
meta in any architecture.

### 9. The premise, stated once: Yoast supplies values, your code decides what becomes a tag

This is the sentence the whole module rests on, and it is worth being precise about the failure
mode it introduces.

```
CLASSIC                                  HEADLESS
─────────────────────────────────        ─────────────────────────────────
editor leaves description blank          editor leaves description blank
        │                                        │
Yoast's internal template fires          seo.metaDesc === null
        │                                        │
<meta name="description" content=        yoastToMetadata's FALLBACK fires
  "the excerpt, sensibly trimmed">               │
        │                                <meta name="description" content=
✅ a sensible tag, for free                "…"> — only because you wrote it
                                         ❌ NO TAG AT ALL if you did not
```

In Classic WordPress a blank field degrades to a template. Here it degrades to **nothing**.
There is no default; the absence of a fallback is not a milder version of a fallback, it is a
missing tag. Every row of the fallback table in Lesson 19.2 exists because a field was blank on
a real site, and the reason that table is frozen in the module README rather than invented per
route is that a fallback which differs between two routes is worse than no fallback: the editor
cannot predict what they will get.

The compensation, and it is a large one: **your fallbacks can be better than Yoast's**, because
they can use data Yoast never sees. Lesson 19.3's `Article` builder knows the incident's
severity term. Yoast does not.

### 10. Licence check, once, so nobody thinks the rule broke

Yoast SEO and `wp-graphql-yoast-seo` are both **GPL**. That is correct and required: WordPress
plugins are GPL by derivation, the whole `wordpress-headless/` tree is GPL, and the plugins you
install in Task §1 are no different from WPGraphQL or SCF in that respect.

The rule from Lesson 07.1 §9 — **`next-app` takes no GPL or AGPL dependency** — is about the
Next application, which is MIT, and this lesson adds **zero** npm packages. The bridge crosses
the boundary as JSON over HTTP, and a licence does not travel over a wire protocol. Both
statements are true at once, and it is worth saying out loud because "we installed two GPL
plugins in the SEO module" reads like a violation to anyone who only remembers half the rule.

---

## Task

### Step 1: Install and pin Yoast SEO and the WPGraphQL bridge

Two plugins, two different sources, and the second one has a name trap in it.

```bash
cd wordpress-headless

# 1. Yoast itself comes from wordpress.org. Read BOTH the current version and the
#    WordPress version it requires — `wp plugin install wordpress-seo` with no
#    --version pins you to "whatever was newest the day you ran it", which is not a
#    pin, and on this stack it does not even install.
curl -s https://api.wordpress.org/plugins/info/1.0/wordpress-seo.json \
  | jq -r '"latest \(.version)  requires WP \(.requires)"'
# Measured 2026-09: `latest 28.4  requires WP 6.9`, tested up to 7.1. This course
# pins WordPress 7.1, so the newest Yoast installs cleanly and the pin below is
# ordinary version discipline rather than a compatibility workaround.
#
# It has not always been so, and the failure is worth recognising: on the 6.8 this
# course pinned until recently, the same command produced
#   Warning: wordpress-seo: This plugin does not work with your version of
#            WordPress. Minimum WordPress requirement is 6.9
# and the fix was to pin 27.9, the last release whose header said 6.8. **Yoast's
# floor moves faster than most plugins'**, so read command 1's output rather than
# trusting this comment: if `requires` is above your core version, walk back until
# you find the last release that fits.

# 2. Install 28.4 — the version command 1 printed on the day this was written. Read
#    yours from command 1 and pin that; never install unpinned.
YOAST_VERSION=28.4
docker compose run --rm wpcli wp plugin install wordpress-seo \
  --version="$YOAST_VERSION" --activate
```

The bridge is `wp-graphql-yoast-seo`, and **its wordpress.org directory slug is not its name** —
it is published as `add-wpgraphql-seo`. Installing it by the name you know gives you either
nothing or something else, which is the same trap Lesson 14.1 flagged for
`wp-graphql-content-blocks`. Pin a GitHub release instead, so the artefact you install is the
artefact you chose:

```bash
# 3. List stable releases of the bridge and pick one.
curl -s https://api.github.com/repos/ashhitch/wp-graphql-yoast-seo/releases \
  | jq -r '.[] | select(.prerelease == false) | "\(.tag_name)  \(.assets[]?.browser_download_url // "no asset — use the tag zip")"' \
  | head -5

# 4. Pin it. Replace the tag with the one you chose — never `main`.
SEO_TAG=v5.1.0
docker compose run --rm wpcli wp plugin install \
  "https://github.com/ashhitch/wp-graphql-yoast-seo/archive/refs/tags/${SEO_TAG}.zip" \
  --activate

docker compose run --rm wpcli wp plugin list --status=active --fields=name,version,status --format=csv
```

**Verify §1:**

- [ ] Both plugins appear with `status=active` and a **concrete version number** — `28.4` and
      `5.1.0` if you pasted the pins. Write both into `docs/schema-notes.md`, *with the
      WordPress version beside them*: Yoast's floor moves, and "28.4, on core 7.1" is the note
      that saves the next upgrade — it is what tells you whether a refused install is a Yoast
      problem or a core one. Lesson 10.2 established the habit.
- [ ] `docker compose logs --tail=40 wordpress` shows no PHP fatal. The bridge requires both
      WPGraphQL and Yoast to be active; with either missing you get a notice on load, not a
      silent no-op.
- [ ] The install command for the bridge printed a **URL**, not a slug. If you typed
      `wp plugin install wp-graphql-yoast-seo` and it succeeded, check what you actually
      installed — that slug is not this plugin.
- [ ] `docker compose run --rm wpcli wp plugin list --status=active --field=name | wc -l` grew by
      exactly 2.

### Step 2: Configure Yoast for a headless install, and measure what is already handled

Three settings and one measurement. Start with the separator, because it is the one that shows
up in front of a reader.

```bash
# 1. What Yoast thinks its title settings are today.
docker compose run --rm wpcli wp option get wpseo_titles --format=json | jq '{separator, "title-incident", "title-post"}'

# 2. The separator becomes an em dash, matching the fallback title in Lesson 19.2
#    (`<title> — Blame The Tech`). A Yoast title and a code title that disagree about
#    their separator look like two systems, because they are.
docker compose run --rm wpcli wp option patch insert wpseo_titles separator sc-mdash

# 3. Read it back. `wp option patch` on a serialized array is quiet on success, so the
#    read-back IS the confirmation.
docker compose run --rm wpcli wp option get wpseo_titles --format=json | jq -r '.separator'
# Expected: sc-mdash
```

Now the measurement. Yoast's XML sitemap and the `btt-headless` theme redirect both want the
same request, and which of them wins depends on hook order in your versions. Find out rather
than assume — Lesson 19.4 needs the answer.

```bash
# 4. Who answers Yoast's sitemap URL on the WordPress origin?
curl -s -o /dev/null -w '%{http_code}  %{redirect_url}\n' http://localhost:8080/sitemap_index.xml
# Expected: EITHER 200 (Yoast rendered it before template_redirect fired)
#           OR     302 with a redirect_url on :3000 (the theme won).
#           Write down which. Both are fine today; Lesson 19.4 branches on it.

# 5. NEGATIVE, and the reason there is no `remove_action` in this lesson: a front-end
#    page request never reaches a template, so wp_head() never fires and Yoast never
#    prints a tag.
curl -s -o /dev/null -w '%{http_code}  %{redirect_url}\n' http://localhost:8080/incidents/incident-01/
# Expected: 302 and a redirect_url of http://localhost:3000/incidents/incident-01/
#           Lesson 02.4's btt_headless_redirect(). No template, no wp_head, no Yoast output.
```

**Verify §2:**

- [ ] The separator reads back as `sc-mdash`.
- [ ] Check 5 is a **302 to `:3000`**, not a 200 with HTML. A 200 here means the theme redirect
      is broken and Yoast *would* be printing tags — fix Lesson 02.4's theme before continuing,
      because the rest of the module assumes WordPress renders no pages.
- [ ] You wrote down check 4's answer. It is an input to Lesson 19.4, not trivia.
- [ ] Yoast's own settings screen at
      `http://localhost:8080/wp-admin/admin.php?page=wpseo_page_settings` loads without a fatal.
      Leave **Site features → XML sitemaps** exactly as you found it. Lesson 19.4 decides.

### Step 3: Introspect the schema — do not trust this lesson

The interface name is the fragment's type condition, and a wrong type condition fails validation
for every document in the project, not just the one that spread it. So print it from your own
installation.

```bash
# 1. Which interfaces does Incident actually implement? Do NOT grep for "seo" — the
#    bridge declares no type of its own, so no interface name contains it. The two
#    that will carry the field are core WPGraphQL interfaces.
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name: \"Incident\") { interfaces { name } } }"}' \
  | jq -r '.data.__type.interfaces[].name' | grep -xE 'ContentNode|NodeWithTitle'

# 2. `seo` on that interface, and its type. THIS is the check that the bridge is
#    active: ContentNode is core, so it exists either way — `seo` on it does not.
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name: \"ContentNode\") { kind fields { name type { name kind ofType { name } } } } }"}' \
  | jq '.data.__type | {kind, seo: [.fields[] | select(.name == "seo")]}'

# 3. The payload type, which is what the fragment selects FROM. This is also the
#    list you read Key Concept 4's table against.
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name: \"PostTypeSEO\") { fields { name } } }"}' \
  | jq -r '.data.__type.fields[].name'

# 4. Terms are a DIFFERENT payload type. Confirm it, because it is why scapegoats are
#    not in Step 6's spread list.
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name: \"Scapegoat\") { interfaces { name } } __type2: __type(name: \"TaxonomySEO\") { name kind } }"}' \
  | jq '.'
```

**Verify §3:**

- [ ] Command 1 prints **both** `ContentNode` and `NodeWithTitle`. `ContentNode` is the type
      condition in Step 5, because it is the one that means "a content node".
- [ ] Command 2 prints `INTERFACE` and one entry for `seo`, whose type is `PostTypeSEO`. An
      empty `seo` list means the bridge plugin is inactive — `ContentNode` itself is core.
- [ ] Command 3 lists at least `title`, `metaDesc`, `canonical`, `metaRobotsNoindex`,
      `metaRobotsNofollow`, `opengraphTitle`, `opengraphDescription`, `opengraphImage`,
      `schema` and `fullHead`. If `metaRobotsNofollow` is absent, note it — Lesson 19.2's
      mapper has a branch for that field and you would need to drop it.
- [ ] Command 4 shows that `TaxonomySEO` exists and is a **different type** from `PostTypeSEO`.
      An interface field cannot return two different object types, so a single fragment cannot
      cover both. Key Concept 4.

### Step 4: Refresh the committed schema and read the diff

```bash
cd ../next-app

# 1. Size before, so the diff has a denominator.
wc -l ../wordpress-headless/schema.graphql

# 2. Pull. This is the deliberate human action from Lesson 10.2 §7.
npm run schema:pull

wc -l ../wordpress-headless/schema.graphql

# 3. Read the diff for the four things Key Concept 3 lists — and nothing else.
git diff --stat ../wordpress-headless/schema.graphql
git diff ../wordpress-headless/schema.graphql | grep -E '^\+( +seo: PostTypeSEO|type PostTypeSEO|type TaxonomySEO)'
git diff ../wordpress-headless/schema.graphql | grep -cE '^\-' 
```

**Verify §4:**

- [ ] The file grew by several hundred lines. That is expected — Yoast registers a payload type
      per post type and per taxonomy.
- [ ] The third command prints all three of `seo: PostTypeSEO`, `type PostTypeSEO` and
      `type TaxonomySEO`. The first appears **twice** — once under `ContentNode`, once under
      `NodeWithTitle` — which is the diff's own proof of Key Concept 2.
- [ ] The fourth command — the count of **removed** lines — is `0`. A schema pull that deletes
      something is drift you have just discovered, not a Yoast change. Stop and find out what,
      before you commit.
- [ ] The schema you just refreshed is `wordpress-headless/schema.graphql`. WordPress owns the
      schema; `codegen.ts` reads across with a relative path (Lesson 10.2).

### Step 5: Write the `SeoFields` fragment

One new file, named for the fragment it contains, exactly as Lesson 10.5's convention requires.

```graphql
# next-app/src/graphql/fragments/SeoFields.graphql
# The <head> field set, for every content NODE. Promised by Lesson 05.3, kept commented
# out until now because a fragment on a type that does not exist fails validation for
# the whole project — not just this file.
#
# THE TYPE CONDITION CAME FROM THE INTROSPECTION IN TASK §3. `ContentNode` is core
# WPGraphQL; wp-graphql-yoast-seo adds `seo` to it (and to NodeWithTitle) rather than
# declaring an interface of its own. If your schema disagrees, this is the one line
# you change.
#
# Spread into DOCUMENTS, never into another fragment: SEO is orthogonal to what a card
# or a detail body renders, and nesting it inside IncidentCardFields would drag eight
# <head> fields into every list query. Lesson 10.5 Key Concepts 1 and 4.
#
# DELIBERATELY NOT SELECTED — the refusals are the design, so they are written down:
#   · schema { raw }  — Yoast's @graph, built for the WordPress origin. Lesson 19.1 KC5,
#                       and Lesson 19.3 builds the graph from typed data instead.
#   · fullHead        — a pre-rendered HTML string of Yoast's whole <head>. Same wrong
#                       host, plus it would put raw HTML through React.
#   · opengraphUrl    — carries the WordPress host; Lesson 19.2 computes og:url from
#                       the route.
#   · breadcrumbs     — WordPress's hierarchy, not your router's.
#   · focuskw, cornerstone, readingTime, metaKeywords, twitter* — Key Concept 4's table.
fragment SeoFields on ContentNode {
  seo {
    # Already RESOLVED from Yoast's title template — you receive the finished string.
    title
    metaDesc
    # A SIGNAL, not a value. Lesson 19.2 KC5: its host AND its path are WordPress's.
    canonical
    # STRINGS: 'noindex' / 'index' and 'nofollow' / 'follow'. NOT booleans.
    # Boolean('index') === true, which would noindex the entire site. KC6.
    metaRobotsNoindex
    metaRobotsNofollow
    opengraphTitle
    opengraphDescription
    # MediaFields, not a bare sourceUrl: next/image needs mediaDetails { width height }
    # (Lesson 14.5) and og:image:width needs the same numbers. One media field set,
    # spread everywhere — Lesson 10.5 §2.
    opengraphImage {
      ...MediaFields
    }
  }
}
```

**Verify §5:**

- [ ] The file is named `SeoFields.graphql` and contains `fragment SeoFields on …`. Lesson
      10.5's check 2 loops over `src/graphql/fragments/` asserting exactly that, and it now has
      six files to check instead of five.
- [ ] `grep -c 'raw\|fullHead\|breadcrumbs' src/graphql/fragments/SeoFields.graphql` is `0`.
- [ ] You wrote no `import`. Codegen concatenates every document into one namespace before
      validating, which is why `...MediaFields` resolves across files — and why fragment names
      are globally unique.

### Step 6: Spread it into the five documents that describe a node

These are **edits** to documents earlier lessons created, so none of them belongs in this
lesson's `produces:` — the convention from Lesson 15.4. Each edit is one line, at the top level
of the node selection, beside the existing fragment spread.

```graphql
# next-app/src/graphql/incidents.graphql (fragment) — ONE line added to IncidentBySlug.
# IncidentsList is UNTOUCHED: a list renders cards, and a card has no <head>.
query IncidentBySlug($slug: ID!) {
  incident(id: $slug, idType: SLUG) {
    ...IncidentDetailFields
    ...SeoFields
  }
}
```

```graphql
# next-app/src/graphql/posts.graphql (fragment) — ONE line added to PostBySlug,
# after the existing spread. PostsList is untouched, same reason.
    ...PostCardFields
    ...SeoFields
```

```graphql
# next-app/src/graphql/reviews.graphql (fragment) — ONE line added to ReviewBySlug,
# immediately after `...TechReviewCardFields`. The techReviewFields { … } selection
# below it does not move.
    ...TechReviewCardFields
    ...SeoFields
```

```graphql
# next-app/src/graphql/pages.graphql (fragment) — ONE line added to PageByUri.
# PageUris is untouched: generateStaticParams needs a uri, not a <head>.
    title
    uri
    ...EditorBlocks
    ...SeoFields
```

```graphql
# next-app/src/graphql/hobt.graphql (fragment) — ONE line added to HobtPromo,
# immediately after `...EditorBlocks`. The whole hobtPromo { … } selection below is
# untouched — commerce data, Lesson 14.4 Key Concept 8.
    ...EditorBlocks
    ...SeoFields
```

Five documents, and note the two that are **not** on the list:

| Document | Spread? | Why |
|---|---|---|
| `IncidentsList`, `PostsList`, `ReviewsList` | ❌ | An archive has no node, so there is nothing for `ContentNode` to describe. Lesson 19.2 builds archive titles by hand — Key Concept 8. |
| `ScapegoatLeaderboard` | ❌ | A term's payload is `TaxonomySEO`, a different object type, so `SeoFields` cannot spread there. Lesson 19.2 builds scapegoat metadata from `name` and `scapegoatProfile.tagline`. |

**Verify §6:**

- [ ] `grep -rc 'SeoFields' src/graphql/*.graphql` shows `1` for `incidents.graphql`,
      `posts.graphql`, `reviews.graphql`, `pages.graphql` and `hobt.graphql`, and `0` for
      `scapegoats.graphql` and `siteSettings.graphql`.
- [ ] No list operation gained the spread. `grep -A6 'query IncidentsList' src/graphql/incidents.graphql | grep -c SeoFields` is `0`.

### Step 7: Regenerate, type-check, commit `src/gql/` on its own

```bash
# 1. Generate. The new type is named after the fragment, as always.
npm run codegen

# 2. The generated fragment type exists and the documents that spread it widened.
grep -c 'SeoFieldsFragment' src/gql/graphql.ts
# Expected: 1 or more

# 3. Nothing broke. No component reads `seo` yet — Lesson 19.2 is the consumer — so a
#    clean type-check here is the expected result, not a weak one.
npm run type-check

# 4. Regenerate-and-diff, which is what CI runs.
npm run codegen:check

# 5. Two commits, from two directories, because they are two different kinds of change.
cd ../wordpress-headless && git add schema.graphql
git commit -m "chore(wp): refresh the committed schema for yoast seo"
cd ../next-app && git add src/gql/ src/graphql/
git commit -m "feat(next): SeoFields fragment on every content node"
```

**Verify §7:**

- [ ] `npm run codegen:check` is silent. Noise here means `src/gql/` was committed stale.
- [ ] `git log --oneline -2` shows the schema commit and the codegen commit as **separate**
      commits. A reviewer reading a several-hundred-line schema diff should not have to scroll
      past generated TypeScript to find it.
- [ ] `src/gql/` was never hand-edited. If you fixed a type by editing it, undo that and fix the
      document instead.

### Step 8: The round trip — type it in the sidebar, read it back over GraphQL

This is the lesson's proof, and it does not work unless you actually edit the sidebar. A query
that returns `null` for every field proves nothing.

```bash
# 1. BEFORE. Every seo field on incident-01, straight from WordPress.
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incident(id:\"incident-01\",idType:SLUG){ title seo{ title metaDesc canonical metaRobotsNoindex metaRobotsNofollow opengraphTitle } } }"}' \
  | jq '.data.incident'
# Expected: `title` is the resolved Yoast template — something ending "— Blame The Tech".
#           `metaDesc` is likely "" or null, because nobody has typed one. That empty
#           string is the whole reason Lesson 19.2 is about fallbacks.

# 2. Open the editor and type into the Yoast panel.
open 'http://localhost:8080/wp-admin/edit.php?post_type=incident'
```

In wp-admin, open `incident-01`, scroll to the **Yoast SEO** panel below the editor, and:

1. Set **SEO title** to `The intern did it — again`.
2. Set **Meta description** to `Ninety minutes of downtime, one DNS record, and a scapegoat who was on holiday.`
3. Open **Advanced** and leave "Allow search engines…" as **Yes** for now.
4. Click **Update**.

```bash
# 3. AFTER. The same query. This is the round trip.
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incident(id:\"incident-01\",idType:SLUG){ seo{ title metaDesc metaRobotsNoindex } } }"}' \
  | jq -r '.data.incident.seo | .title, .metaDesc, .metaRobotsNoindex'
# Expected, three lines:
#   The intern did it — again
#   Ninety minutes of downtime, one DNS record, and a scapegoat who was on holiday.
#   index
# Note the third line. It is the STRING "index", not `false`. Key Concept 6.
```

**Verify §8:**

- [ ] The `title` and `metaDesc` you typed come back verbatim. If `title` still shows the
      template output, you typed into the WordPress post title, not the Yoast SEO title — they
      are different fields and that is the point of the panel.
- [ ] `metaRobotsNoindex` is the string `index`. Say the sentence out loud once: *the field
      named "noindex" has the value "index"*. That is the shape Lesson 19.2's mapper compares
      against, and the reason its unit test exists.
- [ ] Nothing in `next-app` changed in this step. The editor's input reached the front end's
      data layer with no deploy, which is the module's whole claim.

---

## Verification

```bash
cd next-app

# 1. Both plugins are active, with concrete versions
docker compose -f ../wordpress-headless/docker-compose.yml run --rm wpcli \
  wp plugin list --status=active --fields=name,version --format=csv | grep -E 'wordpress-seo|yoast'
# Expected: two rows, each with a real version number. No "latest", no blank.

# 2. The FIELD is in the COMMITTED schema, not just in the live one. There is no
#    `interface NodeWithSeo` line to count — the bridge adds `seo` to two core
#    interfaces instead, so the field is what you grep for.
grep -cE '^ +seo: PostTypeSEO' ../wordpress-headless/schema.graphql
# Expected: 2 or more — ContentNode and NodeWithTitle both carry it, and every
#           concrete post type re-prints its interfaces' fields. A 0 means you
#           introspected a running server but never ran schema:pull, so codegen is
#           working from the pre-Yoast contract.
grep -cE '^type (PostTypeSEO|TaxonomySEO)' ../wordpress-headless/schema.graphql
# Expected: 2

# 3. The fragment file is named for its fragment — Lesson 10.5's rule, now six files
for f in src/graphql/fragments/*.graphql; do
  n=$(basename "$f" .graphql)
  grep -q "^fragment $n on " "$f" && echo "ok   $n" || echo "MISMATCH $n"
done
# Expected: six "ok" lines including SeoFields, and no MISMATCH

# 4. It type-checks, and the generated type is named after it
npm run codegen && npm run codegen:check
# Expected: no output from either
npm run type-check
# Expected: no output
grep -c 'SeoFieldsFragment' src/gql/graphql.ts
# Expected: 1 or more

# 5. Exactly the five node documents spread it, and no list operation does
grep -rc 'SeoFields' src/graphql/incidents.graphql src/graphql/posts.graphql \
  src/graphql/reviews.graphql src/graphql/pages.graphql src/graphql/hobt.graphql
# Expected: 1 for each of the five
grep -rc 'SeoFields' src/graphql/scapegoats.graphql src/graphql/siteSettings.graphql
# Expected: 0 for both — a term's payload is TaxonomySEO, and a settings object has no <head>

# 6. The editor's sidebar input is reachable from the front end's data layer.
#    This is the lesson's proof; it fails if you skipped Task §8.
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incident(id:\"incident-01\",idType:SLUG){ seo{ title metaDesc metaRobotsNoindex } } }"}' \
  | jq -r '.data.incident.seo.metaDesc'
# Expected: the sentence you typed in Task §8, verbatim. An empty string means the
#           Update did not save — reopen the post and check the Yoast panel.

# 7. The robots field is a STRING, and this is the assertion the module turns on
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incident(id:\"incident-01\",idType:SLUG){ seo{ metaRobotsNoindex } } }"}' \
  | jq -r '.data.incident.seo.metaRobotsNoindex | type, .'
# Expected, two lines:  string   index
#           NOT "boolean" and NOT "false". Boolean("index") is true, which would
#           noindex every page on the site. Key Concept 6.

# 8. A GraphQL failure still arrives as HTTP 200 with an errors array
curl -s -o /tmp/seo-bad.json -w 'HTTP %{http_code}\n' -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ incident(id:\"incident-01\",idType:SLUG){ seo{ notAField } } }"}'
# Expected: HTTP 200
jq -r '.errors[0].message' /tmp/seo-bad.json
# Expected: a message about "notAField" on type PostTypeSEO. Read `.errors`, never the
#           status code — Lesson 10.4.

# 9. NEGATIVE — the committed schema lives on the WordPress side, and there is no
#    second copy here. Both halves of that matter: codegen.ts reads across.
test -f ../wordpress-headless/schema.graphql && echo 'wordpress-headless: present'
# Expected: wordpress-headless: present
ls schema.graphql 2>/dev/null ; echo "exit=$?"
# Expected: no such file, exit=1. A copy inside this directory is the one codegen.ts
#           does NOT read, so it would drift silently and forever.

# 10. NEGATIVE — Yoast's @graph is selected NOWHERE. Scoped so the count means
#     something: `schema` appears in prose comments, `schema {` is a selection.
grep -rn 'schema *{' src/graphql/ ; echo "exit=$?"
# Expected: no matches, exit=1
grep -rn 'fullHead\|breadcrumbs\|opengraphUrl' src/graphql/ ; echo "exit=$?"
# Expected: no matches, exit=1 — every refusal in Key Concept 4 still holds

# 11. NEGATIVE — a SeoFields spread on a type that does not implement the interface
#     fails validation for the WHOLE document. Add the mistake, watch codegen refuse,
#     delete it. The pattern is Lesson 10.5 check 7's.
cat > src/graphql/_wrong.graphql <<'PROBE'
# next-app/src/graphql/_wrong.graphql — TEMPORARY. Deleted three lines below.
query WrongSeoSpread {
  siteSettings {
    ...SeoFields
  }
}
PROBE
npm run codegen 2>&1 | grep -c 'cannot be spread here\|can never be of type'
# Expected: 1 or more. Message shape:
#   Fragment "SeoFields" cannot be spread here as objects of type "SiteSettings"
#   can never be of type "ContentNode".
rm src/graphql/_wrong.graphql
npm run codegen && npm run codegen:check
# Expected: no output — clean again

# 12. NEGATIVE — WordPress still renders no front-end page, so Yoast still prints no
#     tag. A 200 with HTML here would mean Yoast IS emitting a competing <head>.
curl -s -o /dev/null -w '%{http_code}  %{redirect_url}\n' \
  http://localhost:8080/incidents/incident-01/
# Expected: 302 and a redirect_url on :3000 — Lesson 02.4's template_redirect
curl -s http://localhost:3000/en/incidents/incident-01 | grep -c 'yoast\|wpseo'
# Expected: 0. Not one Yoast marker in the served HTML. Nothing consumes `seo` yet —
#           Lesson 19.2 is the consumer — so the page is unchanged, on purpose.

# 13. NEGATIVE — the browser still never reaches /graphql. Two plugins richer, the
#     architecture is unchanged.
grep -rn "'use client'" src/lib/graphql/ ; echo "exit=$?"
# Expected: no matches, exit=1
curl -s http://localhost:3000/en/incidents/incident-01 | grep -c 'localhost:8080'
# Expected: 0 — no WordPress origin anywhere in the served markup

# 14. Both commits exist, from the right directories, and nothing is stale
git -C ../wordpress-headless status --short schema.graphql
# Expected: no output — committed
git status --short src/gql/ src/graphql/
# Expected: no output — committed
git log --oneline -2
# Expected: the codegen commit and the schema commit, separately
```

If check 11 prints `0`, read the codegen output before deciding the check is wrong: an "Unknown
fragment" error instead means `_wrong.graphql` was picked up but the fragments directory was not,
which points at the `documents` glob in `codegen.ts` rather than at anything in this lesson.

## Control Questions

1. Yoast's `wp_head()` output never appears anywhere in this application, and yet the course
   keeps Yoast. List four capabilities that survive the move to headless, and then name the one
   Classic behaviour whose loss costs you the most code in Lesson 19.2.
2. `SeoFields` is declared `on ContentNode` rather than on `Incident`. Say what would fail, at
   what moment, if the installed plugin put `seo` on the concrete types only — and be specific
   about what happens to the *other* documents in `src/graphql/` when it does.
3. `metaRobotsNoindex` comes back as `"index"` for a page the editor has explicitly allowed into
   search. Write the wrong one-line mapping, say exactly what it does to the site, and explain
   why neither `npm run type-check` nor a browser would tell you.
4. `seo.schema.raw` is a complete, valid, cross-referenced JSON-LD graph that Yoast maintains for
   free. Give the two independent reasons this course refuses it, and say which of the two
   survives even if you were willing to string-replace hostnames on every request.
5. `SeoFields` is spread into `IncidentBySlug` but not into `IncidentsList`, and not into
   `ScapegoatLeaderboard`. Give the reason for each omission — they are different reasons — and
   say who builds the `<head>` for `/en/incidents` and for `/en/scapegoats/the-intern` instead.

## Learn More

- [WPGraphQL Yoast SEO (`wp-graphql-yoast-seo`)](https://github.com/ashhitch/wp-graphql-yoast-seo)
  — the bridge plugin's own README, which is the only authoritative list of what its version of
  `PostTypeSEO` and `TaxonomySEO` actually expose; read it against Key Concept 4's table
- [Yoast SEO developer documentation](https://developer.yoast.com/) — start with the "Yoast SEO
  and headless" notes, then the metadata API, for what the plugin considers a supported
  integration point rather than an implementation detail you are reading out of the database
- [Yoast: variables in titles and descriptions](https://yoast.com/help/list-available-snippet-variables/)
  — the full `%%…%%` list, so you can tell at a glance whether a title you received was resolved
  from a template or typed by hand
- [Yoast: the schema `@graph` and its pieces](https://developer.yoast.com/features/schema/api/)
  — worth reading precisely because you are refusing it: it is the shape Lesson 19.3 has to
  reproduce, and the `@id` conventions are worth copying even when the data is not
- [WPGraphQL — Interfaces](https://www.wpgraphql.com/docs/interfaces) — why adding `seo` to
  `ContentNode` rather than to each type is what buys you a single fragment
- [GraphQL specification — fragment spread type conditions](https://spec.graphql.org/October2021/#sec-Fragment-spread-is-possible)
  — the formal rule behind "cannot be spread here", which is the error Verification check 11
  deliberately triggers
- [WP-CLI `plugin install`](https://developer.wordpress.org/cli/commands/plugin/install/) — the
  `--version` flag and ZIP-URL form used in Task §1, and why a bare slug is not a pin
- [WP-CLI `option patch`](https://developer.wordpress.org/cli/commands/option/patch/) — how to
  change one key inside a serialized option array, which is the only sane way to touch
  `wpseo_titles` from a script
- [Google Search Central — meta tags Google understands](https://developers.google.com/search/docs/crawling-indexing/special-tags)
  — the authoritative list of what `robots`, `description` and the rest actually do, which is a
  useful corrective to any plugin's settings screen
- [Google Search Central — `noindex`](https://developers.google.com/search/docs/crawling-indexing/block-indexing)
  — read this once, carefully, because Key Concept 6's bug is the most expensive mistake in the
  whole module and this page describes exactly what it costs you
