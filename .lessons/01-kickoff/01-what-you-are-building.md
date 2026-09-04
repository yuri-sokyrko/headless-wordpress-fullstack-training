---
title: "What You're Building"
module: 1
lesson: 1
teaches: [headless-cms-model, blame-the-tech-domain, build-arc]
produces: []
requires: []
---

# Lesson 01.1 — What You're Building

## Quick Overview

**Blame The Tech** is a satirical Dev Incident Scapegoat Portal: developers file production
incidents and officially pin the blame on an inanimate object, a framework, or solar flares.
Underneath the joke it is a deliberately ordinary content application — a moderated
user-generated post type, three taxonomies, a blog, an editorially-composed marketing landing
page, and a lead-capture funnel. Every feature exists because it forces you through a
technique that headless WordPress builds get wrong in the real world: authenticated
mutations, custom capabilities, term counts versus meta counts, blocks as structured data,
cache invalidation on publish, and a PII table that is not a post type.

This lesson maps the product onto the course. You will read the route table, see which content
type backs each route, and see which module delivers it. The point is calibration: by the end
of Module 07 you will not have a website at all, only a typed API — and that is on purpose,
because the data you fetch in Module 09 needs to be data you modelled yourself. The first
visitable page arrives in Module 09, the first thing that looks like a product in Module 11,
and the complete submit-moderate-publish loop in Module 16.

By the end of this lesson you will have:

- A read-through of [PROJECT.md](../PROJECT.md) and the route table it opens with
- A mapping from each of the seven public sections to the content type that backs it
- The build arc in your head: what the app can do after Modules 07, 09, 14, 16 and 24
- A written answer to "why is `scapegoat` a taxonomy and not a post type?" — the first
  modelling decision in [appendix 03 §2](../appendix/03-content-model-reference.md#2-taxonomies)
- A clear expectation that Modules 01–07 produce no front end whatsoever

## Classic WP Analogy

Think about how you would scope this in Classic WordPress. You would reach for a plugin
registering `incident` and `tech_review`, three taxonomies, an ACF field group per type, a
custom role for public submitters, and a child theme with `archive-incident.php`,
`single-incident.php`, `taxonomy-scapegoat.php` and a `page-hobt.php` template. You would wire
the submission form with `admin_post_` and a nonce, and invalidate caches by clearing the
object cache. That scoping instinct is correct and it transfers directly: **the entire
server-side half of this course is that plugin.** Modules 03 through 06 build exactly what you
just imagined, with `show_in_graphql` added to every registration.

What changes is the second half of the sentence. The theme templates do not exist. There is no
`archive-incident.php`, no `the_loop()`, no `get_header()`. The `btt-headless` theme you build
in Module 02 has one job — redirect any front-end hit to Next.js — and after that WordPress
never renders a page a user sees. Your template hierarchy knowledge becomes *routing* knowledge
in Module 09, where `app/[locale]/incidents/[slug]/page.tsx` is the same idea in a different
language.

**Where the analogy breaks down:** in Classic WordPress the theme is a *consumer* of the same
process that produced the data, so it can call any function it likes — `get_field()`,
`get_the_terms()`, `wp_nav_menu()`, a stray `global $post`. Headless has no such privilege. The
front end can only see fields somebody explicitly published into the schema, and anything you
forget to expose is simply not there. That single constraint is why the content model gets its
own contract document and why Modules 03–06 come before any JavaScript at all.

---

## Key Concepts

### 1. Seven sections, and the technique each one forces

Every route in Blame The Tech exists because it makes a specific technique unavoidable. Read
the last column as the real specification — the satire is scaffolding.

| Section | Route | Backed by | Authored by | The technique it forces |
|---|---|---|---|---|
| Incidents index | `/[locale]/incidents` | `incident` post type + 3 taxonomies | public users, moderated | Faceted lists, cursor pagination, a client filter island |
| Incident detail | `/[locale]/incidents/[slug]` | `incident` + `Incident Details` ACF group | — | Blocks as data, ISR, tag-based revalidation |
| Scapegoats | `/[locale]/scapegoats` | `scapegoat` taxonomy + `Scapegoat Profile` | editors | Taxonomy modelling, term counts, ACF **term** field groups |
| Blog | `/[locale]/blog` | core `post`, rewrite base `blog` | editors | Custom Gutenberg blocks, core block mapping |
| Tech reviews | `/[locale]/reviews` | `tech_review` + `Tech Review Fields` | editors only | ACF repeaters, ratings, JSON-LD `Review` |
| HOBT promo | `/[locale]/hobt` | core `page` + `HOBT Promo` + blocks | editors, block-composed | Lead capture into a non-post table, SSG |
| Auth | `/[locale]/login`, `/register`, `/account` | `wp_users` + a custom role | — | JWT in httpOnly cookies, middleware guards |

The exact names in the third column are fixed by
[appendix 03](../appendix/03-content-model-reference.md) and are not yours to change. That is
the point of a contract: you will type `downtime_minutes` in PHP in Module 03, query
`downtimeMinutes` in Module 05, and read a generated TypeScript field for it in Module 10. One
source of truth, three places it surfaces.

> **Nothing on this list is decoration.** If you were tempted to skip the blog because "it is
> just posts", note that the blog is the only content in the whole application that exercises
> every custom block — which makes it the only content that can prove the Module 14
> `BlockRenderer` is complete. Each section is load-bearing for a later module, and §8 of this
> lesson names which.

### 2. Incidents: moderation that is structural, not procedural

The core loop is three actors and one status transition.

```
public user                WordPress                     editor
    │                          │                            │
    │ submit form (Module 16)  │                            │
    ├─ Server Action ─────────▶│                            │
    │  Zod validated           │ createIncident mutation    │
    │                          │  · requires a user JWT     │
    │                          │  · requires create_incidents
    │                          │  · FORCES post_status =    │
    │                          │    'pending'               │
    │                          │  · FORCES post_author =    │
    │                          │    get_current_user_id()   │
    │                          │  · IGNORES is_verified     │
    │                          │                            │
    │◀── "thanks, pending" ────┤                            │
    │                          │   moderation queue ───────▶│
    │                          │◀──── publish ──────────────┤
    │                          │                            │
    │                          ├─ signed webhook ──▶ Next revalidateTag()
    │                          │   (Module 18)         │
    │◀─────────────────────── live page ────────────────────┘
```

The interesting part is not the form. It is that `incident_reporter` — the custom role public
signups receive — **does not have `publish_incidents` at all**. See
[appendix 03 §6](../appendix/03-content-model-reference.md#6-roles-and-capabilities) for the
full capability matrix.

| Approach | How publishing is prevented | What defeats it |
|---|---|---|
| Procedural | `if ( $status === 'publish' ) { wp_die(); }` somewhere in a mutation resolver | A second code path. A REST endpoint. A future you who forgets. A plugin that calls `wp_update_post()` |
| **Structural (this course)** | The capability does not exist for the role, so WordPress's own authorisation layer refuses | Nothing short of granting the capability — and that is a one-line diff a reviewer can see |

**The verdict:** withhold the capability. A check you have to remember to write is a check you
will eventually forget to write, and there is no code path by which a public user publishes an
incident when the capability is absent.

> **`is_verified` is the field that teaches trust boundaries.** It is in the GraphQL schema, an
> editor can set it in wp-admin, and `createIncident` silently discards any client-supplied
> value. A field being present in a GraphQL input type is not permission to set it. You will
> write that discard in Module 06 and test the negative in Module 23.

**The cost, stated plainly:** every incident needs a human to publish it. There is no
auto-publish path, no "trusted reporter" tier, and an empty moderation queue means an empty
site. That is the correct trade for a course — it is the shape real UGC moderation takes — but
it means the seeded data in Module 04 exists partly so you are not moderating forty fixtures by
hand.

### 3. Scapegoats: why the leaderboard is one indexed read

"This incident blames that thing" is classification, so `scapegoat` is a taxonomy —
see [appendix 03 §2](../appendix/03-content-model-reference.md#2-taxonomies). The payoff is
concrete and measurable, and you will measure it yourself in Lesson 02.3.

```
AS A TAXONOMY                             AS POST META
─────────────────────────────────         ─────────────────────────────────
wp_terms             (name, slug)         wp_postmeta
wp_term_taxonomy     (count)  ◀── WP      (post_id, 'scapegoat', 'dns')
   maintains this column for you             meta_value has NO index
wp_term_relationships (object_id)

leaderboard =                             leaderboard =
  SELECT name, count                        SELECT meta_value, COUNT(*)
  FROM wp_term_taxonomy                     FROM wp_postmeta
  JOIN wp_terms USING (term_id)             WHERE meta_key = 'scapegoat'
  ORDER BY count DESC                       GROUP BY meta_value
                                            ORDER BY 2 DESC
  → one indexed read                        → full scan of every row for
    of a denormalised counter                 that key, then a sort
```

You also get term archives, term URLs, `tax_query` joins and `get_terms()` ordering for free,
none of which exist for a meta key.

**The cost, stated plainly:** a term has no revisions and no rich editorial body. If a scapegoat
ever needed long-form content with revision history, this decision would have to be revisited.
The `Scapegoat Profile` ACF **term** field group —
[appendix 03 §4.2](../appendix/03-content-model-reference.md#42-scapegoat-profile) — covers
everything this application actually needs (`avatar`, `tagline`, `defensiveness`,
`official_excuse`), and that is the honest boundary of the decision. Model the relationship you
have, not the one you might want.

`severity` is a taxonomy for the same reason with an extra constraint: it is a **closed set** of
four terms with the term UI locked to radio buttons, so no editor invents "S5 kinda bad".
`downtime_minutes` and `estimated_cost_usd`, being numeric ranges, **cannot** be taxonomies and
stay in post meta — which is exactly the performance trap Lesson 02.3 makes you look at with
`EXPLAIN`.

### 4. The blog exists to make the block renderer testable

Ten satirical posts on core `post`, with the rewrite base moved from `/` to `blog`. Two of those
ten use **every** custom block the course builds. That is not a content decision, it is a test
fixture decision.

| Without the blog | With the blog |
|---|---|
| Custom blocks are only ever seen on `/hobt`, one page | Two posts exercise all six blocks plus the core blocks |
| `BlockRenderer` coverage is whatever `/hobt` happens to use | An E2E spec can assert every registered block renders |
| An unregistered block type is discovered in production | It is discovered by `<UnknownBlock>` rendering a red box in development |

The blog is also where core block mapping gets exercised — `core/paragraph`, `core/heading`,
`core/image`, `core/list`, `core/quote`. Custom blocks are the interesting half of Module 14;
core blocks are the half that is actually most of the work.

### 5. Tech reviews: the repeater that teaches you about generated types

`tech_review` is editors-only, which makes it the simplest content type in the app and lets it
carry a different lesson: **ACF repeaters do not become arrays of strings.**

A `pros` repeater with a single `item` text sub-field looks like a `string[]` in the wp-admin UI.
It is not:

| What you expect | What codegen actually produces |
|---|---|
| `pros: string[]` | `pros: Array<{ item?: string \| null }> \| null` |
| One field | A generated object list type, `TechReviewFieldsPros` |
| `review.pros.map(p => p)` | `review.pros?.map(p => p?.item)` |

This is the single most common "why is my generated type `any`?" moment in a headless WordPress
build, and it is much cheaper to meet it in Lesson 04.2 on a satirical review of a fictional
company than in Module 14 on a page you are trying to ship. The four `rating_*` fields also give
Module 19 something real to emit as JSON-LD `Review` structured data.

### 6. The HOBT funnel: two buttons, two entirely different mechanisms

**HOBT** — *How To Omit Blaming Tech* — is the fictional course the site upsells. Its landing
page at `/[locale]/hobt` is a core `page` with the `HOBT Promo` ACF group and a body composed
**entirely from blocks**. Marketing reorders the page in wp-admin and it changes on the live site
without a deploy. That is the whole argument for blocks-as-data, and it is why Module 14 is one
of the two conceptual jumps in the course.

The two calls to action look like siblings and share nothing:

| | "Get Demo" | "Start Now" |
|---|---|---|
| What it is | A dialog with a validated form | A link |
| Client or server | `'use client'` island — Radix dialog, react-hook-form, Zod | Plain `<a href>`, zero JavaScript |
| Where the data goes | `submitHobtLead` mutation → the `wp_btt_leads` **custom table** | Nowhere. It is `startNowUrl`, an external checkout |
| Credential used | `X-BTT-App-Token` — server-to-server, no logged-in user | none |
| Spam defence | Honeypot, form-render timing, Turnstile, rate limit | not applicable |
| Module | 16 | 11 (inert), 14 (block-driven) |

Leads go into `wp_btt_leads`, created with `dbDelta()` — **not** a post type. The reasoning is in
[appendix 03 §5](../appendix/03-content-model-reference.md#5-the-one-thing-that-is-not-a-post-wp_btt_leads),
and the headline is PII isolation: a CPT is one misconfigured `show_in_rest` or
`show_in_graphql` away from publishing every lead, while a custom table is invisible to
WordPress's content APIs by construction. It is also the one place in the course you write real
SQL with `$wpdb->prepare()`.

> **`seats_left` is a deliberate trap.** An urgency badge that says "only 12 seats left" is a
> field on a page you would otherwise cache for an hour. It forces `/hobt` onto a shorter
> `revalidate` than every other route, which is how Module 18 stops being abstract: caching
> policy is per-route because content freshness is per-field.

### 7. The screen inventory

Four screens carry the application. Read the annotations — `'use client'` marks the only parts
that ship JavaScript, and there are fewer of them than your jQuery instincts expect.

The incidents index. The facet rail is the one client island; the cards are server-rendered:

```
┌────────────────────────────────────────────────────────────────────┐
│ BLAME THE TECH        Incidents  Scapegoats  Blog  Reviews  HOBT   │
├──────────────────┬─────────────────────────────────────────────────┤
│ FILTERS          │  Incidents                          40 results  │
│ 'use client'     │                                                 │
│                  │  ┌─────────────────────────────────────────┐    │
│ Severity         │  │ S1  DNS ate the deploy          blame 87│    │
│  ( ) S1          │  │ DNS · 240 min · production              │    │
│  (o) S2          │  └─────────────────────────────────────────┘    │
│  ( ) S3  ( ) S4  │                                                 │
│                  │  ┌─────────────────────────────────────────┐    │
│ Scapegoat        │  │ S2  Cache served 2019           blame 64│    │
│  [x] DNS         │  │ The Cache · 45 min · staging            │    │
│  [ ] The Intern  │  └─────────────────────────────────────────┘    │
│  [ ] Kubernetes  │                                                 │
│                  │  [ 1 ] [ 2 ] [ 3 ]  ->   cursor pagination      │
│ Sort             │                                                 │
│  [ newest    v ] │                                                 │
└──────────────────┴─────────────────────────────────────────────────┘
```

The incident detail page. The body is `editorBlocks` mapped to React components; the sidebar is
ACF fields read straight off the query:

```
┌────────────────────────────────────────────────────────────────────┐
│ BLAME THE TECH        Incidents  Scapegoats  Blog  Reviews  HOBT   │
├────────────────────────────────────────────┬───────────────────────┤
│                                            │                       │
│  S1 — CATASTROPHIC          blameScore 87  │ INCIDENT DETAILS      │
│                                            │                       │
│  DNS ate the deploy                        │ Occurred   12 Mar 26  │
│  reported by @ada · 12 Mar 2026 · verified │ Downtime   240 min    │
│                                            │ Cost       $48,000    │
│  ┌──────────────────────────────────────┐  │ Env        PRODUCTION │
│  │  editorBlocks -> <BlockRenderer/>    │  │ Status     BLAMED     │
│  │                                      │  │ Confidence 73%        │
│  │  core/paragraph  core/heading        │  │                       │
│  │  core/image      core/list           │  │ Scapegoat             │
│  │  btt/incident-callout                │  │  [ DNS ]              │
│  │  btt/blame-quote                     │  │                       │
│  └──────────────────────────────────────┘  │ Stack                 │
│                                            │  [ AWS ] [ Docker ]   │
│  Stack trace  (escaped, never innerHTML)   │                       │
│  ┌──────────────────────────────────────┐  │ ─────────────────     │
│  │ TypeError: undefined is not a ...    │  │ Get Demo              │
│  └──────────────────────────────────────┘  │ 'use client'          │
│                                            │                       │
└────────────────────────────────────────────┴───────────────────────┘
```

The scapegoat leaderboard. Entirely server-rendered, and the numbers come from a counter
WordPress already maintains:

```
┌────────────────────────────────────────────────────────────────────┐
│ BLAME THE TECH        Incidents  Scapegoats  Blog  Reviews  HOBT   │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│   THE BLAME LEADERBOARD                                            │
│   one indexed read of wp_term_taxonomy.count — no COUNT(*)         │
│                                                                    │
│   1.  DNS                             ████████████  11 incidents   │
│   2.  The Intern                         █████████   8 incidents   │
│   3.  Mercury Retrograde                  ████████   7 incidents   │
│   4.  Legacy jQuery                          █████   5 incidents   │
│   5.  Solar Flares                            ████   4 incidents   │
│                                                                    │
│   ┌────────────────────────────────────────────────────────┐       │
│   │  DNS                          "It is always DNS."      │       │
│   │  scapegoatProfile: avatar, tagline, defensiveness 9    │       │
│   │  first blamed on 1983 · sentient: unclear              │       │
│   └────────────────────────────────────────────────────────┘       │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

The HOBT landing page. Note how little of it is code you will change after Module 14:

```
┌────────────────────────────────────────────────────────────────────┐
│ BLAME THE TECH        Incidents  Scapegoats  Blog  Reviews  HOBT   │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│   HOBT — How To Omit Blaming Tech                  hobtPromo       │
│   Stop blaming DNS. Start shipping.               (ACF, page)      │
│                                                                    │
│   [ Get Demo ]   [ Start Now ]        only 12 seats left           │
│    'use client'    plain <a>            seatsLeft -> short         │
│    dialog+form     external URL        revalidate                  │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│   EVERYTHING BELOW IS EDITOR-COMPOSED FROM BLOCKS                  │
│   marketing reorders this page with no deploy                      │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│   ┌──────────────────┐  ┌──────────────────┐                       │
│   │ btt/hobt-cta     │  │ btt/blame-quote  │                       │
│   └──────────────────┘  └──────────────────┘                       │
│   ┌──────────────────┐  ┌──────────────────┐                       │
│   │ modules repeater │  │ testimonials     │                       │
│   └──────────────────┘  └──────────────────┘                       │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

Count the `'use client'` annotations: three, across four screens. In Classic WordPress every
one of these pages would have shipped jQuery to handle the filters, the dialog and the mobile
nav. Here the default is zero JavaScript and you opt *into* interactivity at the leaf — the
same instinct as "dequeue the scripts you don't need", with much better tools.

### 8. Which module delivers what, and what is impossible before then

| Feature | Backed by | Delivered in | Impossible before, because |
|---|---|---|---|
| `incident`, `tech_review`, three taxonomies | post types + taxonomies | Module 03 | There is nothing to query until the types exist |
| Moderation roles and capabilities | `incident_reporter`, `map_meta_cap` | Module 03 | Capabilities are what the Module 16 mutation checks |
| `Incident Details`, `HOBT Promo`, repeaters | ACF Local JSON | Module 04 | Field groups are the schema WPGraphQL exposes |
| 40 incidents, 8 reviews, 10 posts | `wp blame seed` | Module 04 | Every later list view needs deterministic data |
| Every read the front end needs | WPGraphQL queries | Module 05 | You cannot fetch a query you have not written |
| `blameScore`, guarded mutations, `wordpress-headless/schema.graphql` | schema extensions | Module 06 | Codegen in Module 10 reads that committed schema |
| The first visitable page | Next App Router | **Module 09** | There is no front end at all before this |
| Design system, app shell, `/hobt` shell | Tailwind + shadcn/ui | Module 11 | CTAs stay inert until Module 16 wires them |
| The six custom blocks in the editor | `@wordpress/scripts` | Module 13 | The front end deliberately ignores them until 14 |
| `BlockRenderer`, `/hobt` composed by editors | blocks as data | Module 14 | Blocks must exist and be queryable first |
| Register, log in, protected `/incidents/submit` | JWT + httpOnly cookies | Module 15 | Mutations need a user to act as |
| **Submit → moderate → publish**, Get Demo | Server Actions + `wp_btt_leads` | **Module 16** | Needs auth, forms, validation and the leads table |
| Publish in WordPress → live in seconds | signed revalidation webhook | Module 18 | Needs ISR tags from Module 10 |
| Live in production | Fly.io + Vercel + CI | Module 24 | — |

Read that table once for calibration and then stop. The build arc in
[the course index](../README.md) says the same thing more briefly:

| After module | What exists |
|---|---|
| 01 | Documents. Nothing runs. **This module.** |
| 07 | A typed API and a Node script that prints live incidents. Still no website. |
| 09 | The first page you can visit in a browser. |
| 11 | Something that looks like a product. |
| 14 | Editor-composed pages. `/hobt` changes with no deploy. |
| 16 | The core loop closes. Submit, moderate, publish, capture leads. |
| 24 | Live in production. |

> **Modules 01 through 07 produce no front end whatsoever, and that is deliberate.** By the
> time you write your first React component in Module 08, the data you render is data you
> modelled, seeded and queried yourself. The alternative — scaffolding Next.js on day one
> against someone else's demo API — is faster to a screenshot and much slower to understanding.

---

## Task

Nothing executes in this lesson. Module 01 is the only module in the course like that. Your
output is two things: a read-through, and one document you will keep referring to until
Module 06.

### Step 1: Read PROJECT.md once, holding three questions

Open [PROJECT.md](../PROJECT.md) and read it top to bottom exactly once. Do not take notes on
the whole thing — it is the end state of 24 modules and treating it as a to-do list on day one
is the most common way to stall. Read it holding these three questions, and write the answers
down somewhere scratch:

1. Which single service in the local architecture diagram publishes **two** ports, and what is
   each one for?
2. The diagram says Next.js runs on the **host**, not in Compose. What reason does the document
   give, and what does Module 24 do about it?
3. In the cache-invalidation diagram, what does WordPress do *before* it calls Next, and what
   two properties of that call mean an editor never waits for the network?

Then close it.

### Step 2: Read only §1 and §2 of the content model contract

Open [appendix 03](../appendix/03-content-model-reference.md) and read **only**
[§1 Post types](../appendix/03-content-model-reference.md#1-post-types) and
[§2 Taxonomies](../appendix/03-content-model-reference.md#2-taxonomies). Skip §3 onward; enums,
ACF groups and capabilities arrive in Modules 03–06 and reading them now costs you the
attention you will need then.

Two things to notice while you are there, because they contradict instincts you have earned
honestly:

- Every post type registers `show_in_rest => true`, **even in a headless build**. The Gutenberg
  editor is a REST client. Turn REST off and the editor is a white screen.
- `incident` keeps `publicly_queryable => true` even though no user ever sees a WordPress-
  rendered incident page, because permalink generation and `preview_post_link` misbehave
  without it.

### Step 3: Write `docs/content-model.md`

This is your own working map from product to content model. Create it at the repository root
under `docs/`. Copy the skeleton below, then **replace every `TODO` with a real value read out
of [appendix 03](../appendix/03-content-model-reference.md)** — the first two rows are done for
you as a worked example, and there are five rows plus two prose sections left.

```markdown
<!-- docs/content-model.md -->
# Blame The Tech — content model map

My own map from product surface to content model. The authoritative contract is
`.lessons/appendix/03-content-model-reference.md`; this file is how I hold it in my head.
Where the two disagree, the appendix wins.

## Section to content model

| Section | Route | Post type | Taxonomies | ACF field group | Custom table |
|---|---|---|---|---|---|
| Incidents index | `/[locale]/incidents` | `incident` | `scapegoat`, `severity`, `tech_stack` | `Incident Details` | — |
| Incident detail | `/[locale]/incidents/[slug]` | `incident` | `scapegoat`, `severity`, `tech_stack` | `Incident Details` | — |
| Scapegoats | `/[locale]/scapegoats` | TODO | TODO | TODO | TODO |
| Blog | `/[locale]/blog` | TODO | TODO | TODO | TODO |
| Tech reviews | `/[locale]/reviews` | TODO | TODO | TODO | TODO |
| HOBT promo | `/[locale]/hobt` | TODO | TODO | TODO | TODO |
| Auth | `/[locale]/login`, `/register`, `/account` | TODO | TODO | TODO | TODO |

## The one thing that is not a post

TODO — name the table, say in two sentences why HOBT leads are not a `hobt_lead` post type,
and name the single mutation permitted to write to it.

## Why `scapegoat` is a taxonomy

TODO — Step 4 fills this in.

## Open questions

Things I do not understand yet. Each one names the module that should answer it.

- TODO — one question about the content model, with the module you expect to answer it.
- TODO — a second one.
```

Rules for filling it in:

- Use an em dash `—` where a column does not apply. Do not leave a cell empty; an empty cell
  reads as "I have not checked yet".
- Taxonomy and field-group names must match
  [appendix 03](../appendix/03-content-model-reference.md) exactly, including case and
  underscores. `tech_stack`, not `techStack` or `Tech Stack`.
- The `Auth` row is the interesting one. It has no post type at all, and saying so precisely is
  the point of the exercise.

**Verify §3:**

- [ ] The table has a header row, a separator row and **seven** data rows.
- [ ] No cell is blank, and no cell still says `TODO`.
- [ ] The HOBT row names `HOBT Promo` **and** `wp_btt_leads` — it is the only row that uses the
      last column.
- [ ] The Scapegoats row names `Scapegoat Profile` as an ACF group on a **taxonomy**, not on a
      post type.
- [ ] You wrote at least two genuine open questions, each naming a module number.

### Step 4: Answer the scapegoat question in your own words

Replace the `TODO` under the `## Why scapegoat is a taxonomy` heading with one paragraph of your own
prose — at least sixty words, no bullet list, no copy-paste from the appendix. It must contain
all three of these:

1. The **modelling** reason: what kind of relationship "this incident blames that thing" is.
2. The **performance** reason, naming `wp_term_taxonomy.count` and what the alternative would
   have to scan.
3. The **cost**: what you give up by making it a term rather than a post, and what covers the
   gap in this application.

Write it before you look at Key Concept 3 again. If you cannot produce the third point from
memory, that is the point of the exercise — reread §3 and then write it.

**Verify §4:**

- [ ] The paragraph names `wp_term_taxonomy.count` explicitly.
- [ ] It states a cost, not just two benefits. An architectural note with no cost in it is
      marketing.
- [ ] It is your sentences. If a phrase in it also appears verbatim in
      [appendix 03 §2](../appendix/03-content-model-reference.md#2-taxonomies), rewrite that
      phrase.

---

## Verification

```bash
# Run these from the repository root. Nothing here starts a process — every command is
# read-only, because Module 01 is the only module in the course where nothing executes.

# 1. The document exists where later lessons expect it
test -f docs/content-model.md && echo present
# Expected: present

# 2. It contains a real table: 1 header + 1 separator + 7 data rows = 9 lines minimum
grep -c '^|' docs/content-model.md
# Expected: 9 or more

# 3. Every one of the seven route slugs is accounted for
for s in incidents scapegoats blog reviews hobt login account; do
  printf '%-12s %s\n' "$s" "$(grep -c "$s" docs/content-model.md)"
done
# Expected: seven lines, every count 1 or more. A 0 means you skipped that section.

# 4. The three taxonomy names match the contract exactly, underscores included
grep -o -E 'scapegoat|severity|tech_stack' docs/content-model.md | sort -u
# Expected: three lines — scapegoat, severity, tech_stack
#           If you see "techStack" or "Tech Stack" instead, fix the spelling now:
#           Module 03 registers the snake_case name and Module 05 queries the camelCase one.

# 5. The leads table is named — the one thing in this app that is not a post
grep -c 'wp_btt_leads' docs/content-model.md
# Expected: 1 or more

# 6. Your scapegoat paragraph is prose and cites the denormalised counter
grep -c 'wp_term_taxonomy.count' docs/content-model.md
# Expected: 1 or more
sed -n '/## Why .scapegoat. is a taxonomy/,/^## /p' docs/content-model.md | wc -w
# Expected: 60 or more

# 7. NEGATIVE — no template placeholder survived
grep -c 'TODO' docs/content-model.md
# Expected: 0
#           Any other number means Step 3 or Step 4 is unfinished. `grep -c` exits 1 when
#           the count is 0, which is why this line is last in its group — that non-zero
#           exit status is the success case here.

# 8. NEGATIVE — this document is NOT ignored by git
git check-ignore -v docs/content-model.md; echo "exit=$?"
# Expected: no rule printed, and exit=1.
#           Documents are tracked. Contrast this with `git check-ignore -v .env` in
#           Lesson 02.5, which MUST print a rule — same command, opposite correct answer.

# 9. Git sees the document as new work, and nothing else changed
git status --short
# Expected: ?? docs/content-model.md   (or "A  docs/content-model.md" if you staged it)
#           Nothing under wordpress-headless/ or next-app/ — you have not built those yet.
```

If check 3 prints a `0`, or check 7 prints anything but `0`, the document is incomplete and
Modules 03 through 06 will be harder than they need to be. Both take two minutes to fix now.

## Control Questions

1. `severity` is a taxonomy with four locked terms, while `downtime_minutes` is post meta.
   State the rule that decides which of the two a new facet belongs in, and apply it to a
   hypothetical `affected_users` count and a hypothetical `blame_category`.
2. `incident_reporter` has no `publish_incidents` capability. Describe the alternative
   implementation that uses a status check inside the mutation instead, and name two concrete
   ways that alternative can be defeated that the capability approach cannot.
3. HOBT leads go in `wp_btt_leads` rather than a `hobt_lead` post type. Give the PII argument in
   one sentence, then give a second, independent argument that has nothing to do with privacy.
4. The blog is ten satirical posts and appears to be the least essential section in the
   application. Explain what breaks in Module 14 and in Module 23 if you skip it.
5. Nothing is visitable in a browser until Module 09, and the first six modules produce only a
   plugin, a schema and seed data. Argue the opposite case — that scaffolding Next.js in
   Module 02 would be better — and then say what that ordering would cost you in Module 10.

## Learn More

- [`register_post_type()` reference](https://developer.wordpress.org/reference/functions/register_post_type/)
  — the full argument list; skim `capability_type`, `map_meta_cap` and `publicly_queryable`,
  the three that Key Concept 2 turns on
- [Taxonomies in the Plugin Handbook](https://developer.wordpress.org/plugins/taxonomies/) —
  WordPress's own framing of the taxonomy-versus-meta decision, which agrees with Key Concept 3
- [Roles and Capabilities](https://developer.wordpress.org/plugins/users/roles-and-capabilities/)
  — read this before Module 03 so "withhold the capability" is a familiar idea rather than a
  surprising one
- [WPGraphQL: custom post types](https://www.wpgraphql.com/docs/custom-post-types/) — the four
  extra registration arguments that turn a post type into a schema type
- [ACF Repeater field](https://www.advancedcustomfields.com/resources/repeater/) — worth
  reading now so the generated object list types in Key Concept 5 are not a shock in Module 04
- [The `wpdb` class](https://developer.wordpress.org/reference/classes/wpdb/) — the API behind
  the `wp_btt_leads` table; read the `prepare()` section specifically
- [Block Editor Handbook](https://developer.wordpress.org/block-editor/) — orientation for
  Modules 13 and 14; the "Fundamentals" section is enough for now
