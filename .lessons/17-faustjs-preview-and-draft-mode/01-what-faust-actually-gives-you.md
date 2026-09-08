---
title: 'What Faust Actually Gives You'
module: 17
lesson: 1
teaches: [faustjs, wp-template-hierarchy-in-react, framework-evaluation, spike-not-rewrite, apollo-coupling]
produces: []
requires: [10.1]
---

# Lesson 17.1 — What Faust Actually Gives You

## Quick Overview

**Faust.js** is WP Engine's Next.js framework for headless WordPress, and the honest one-line
summary is that it solves three problems you have already solved by hand, and one you have not:
WordPress-controlled routing with a real template hierarchy in React. Instead of writing
`app/[locale]/incidents/[slug]/page.tsx` yourself, you write `wp-templates/single-incident.js` and
Faust resolves which template a given WordPress URI should use, exactly as `single-{post_type}.php`
does in a classic theme. It ships preview, login and a `faustjs` seed-query layer on top of Apollo
Client, and it is the closest thing the ecosystem has to "a headless WordPress theme".

You are going to install it **beside** the app you have built, as its own sibling application —
`faust-spike/` at the repository root, on port 3001 — against the same WordPress. This is a
**spike**, not a rewrite: no existing route changes, no existing dependency is replaced, and the
whole thing is deleted in Lesson 17.4, which is why it never appears in the expected tree in
`next-app/README.md`. A sibling app rather than a route group inside `next-app/`, for three
reasons you will meet in Step 1: `next-app` has no `src/app/layout.tsx` and its middleware
redirects any first segment that is not a locale, so a `/faust` path there needs a root layout it
does not have and a middleware exception it should not get; Faust pins its own React and Next
ranges and brings Apollo, and a spike that can break the lockfile the other twenty-three modules
depend on is not reversible; and Lesson 07.1 §9's licence rule means `next-app` takes no GPL
dependency until somebody has actually checked. The point of a spike is to buy
information at a fixed price. By the end of this lesson you will know what Faust does for free,
what it does instead of letting you do it, and where its Apollo data layer sits relative to the
`fetch`-plus-cache-tags client you built in Lesson 10.1. Hold the verdict until 17.4. Evaluating a
framework by reading its marketing page is how teams end up rewriting twice.

By the end of this lesson you will have:

- Faust installed in `faust-spike/` with its own `package.json` and `faust.config.js`, running on
  port 3001 against your existing WordPress, with no change to any existing route
- One working Faust template — `wp-templates/single-incident.js` — rendering a real incident
- The same incident rendered by your own route, side by side, with both response payloads captured
- A filled-in first column of the Faust scorecard in the module README: what it gave you, and what
  it took over
- A note on the two coupling points you will weigh in 17.4: Apollo Client as the data layer, and
  Faust's own routing resolution
- The `@faustwp/*` package versions and their last release dates written down — maintenance status
  is an architectural input, not gossip

## Classic WP Analogy

Faust is a **headless theme**, and once you see it that way everything about it makes sense.
Classic WordPress resolves a URL through `template-loader.php` and the template hierarchy:
`single-incident.php`, then `single.php`, then `singular.php`, then `index.php`. Inside the
template, `get_queried_object()` hands you the thing WordPress already decided the URL referred to,
and you render it. You never write a router, because WordPress *is* the router.

| Classic WordPress theme | Faust.js | This app's own stack |
|---|---|---|
| `single-incident.php` | `wp-templates/single-incident.js` | `app/[locale]/incidents/[slug]/page.tsx` |
| `template-loader.php` | Faust's `getWordPressProps` / template resolver | the Next file-system router |
| `get_queried_object()` | the seed query + `useFaustQuery` | your own `fetchGraphQL` call, typed by codegen |
| `functions.php` | `faust.config.js` + plugins | `next.config.ts` + your own libs |
| the theme's `WP_Query` loop | Apollo `useQuery` | an RSC `await` with cache tags |
| Preview in wp-admin, working out of the box | working out of the box | Lesson 17.2, built by hand |

The trade is the same one you have made a hundred times choosing between a starter theme and a
blank one. A starter theme gives you a working site by Friday and a set of conventions you will
fight in month four. A blank theme costs you Friday and gives you nothing to fight.

**Where the analogy breaks down, and it is the break that decides this module:** a classic theme's
template hierarchy is *free*, because WordPress has already parsed the request and run the main
query before your template loads. Faust's version is not free — it costs you the router. When
WordPress decides which component renders a URL, Next.js can no longer be the authority on that
route's rendering strategy, and everything Module 18 is about — `revalidate` per route,
`generateStaticParams`, `revalidateTag` from a webhook, `force-dynamic` on personalised pages —
becomes something you negotiate with a framework instead of something you declare. Faust also
predates the App Router's maturity and leans on Apollo, whose client-side cache is a different
model from Next's server-side Data Cache. You end up with two caches and no single source of truth
about freshness.

The second break: a classic theme is *your* code. Faust is a dependency in maintenance mode,
sitting between you and two frameworks that both move quickly. In Classic WordPress the equivalent
risk is adopting a page builder — enormous leverage right up until you need something it did not
anticipate.

---

## Key Concepts

### 1. Three layers, and you take all three or none

Faust is usually described as "preview and templates for headless WordPress". That
undersells the coupling. It is three layers stacked in a fixed order, and the bottom one is not
optional.

```
   ┌───────────────────────────────────────────────────────────┐
   │  3. AUTH        useAuth, redirect login, token handling   │  ← optional-ish
   ├───────────────────────────────────────────────────────────┤
   │  2. PREVIEW     wp-admin Preview → the Faust front end    │  ← optional-ish
   ├───────────────────────────────────────────────────────────┤
   │  1. ROUTING +   pages/[...wordpressNode].js, the seed      │  ← MANDATORY
   │     DATA        query, wp-templates/, Apollo Client        │     the framework IS this
   └───────────────────────────────────────────────────────────┘
```

You can decline layers 2 and 3. You cannot decline layer 1, because layer 1 *is* Faust: the
catch-all route, the seed query, the template resolver and the Apollo client are one mechanism.
`WordPressTemplate` receives props that `getWordPressProps()` produced, and `getWordPressProps()`
produced them by running a query through Faust's Apollo client. There is no seam.

| What you might want | Can you take just that? | Why |
|---|---|---|
| The preview flow | ❌ | The preview handler resolves the previewed node through the same seed query and renders it through `WordPressTemplate` |
| The template hierarchy | ❌ | Resolution happens inside `getWordPressProps()`, which is also the data fetch |
| `useAuth` | ⚠️ almost | It needs `pages/api/faust/[route].js` mounted, which is Faust's own API surface |
| Apollo Client | ❌ **you take it whether you want it or not** | It is the transport under every layer |
| **Verdict** | **all three, or write it yourself** | Which is the decision Lesson 17.4 records |

> **This is what "framework" means, and it is not a criticism.** Next.js is also a framework and
> you cannot decline its router either. The question is never "is this coupling bad?" — it is
> "does the thing I am coupling to own the decisions I most need to make myself?" Hold that
> question until Lesson 17.3 has measured the answer.

### 2. What Faust is *not*

Three things get attributed to it that it does not do, and knowing which is which stops you
evaluating a strawman.

| Claim | True? | The actual situation |
|---|---|---|
| "Faust is a headless CMS" | ❌ | WordPress is the CMS. Faust is a front-end framework that reads it. Your content model, roles, ACF fields and moderation flow are unchanged by adopting or dropping it. |
| "Faust replaces WPGraphQL" | ❌ | It **requires** WPGraphQL, plus WP Engine's own `faustwp` plugin, and queries the same `/graphql` endpoint you built in Modules 05 and 06 |
| "Faust is a data layer you can swap out" | ❌ | Apollo Client is not pluggable here. Layer 1 above. |
| "Adopting Faust changes your WordPress" | ⚠️ partly | It installs a plugin that adds settings and **filters some link functions**, which matters in Lesson 17.2. Your content is untouched. |

That last row is the one that makes this spike safe to run and Lesson 17.4's deletion cheap.
**Your content stays in WordPress in exactly the same shape either way** — a point Lesson 17.4
returns to, because it is the strongest argument in Faust's favour.

### 3. `wp-templates/` against `template-loader.php`

Classic WordPress resolves a request in two steps you have never had to think about separately.
`WP` parses the URL into query vars and runs the main query; `template-loader.php` then walks the
hierarchy and includes the first template file that exists. Faust reproduces both steps, in
JavaScript, on the other side of a network call.

```
CLASSIC                                   FAUST
────────────────────────────────────      ────────────────────────────────────
GET /incidents/incident-01                GET /incidents/incident-01
   │                                         │
   ▼ wp-settings: parse_request()            ▼ pages/[...wordpressNode].js
   ▼ WP_Query (the MAIN query)               ▼ getWordPressProps()
   │                                         │   └─ SEED QUERY over /graphql:
   │  WordPress already HAS the post         │      "what node is this URI?"
   ▼ template_loader.php                     ▼ Faust's template resolver
   │   single-incident.php  ?                │   wp-templates/index.js keys:
   │   single.php           ?                │     'single-incident' ?
   │   singular.php         ?                │     'single'          ?
   │   index.php            ← last resort    │     'index'           ← last resort
   ▼                                         ▼
render, server-side, synchronous          render <WordPressTemplate />
```

| Classic file | Faust key in `wp-templates/index.js` |
|---|---|
| `front-page.php` | `front-page` |
| `single-incident.php` | `single-incident` |
| `single.php` | `single` |
| `archive-incident.php` | `archive-incident` |
| `archive.php` | `archive` |
| `category.php` | `category` |
| `index.php` | `index` |

The keys are the classic template names with the `.php` dropped, and the fallback order is the
one you already know. If you have ever debugged "why is this rendering `index.php`?", you have
the whole skill already — Lesson 17.3 makes you use it.

**The difference that matters is the arrow marked SEED QUERY.** In Classic WordPress the main
query has already run by the time the hierarchy is walked, so resolution is free. Here it is a
network round trip whose entire job is to answer a question your own routes answer from the file
system for nothing.

### 4. The seed query: one round trip to learn what you already knew

The seed query is `nodeByUri`. Given `/incidents/incident-01`, it asks WordPress "what is this?"
and gets back the node's `__typename`, `databaseId`, `uri`, `id` and — critically — the template
name WordPress would have chosen.

```graphql
# Illustrative — Faust builds and sends this itself; you never write it.
query GetNodeByUri($uri: String!) {
  nodeByUri(uri: $uri) {
    __typename
    ... on ContentNode { databaseId uri isContentNode }
    ... on DatabaseIdentifier { databaseId }
  }
}
```

Then, and only then, can Faust run the template's own query. Two sequential round trips before
the first byte of content, because the second depends on the first.

```
FAUST                                      THIS APP
─────────────────────────────────────      ─────────────────────────────────────
1. seed query   nodeByUri(uri)             1. the file path IS the answer:
   "it is an Incident, id 4711"               app/[locale]/incidents/[slug]/
   ~40-90 ms                                  0 ms, 0 requests
2. template query, needs step 1's id       2. IncidentBySlug({ slug })
   ~40-90 ms                                  ~40-90 ms
────────────────────────────────────       ────────────────────────────────────
2 sequential round trips                   1 round trip
```

The cost is not the milliseconds. It is that the second query **cannot start until the first
finishes**, so it is latency you cannot parallelise away, on every uncached request, forever. And
you are paying it to learn a fact that is statically knowable: `/incidents/<slug>` is an incident.
That is the trade in one sentence — **you buy editor-controlled routing by giving up the fact that
your URL structure is known at build time.**

> **Where the seed query genuinely earns its keep.** A WordPress *page* tree that editors
> restructure — `/about`, `/about/team`, `/services/uk/pricing` — has no shape you can encode in a
> file path. This app answers that with a `[...slug]` catch-all and `PageByUri` (Lesson 10.5),
> which is the same idea, once, for the one route that needs it. Faust applies it to every route.

### 5. `faust.config.js` and the `@faustwp/*` package set

Four moving parts, and it is worth knowing what each one is before you install them, because
"the framework" is really this list.

| Package or file | What it does | Classic analogue |
|---|---|---|
| `@faustwp/core` | `FaustProvider`, `WordPressTemplate`, `getWordPressProps()`, `useAuth`, the Apollo client, the API router | the theme's bootstrap plus `WP_Query` |
| `@faustwp/cli` | `faust dev` / `faust build` / `faust start` — wraps `next` and generates Apollo `possibleTypes` from your schema | no analogue; a build step Classic never had |
| `faust.config.js` | registers the template map and any Faust plugins | `functions.php` |
| the `faustwp` WordPress plugin | a settings page (front-end URL, secret key), preview handling, and link rewriting | a companion plugin |

`possibleTypes` deserves a sentence because it is the first thing that breaks. Apollo's normalised
cache cannot resolve an interface or union fragment without knowing which concrete types implement
it, so `@faustwp/cli` introspects your schema and writes a `possibleTypes.json`. Change the schema
— add a post type, add a taxonomy — and that file is stale until you regenerate. This app has the
same class of problem and solves it with `wordpress-headless/schema.graphql` plus `npm run codegen`
(Lesson 10.2); the difference is that codegen failing is a **type error at build time** and a
stale `possibleTypes` is a **wrong answer at runtime**.

### 6. Apollo's normalised cache versus Next's Data Cache — the row that decides the module

This is the concept to read twice. Everything else in Module 17 and all of Module 18 hangs on it.

```
   FAUST / APOLLO                              THIS APP / NEXT
   ────────────────────────────────────        ────────────────────────────────────
   ┌──────────────────────────────┐            ┌──────────────────────────────┐
   │ browser                      │            │ browser                      │
   │  InMemoryCache               │            │  (no cache — no data here)    │
   │  normalised by __typename:id │            │                              │
   │  lives until reload          │            │                              │
   └──────────────┬───────────────┘            └──────────────┬───────────────┘
                  │ HTTP                                      │ HTML only
   ┌──────────────▼───────────────┐            ┌──────────────▼───────────────┐
   │ WordPress /graphql           │            │ Next server                   │
   └──────────────────────────────┘            │  Data Cache, keyed by request │
                                               │  TAGGED: incident:incident-01 │
                                               │  revalidateTag() purges it    │
                                               └──────────────┬───────────────┘
                                                              │
                                               ┌──────────────▼───────────────┐
                                               │ WordPress /graphql           │
                                               └──────────────────────────────┘
```

| | Apollo `InMemoryCache` | Next Data Cache |
|---|---|---|
| Lives | in one browser tab | on the server, shared by every visitor |
| Keyed by | `__typename` + `id`, normalised | the request (URL + method + body) plus your `tags` |
| Invalidated by | a refetch, a mutation's `update`, or a page reload | `revalidateTag()`, `revalidatePath()`, or a `revalidate` window |
| Reachable from WordPress | ❌ **never** | ✅ a signed webhook (Module 18) |
| Survives a deploy | no | yes, if you configure it to |
| What Publish does to it | nothing, until that user reloads | purges exactly the tagged entries, seconds later |
| **Verdict** | correct for a client-heavy app whose freshness needs are per-session | **correct for a content site**, and the only one WordPress can talk to |

Read the "Reachable from WordPress" row again. **`revalidateTag` needs something to attach a tag
to, and an Apollo query has no tag.** Module 18's entire deliverable — WordPress publishes, a
signed webhook fires, and the specific pages that changed go stale in under a second — has no
insertion point in the Apollo model. Faust does not block it out of neglect; it is a different
architecture with a different theory of freshness, and the two theories do not compose. Lesson
17.3 measures this rather than asserting it.

> **Two caches and no single source of truth about freshness.** Adopting Faust inside this app
> would not replace the Data Cache; it would add a second cache beside it with different
> invalidation rules, and "is this page stale?" would stop having one answer. That is worse than
> either choice made cleanly.

### 7. Faust requires the one environment variable this course named as an anti-pattern

Faust's Apollo client runs in the browser, so the browser must know where WordPress is. The
variable is `NEXT_PUBLIC_WORDPRESS_URL`, and
[appendix 04 §3.2](../appendix/04-env-reference.md#32-public-next_public_--all-five-of-them) names
that exact pattern as one to avoid, listing four public variables and saying "nothing else, ever".

This is not Faust being careless. It is the honest consequence of client-side data fetching: a
query issued by JavaScript in a browser needs a URL the browser can resolve, and that URL is
therefore public. The costs are real and worth naming rather than sneering at:

| Consequence | Severity here |
|---|---|
| The WordPress origin is published | low — it is discoverable anyway from an uploads URL |
| `/graphql` is reachable from any browser on the internet | **medium** — unmetered querying and introspection, which appendix 03 §8 declined for exactly this reason |
| You now need a CORS policy | medium — one more thing to maintain, and one more thing to get wrong |
| Query cost control moves to WordPress | medium — Lesson 06.4's depth and complexity limits become load-bearing rather than belt-and-braces |

In this app the browser never reaches `/graphql` at all, which is why none of those four rows
exists. That is a property you would be trading away, and it belongs in the scorecard.

### 8. Maintenance status is an architectural input, not gossip

A dependency that sits between you and two fast-moving frameworks has to keep up with both. So
"when did this last ship?" is a design question, and the answer goes in the ADR.

Do **not** take a number from this lesson, from a blog post, or from memory. Read it from the
registry, in Step 2, and write down what you actually saw:

```bash
npm view @faustwp/core version time.modified
npm view @faustwp/core peerDependencies
```

Three things to record, because they are the three that bite:

1. **The latest version and its publish date.** Months of silence is information; it is not proof
   of abandonment.
2. **The `next` and `react` peer ranges.** If they do not include the versions `next-app` is on,
   adopting Faust means downgrading the app or forcing a resolution — and that is the moment a
   spike stops being reversible.
3. **Whether the App Router is supported.** Faust's documented shape is the **Pages Router**:
   `pages/_app.js`, `pages/[...wordpressNode].js`, `getWordPressProps()` in `getStaticProps`. Your
   whole application is App Router, Server Components and Server Actions. That is not a version
   gap you close by upgrading.

> **The honest reading of a slow release cadence.** It usually means the maintainers consider the
> library finished, not dead — and for a framework layer over two libraries that ship every few
> weeks, "finished" and "falling behind" look identical from the outside for about a year, and then
> they do not.

### 9. Why the spike is a sibling app, and not a route group inside `next-app`

The obvious instinct is `next-app/src/app/faust/` behind a route group. Three reasons that does not
work, and each is a fact an earlier lesson established rather than a preference.

**One: there is no root layout to put it under.** Faust's Pages Router shape needs `pages/`, and
even the App Router variant needs a root layout with `<html>` and `<body>`. This app's root layout
is `src/app/[locale]/layout.tsx` — **there is no `src/app/layout.tsx`**, deliberately, because the
locale segment owns the `lang` attribute. A `/faust` path would need a second root layout, and
`/faust` also matches `[locale]` with `locale = 'faust'`, so the two routes collide.

**Two: `middleware.ts` would 307 it away.** Lesson 15.5's middleware normalises any first segment
that is not in `LOCALES` to `/en/<path>`, and Lesson 15.5 §4 spends a Key Concept explaining why
`config.matcher` must not be edited. Adding `/faust` to the matcher exclusions to accommodate a
spike you intend to delete is the definition of a change you cannot justify at review.

**Three: a spike that can move the lockfile is not reversible.** Faust brings `@apollo/client`,
`graphql` and its own `next`/`react` peer ranges. Installing it into `next-app` rewrites
`package-lock.json` for twenty-three modules' worth of work, and `npm uninstall` does not reliably
restore the previous resolution tree. Add Lesson 07.1 §9's rule — `next-app` takes **no GPL or AGPL
dependency** — and installing a package whose licence nobody has checked yet into the app you ship
is exactly backwards.

```
   ❌ A ROUTE GROUP IN next-app             ✅ A SIBLING APP
   ──────────────────────────────────       ──────────────────────────────────
   next-app/                                repo-root/
     package.json      ← rewritten            next-app/        untouched
     package-lock.json ← rewritten            wordpress-headless/  shared
     src/middleware.ts ← matcher edited       faust-spike/     ← all of it here
     src/app/faust/    ← needs a root           package.json
                          layout, and             node_modules/
                          collides with          :3001
                          [locale]
   reverting = "git revert and hope"        reverting = rm -rf, and nothing else moved
```

The sibling app shares the one thing that should be shared — **the same WordPress on `:8080`** —
and shares nothing that should not.

### 10. What a spike is, and what it costs

A **spike** is a time-boxed experiment whose deliverable is a decision, not code. Four properties,
and dropping any one of them turns it into an unplanned rewrite:

| Property | This spike |
|---|---|
| **Bounded** | one sibling directory, one port, zero changes to `next-app` |
| **Time-boxed** | two lessons, 17.1 and 17.3 |
| **Answering a stated question** | "does Faust give us more than it takes, for *this* application?" |
| **Deleted** | Lesson 17.4, `rm -rf faust-spike` |

The last row is the one people skip, and skipping it is how a spike becomes a second production
system nobody owns.

**The cost, stated plainly: you are about to spend two lessons building something you delete.**
That is what buying information costs. The alternative is deciding from a marketing page or a
conference talk, and that has cost teams a second rewrite eighteen months later — at which point
the framework owns the routing, the data layer and every caching decision, and there is no
increment small enough to migrate.

> **What survives is the commit, not the directory.** Lesson 17.4 keeps the spike as its own git
> commit and deletes the working tree. Six months from now, "we tried it, here is the branch, here
> is the ADR" is a complete answer; "we discussed it once" is not.

---

## Task

### Step 1: Create the sibling directory, and prove it is separate

Everything in this lesson happens at the repository root, beside `next-app/`, never inside it.

```bash
cd "$(git rev-parse --show-toplevel)"
mkdir -p faust-spike/wp-templates faust-spike/pages/api/faust

# The two files that must NOT change during this lesson. Record their digests now.
shasum -a 256 next-app/package.json next-app/package-lock.json > /tmp/btt-lockfile-before.txt
cat /tmp/btt-lockfile-before.txt
```

**Verify §1:**

- [ ] `pwd` ends in the repository root, **not** in `next-app`. Every remaining command in this
      lesson assumes that.
- [ ] `/tmp/btt-lockfile-before.txt` has two lines. Verification check 8 compares against it, and
      that check is the whole reason the spike is a sibling app.
- [ ] `git check-ignore -v faust-spike/node_modules` names a rule. The root `.gitignore`'s
      `node_modules/` pattern has no slash, so it matches at any depth.

### Step 2: Install the packages, pin them, and check the licence before you trust it

Lesson 07.1 §9 is the rule: `next-app` takes **no GPL or AGPL dependency**, and the check happens
*before* the dependency is load-bearing. `faust-spike` is not `next-app` and never ships, but you
still run the check here — because the answer is what Lesson 17.4's ADR has to record.

```bash
cd faust-spike

# 1. Read the metadata BEFORE installing anything. This is the maintenance-status
#    evidence from Key Concept 8 — write down what YOU see, not what a lesson says.
npm view @faustwp/core version time.modified peerDependencies
npm view @faustwp/cli  version time.modified

# 2. THE LICENCE CHECK. Lesson 07.1 §9.
npm view @faustwp/core license
npm view @faustwp/cli  license
npm view @apollo/client license
```

**Write the answers down now**, in a scratch note or straight into
`docs/adr/0009-preview-only-faust-adoption.md` if you want a head start on Lesson 17.4. Then
initialise the project. Note that this `package.json` is hand-written, exactly as Lesson 09.1
hand-wrote `next-app`'s — there is no `create-next-app` anywhere in this course, and there is no
`create-faust-app` here either.

Create `faust-spike/package.json`:

```json
{
  "name": "faust-spike",
  "version": "0.0.0",
  "private": true,
  "license": "UNLICENSED",
  "description": "DELETED IN LESSON 17.4. A time-boxed Faust.js evaluation. Not part of the product.",
  "scripts": {
    "dev": "PORT=3001 faust dev",
    "build": "faust build",
    "start": "PORT=3001 faust start"
  }
}
```

Two deliberate choices in that file. `"private": true` and `"license": "UNLICENSED"`, because this
is never published and a missing `license` field is its own Lesson 07.1 §9 failure. And the port is
baked into the scripts rather than passed on the command line: the spike must **never** be able to
bind `:3000`, and a flag you have to remember is a flag you will forget once.

Now install, with exact versions so the tree is reproducible:

```bash
npm install --save-exact \
  @faustwp/core @faustwp/cli @apollo/client graphql next react react-dom

# The whole shipped tree, grouped by licence — the appendix 07 command, applied here.
npx license-checker --production --summary
```

**Verify §2:**

- [ ] `npm view @faustwp/core license` printed a licence field.
      **Write whatever it says into the ADR in Lesson 17.4.** If it is GPL or AGPL, note in the
      same line that the spike living outside `next-app/` is what made running it safe at all — a
      copyleft package inside `next-app` would reach the whole distributed work, per Lesson 07.1 §9.
- [ ] A package with **no** `license` field is the worst outcome, not the best: no licence means no
      permission granted. Record that too if you see it.
- [ ] `npx license-checker --production --summary` lists the licence families in this tree. Note
      any GPL, AGPL, SSPL or BUSL entry — including transitive ones.
- [ ] `node -e "console.log(require('./package.json').dependencies)"` shows exact versions with no
      `^` or `~`. A spike that resolves differently tomorrow proves nothing.

### Step 3: Configure Faust, and meet the variable this course forbids

Two files. The first is `faust.config.js`, which is Faust's `functions.php`.

```js
// faust-spike/faust.config.js
// Faust's functions.php. It registers the template map and any Faust plugins.
// The WordPress URL does NOT live here — Faust reads it from the environment,
// because the BROWSER needs it too. See Key Concept 7.
import { setConfig } from '@faustwp/core';

import templates from './wp-templates';

export default setConfig({
  templates,
});
```

The second is the environment. `faust-spike/.env.local` is gitignored by the root rule Lesson 02.2
established — prove it before you write a value into it, in that order, every time:

```bash
git check-ignore -v .env.local
# Expected: a rule from the root .gitignore. NO OUTPUT MEANS STOP.
```

```dotenv
# faust-spike/.env.local
# GITIGNORED. Confirmed above, before this file existed.

# Faust's Apollo client runs IN THE BROWSER, so the WordPress origin must be
# public. This is the variable appendix 04 §3.2 names as an anti-pattern and
# lists among the things next-app may never have. Key Concept 7 argues why that
# is an honest consequence of client-side fetching rather than a Faust defect.
#
# localhost, not host.docker.internal: the resolver here is your BROWSER, not a
# container.
NEXT_PUBLIC_WORDPRESS_URL=http://localhost:8080

# Copied out of the faustwp plugin's settings page in Step 4.
FAUST_SECRET_KEY=__CHANGE_ME__
```

> **`localhost:8080`, not `host.docker.internal:8080`.** `BTT_FRONTEND_URL` points the other
> direction — it is how WordPress-in-a-container reaches Next-on-your-host — and this variable is
> how your browser reaches WordPress. Lesson 02.2 Key Concept 2 is the four-way table; getting the
> direction backwards here produces a page that renders with every query failing and no clue why.

### Step 4: Install the WordPress-side plugin, and record what it changed

Faust needs a companion plugin. Install it with WP-CLI — the stock `wordpress` image ships no `wp`
binary, so this is the `wpcli` service, as it has been since Lesson 02.2.

**Before you activate it, capture what wp-admin's Preview button currently points at.** This is the
measurement that makes Lesson 17.2's Step 4 and Lesson 17.4's most important negative check
meaningful, and it takes one command:

```bash
cd ../wordpress-headless

docker compose run --rm wpcli wp eval '
  $p = get_page_by_path( "incident-01", OBJECT, "incident" );
  echo $p ? $p->ID . " " . get_preview_post_link( $p->ID ) . PHP_EOL : "NOT FOUND" . PHP_EOL;'
# Expected: a post ID followed by a WordPress URL on :8080. Write it down.
#           NOT FOUND means `wp blame seed` has not run — Lesson 04.5.

docker compose run --rm wpcli wp plugin install faustwp --activate
docker compose run --rm wpcli wp plugin list --status=active --field=name
```

Then look at what activation did, and set the front-end URL to the spike:

```bash
docker compose run --rm wpcli wp option get faustwp_settings --format=json
# Expected: a JSON object. If the option does not exist yet, the settings page has
#           never been saved — `wp option list --search='faust*'` finds the real name
#           in your release.

docker compose run --rm wpcli wp option patch insert faustwp_settings frontend_uri 'http://localhost:3001'
docker compose run --rm wpcli wp option patch insert faustwp_settings disable_theme '1'
```

**Verify §4:**

- [ ] `wp plugin list --status=active --field=name` includes `faustwp` **and** still includes
      `wp-graphql`, `wp-graphql-jwt-authentication` and `blame-the-tech-core`. Faust adds; it does
      not replace.
- [ ] Re-run the `get_preview_post_link()` command above. **It probably changed**, and the new
      value probably points at `:3001`. That is the plugin taking over one of WordPress's link
      functions, and it is the first concrete instance of Key Concept 1's coupling. Write down both
      values — before and after.
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' -d '{"query":"{ generalSettings { title } }"}'` is still `200`. The
      plugin must not have disturbed the endpoint Modules 05 to 16 are built on.

### Step 5: Write the Pages Router shell Faust needs

Faust's documented shape is the **Pages Router**, which is one of the facts Key Concept 8 asked you
to record. Three files, and none of them has an App Router equivalent.

```jsx
// faust-spike/pages/_app.js
// FaustProvider mounts Apollo, the auth context and Faust's own toolbar.
// There is no App Router version of this file — a provider at the root of the
// tree is exactly the pattern Server Components exist to avoid.
import { FaustProvider } from '@faustwp/core';
import '@faustwp/core/dist/css/toolbar.css';

import '../faust.config';

export default function MyApp({ Component, pageProps }) {
  return (
    <FaustProvider pageProps={pageProps}>
      <Component {...pageProps} />
    </FaustProvider>
  );
}
```

```jsx
// faust-spike/pages/[...wordpressNode].js
// THE WHOLE ROUTER. One catch-all file replaces every route file in next-app's
// src/app/[locale]/. WordPress decides which template renders; this file only
// forwards the props the seed query produced. Key Concepts 3 and 4.
import { getWordPressProps, WordPressTemplate } from '@faustwp/core';

export default function Page(props) {
  return <WordPressTemplate {...props} />;
}

// getStaticProps, not an async Server Component. The seed query runs HERE, at
// build time or on the ISR revalidate — and its result is what picks the
// template. There is no place in this signature to attach a cache TAG.
export function getStaticProps(ctx) {
  return getWordPressProps({ ctx, revalidate: 60 });
}

export function getStaticPaths() {
  return { paths: [], fallback: 'blocking' };
}
```

```js
// faust-spike/pages/api/faust/[route].js
// Faust's own API surface: the token exchange for auth (Lesson 17.3) and the
// preview handler. Mounting it is not optional if you want layers 2 or 3.
import '../../../faust.config';
import { apiRouter } from '@faustwp/core/dist/mjs/server/index.js';

export default apiRouter;
```

> **Read `pages/[...wordpressNode].js` again and count the routes.** One file, for the entire site.
> That is the capability Lesson 17.3 calls the editor-controlled-template promise, and it is real —
> your twelve hand-written route files genuinely cannot do it. It is also the reason Next can no
> longer be the authority on any route's rendering strategy, which is every capability Module 18
> delivers. Both sentences are true at once; that is what makes this a decision and not a
> preference.

### Step 6: Write two templates, and make one render a real incident

`wp-templates/index.js` is the map. The keys are classic template names, and the fallback order in
Key Concept 3's table is the one Faust walks.

```js
// faust-spike/wp-templates/index.js
// The template hierarchy, as a plain object. Faust walks WordPress's own
// fallback order and picks the first key that exists — single-incident, then
// single, then index. Lesson 17.3 proves the fallback by deleting a key.
import index from './index-template';
import singleIncident from './single-incident';

export default {
  'single-incident': singleIncident,
  index,
};
```

```jsx
// faust-spike/wp-templates/single-incident.js
// The Faust equivalent of single-incident.php. Compare with
// next-app/src/app/[locale]/incidents/[slug]/page.tsx, which this lesson does
// not touch.
import { gql } from '@apollo/client';

export default function SingleIncident(props) {
  // props.data is what Faust's Apollo client returned for the query below.
  const incident = props?.data?.incident;

  if (!incident) {
    return <main>Not found.</main>;
  }

  return (
    <main>
      <p>Rendered by Faust, on port 3001, from wp-templates/single-incident.js.</p>
      <h1>{incident.title}</h1>
      <p>Slug: {incident.slug}</p>
      <p>Blame score: {String(incident.blameScore)}</p>
      <p>Downtime: {String(incident.incidentDetails?.downtimeMinutes)} minutes</p>
    </main>
  );
}

// The template owns its own query, and its own variables mapper. This is the
// second round trip from Key Concept 4 — it cannot start until the seed query
// has told Faust that this URI is an Incident with this databaseId.
SingleIncident.query = gql`
  query GetIncident($databaseId: ID!, $asPreview: Boolean = false) {
    incident(id: $databaseId, idType: DATABASE_ID, asPreview: $asPreview) {
      title
      slug
      blameScore
      incidentDetails {
        downtimeMinutes
      }
    }
  }
`;

SingleIncident.variables = ({ databaseId }, ctx) => ({
  databaseId,
  asPreview: ctx?.asPreview,
});
```

```jsx
// faust-spike/wp-templates/index-template.js
// The last-resort template — Faust's index.php. It exists so the fallback chain
// terminates, and Lesson 17.3 uses it to prove the chain works.
export default function IndexTemplate(props) {
  return (
    <main>
      <p>Faust fell back to the index template.</p>
      <p>Node type: {props?.data?.nodeByUri?.__typename ?? 'unknown'}</p>
    </main>
  );
}
```

**Verify §6:**

- [ ] `ls faust-spike/wp-templates/` shows exactly three files. `index.js` is the **map**;
      `index-template.js` is the **template**. Naming them both `index` is a real trap — the map is
      what `faust.config.js` imports.
- [ ] `grep -c 'asPreview' faust-spike/wp-templates/single-incident.js` is `3`. Faust threads
      preview state into the template's variables for you, which is the layer-2 capability Lesson
      17.2 builds by hand.

### Step 7: Start it on 3001, and render the same incident twice

Both applications run at once, against the same WordPress. That is the point.

```bash
# Terminal 1 — the app you actually ship, unchanged.
cd next-app && npm run dev

# Terminal 2 — the spike.
cd faust-spike && npm run dev
```

Then capture both payloads from a third terminal, so you are comparing bytes rather than
impressions:

```bash
cd "$(git rev-parse --show-toplevel)"

curl -s http://localhost:3000/en/incidents/incident-01 > /tmp/btt-own.html
curl -s http://localhost:3001/incidents/incident-01    > /tmp/btt-faust.html

wc -c /tmp/btt-own.html /tmp/btt-faust.html
grep -c 'Deployed on a Friday' /tmp/btt-own.html /tmp/btt-faust.html
```

**Verify §7:**

- [ ] Both HTML files contain the incident's title, `Deployed on a Friday (#1)` — the seeded value
      Lesson 12.3's smoke spec already asserts. If the Faust one does not, check
      `NEXT_PUBLIC_WORDPRESS_URL` first and the `possibleTypes` regeneration second.
- [ ] `/tmp/btt-faust.html` contains the string `wp-templates/single-incident.js` from the paragraph
      you wrote. **No route file resolved that URL** — the template did, from a catch-all. That is
      the capability, demonstrated.
- [ ] Keep both files. Lesson 17.3 measures them properly, and Lesson 17.4 cites the numbers.

### Step 8: Fill in the Faust column of the scorecard

The module README carries **The Faust Scorecard**, and its Faust column is currently a claim. Turn
the first rows into evidence, in your own notes rather than in the course text — `docs/` is yours
and `docs/architecture.md` already exists from Lesson 01.2:

```markdown
<!-- docs/architecture.md — append -->

## Faust.js evaluation, evidence log (Lesson 17.1)

Spike: `faust-spike/`, own `package.json`, own `node_modules`, port 3001, same WordPress on 8080.
Deleted in Lesson 17.4; the commit is kept.

| Scorecard row | What I ran | What I saw |
|---|---|---|
| WP template hierarchy in React | `curl :3001/incidents/incident-01` | rendered by `wp-templates/single-incident.js` with no route file — TRUE |
| Data layer: Apollo, coupled | `grep -rn '@apollo/client' faust-spike/` | the transport under every layer; not swappable |
| `revalidateTag` / on-demand ISR | `grep -rn 'revalidateTag' faust-spike/` | no hits, and no call site to add one — measured properly in 17.3 |
| App Router currency | `npm view @faustwp/core version time.modified peerDependencies` | (write the version, the date and the peer ranges you saw) |
| Licence (Lesson 07.1 §9) | `npm view @faustwp/core license` | (write exactly what it printed) |

Two round trips before first byte, because the seed query must resolve the URI before the
template's own query can run. This app's routes answer the same question from the file system.
```

**Verify §8:**

- [ ] Every "What I saw" cell holds something you observed, and the three parenthesised cells are
      replaced with real values. A scorecard you filled in from a lesson body is not evidence.
- [ ] `git status --short` shows `faust-spike/` and `docs/architecture.md` as changes, and shows
      **nothing** under `next-app/`.
- [ ] `git add faust-spike docs/architecture.md && git commit -m "spike(faust): evaluate Faust.js as a sibling app on 3001"`.
      One commit for the spike, so Lesson 17.4 can delete the directory and still point at it.

---

## Verification

```bash
cd "$(git rev-parse --show-toplevel)"
# `npm run dev` running in next-app/ AND in faust-spike/, in two terminals.

# 1. Both applications are up, on their own ports
curl -s -o /dev/null -w 'own    %{http_code}\n' http://localhost:3000/en/incidents/incident-01
curl -s -o /dev/null -w 'faust  %{http_code}\n' http://localhost:3001/incidents/incident-01
# Expected: own 200
#           faust 200

# 2. Both render the SAME seeded incident, from the same WordPress
curl -s http://localhost:3000/en/incidents/incident-01 | grep -c 'Deployed on a Friday'
curl -s http://localhost:3001/incidents/incident-01    | grep -c 'Deployed on a Friday'
# Expected: a non-zero count from each. Same content, two front ends, one CMS.

# 3. The Faust template resolved WITHOUT a route file. This is the capability.
curl -s http://localhost:3001/incidents/incident-01 | grep -c 'wp-templates/single-incident.js'
# Expected: 1
ls faust-spike/pages/
# Expected: _app.js  [...wordpressNode].js  api
#           One catch-all file for the whole site. No incidents/ directory exists.

# 4. The two payloads, side by side. Lesson 17.3 turns this into the real table.
curl -s http://localhost:3000/en/incidents/incident-01 > /tmp/btt-own.html
curl -s http://localhost:3001/incidents/incident-01    > /tmp/btt-faust.html
wc -c /tmp/btt-own.html /tmp/btt-faust.html
# Expected: two byte counts. Do not interpret them yet — Lesson 17.3 measures
#           first-byte content and client JS weight separately, because a bigger
#           HTML file can mean more content OR more inlined framework payload.

# 5. The licence answer is recorded, not remembered
npm --prefix faust-spike view @faustwp/core license
# Expected: a licence field — write whatever it says into the ADR in Lesson 17.4.
#           If it is GPL or AGPL, note that the spike living OUTSIDE next-app/ is
#           what made running it safe at all (Lesson 07.1 §9).

# 6. NEGATIVE — the spike is not in next-app, in either file that would prove it
grep -c '@faustwp' next-app/package.json
# Expected: 0
grep -c '@faustwp\|@apollo/client' next-app/package-lock.json
# Expected: 0

# 7. NEGATIVE — there is no Faust route inside the app you ship
test ! -d next-app/src/app/faust && echo 'no faust route: correct'
# Expected: no faust route: correct
grep -c 'faust' next-app/src/middleware.ts
# Expected: 0. The matcher was NOT edited. Lesson 15.5 §4 is intact.

# 8. NEGATIVE — next-app's manifest and lockfile are byte-identical to Step 1
shasum -a 256 next-app/package.json next-app/package-lock.json > /tmp/btt-lockfile-after.txt
diff /tmp/btt-lockfile-before.txt /tmp/btt-lockfile-after.txt && echo 'lockfile untouched'
# Expected: lockfile untouched
#           A diff here means you ran npm install in the wrong directory. That is
#           the failure the sibling-app decision exists to prevent, and it is not
#           recoverable by `npm uninstall` — you would restore from git.

# 9. NEGATIVE — next-app's suites are still green, proving the spike touched nothing
cd next-app && npm test -- --run && npx playwright test --project=smoke; cd ..
# Expected: all Vitest tests pass; the smoke project passes.
#           Nothing in this lesson could have changed either. That is the claim.

# 10. NEGATIVE — deleting the spike's dependency tree breaks nothing in next-app
#     This kills the :3001 dev server. Restart it after the reinstall; checks
#     1-4 above are already done and nothing below needs port 3001.
rm -rf faust-spike/node_modules
cd next-app && npm run type-check && npm run lint; cd ..
# Expected: both succeed. Two dependency trees, no shared resolution.
cd faust-spike && npm ci; cd ..
# Expected: the spike reinstalls from its own lockfile. Reversible, in both directions.

# 11. NEGATIVE — the Faust app is not reachable on 3000
curl -s http://localhost:3000/incidents/incident-01 -o /dev/null -w '%{http_code} %{redirect_url}\n'
# Expected: 307 http://localhost:3000/en/incidents/incident-01
#           next-app's middleware normalised the missing locale. It did NOT serve
#           the Faust template, because the Faust app is a different process on a
#           different port and shares nothing with this one.

# 12. NEGATIVE — WordPress still answers the endpoint sixteen modules depend on
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ generalSettings { title } }"}' | jq -r '.data.generalSettings.title'
# Expected: Blame The Tech
#           Activating faustwp added a plugin. It did not take over /graphql.

# 13. The one thing activation DID change, captured for Lessons 17.2 and 17.4
cd wordpress-headless
docker compose run --rm wpcli wp eval '
  $p = get_page_by_path( "incident-01", OBJECT, "incident" );
  echo get_preview_post_link( $p->ID ) . PHP_EOL;'
# Expected: a URL. Compare it with the value you wrote down in Step 4 BEFORE
#           activation. If it now points at :3001, the faustwp plugin has filtered
#           preview_post_link — which is exactly the hook Lesson 17.2 needs, and
#           Lesson 17.2 Step 4 is where you make yours win.
```

If check 8 shows a diff, stop and restore `next-app/package.json` and
`next-app/package-lock.json` from git before doing anything else. Everything else in this module
assumes those two files are untouched, and Lesson 17.4's deletion is only clean because they are.

## Control Questions

1. The seed query is one extra round trip on every uncached request. Name the one route in
   `next-app` that already pays the same cost for the same reason, say why it is correct there, and
   say what makes it wrong as a default for every route.
2. Faust requires `NEXT_PUBLIC_WORDPRESS_URL`. Explain why that is a *consequence* rather than a
   *mistake*, then name the two properties of this application that would be lost the moment the
   browser could reach `/graphql` directly.
3. You could have put the spike in `next-app/src/app/(faust)/`. Give the three separate reasons
   that fails, and say which of the three would have been the hardest to undo.
4. Apollo's `InMemoryCache` and Next's Data Cache are both caches. State the one question you can
   ask of the second that you cannot ask of the first, and say which module's headline feature
   depends on the answer.
5. Activating the `faustwp` plugin changed the value of `get_preview_post_link()`. Nothing in
   `next-app` broke. Explain why not, and describe the one scenario in which that same change would
   have broken something for a real editor.

## Learn More

- [Faust.js documentation](https://faustjs.org/) — the source of truth for `faust.config.js`,
  `wp-templates/` and `getWordPressProps()`; read the "Templates" and "Blueprints" pages before
  you form an opinion about the framework
- [The `faustwp` plugin on WordPress.org](https://wordpress.org/plugins/faustwp/) — the changelog
  is the honest maintenance-status signal, and the "Settings" section documents `frontend_uri` and
  the secret key you copied in Step 4
- [`@faustwp/core` on npm](https://www.npmjs.com/package/@faustwp/core) — where Step 2's version,
  publish date, licence and peer ranges actually come from; check it yourself rather than trusting
  any course
- [WordPress template hierarchy](https://developer.wordpress.org/themes/classic-themes/basics/template-hierarchy/)
  — the chart Faust's `wp-templates/` keys reproduce; worth re-reading with the Faust key names
  beside it
- [`template-loader.php` in Trac](https://core.trac.wordpress.org/browser/trunk/src/wp-includes/template-loader.php)
  — forty lines that explain why the classic hierarchy costs nothing and Faust's costs a round trip
- [WPGraphQL `nodeByUri`](https://www.wpgraphql.com/docs/wpgraphql-vs-wp-rest-api#uri-based-lookups)
  — the query the seed query is; useful when you need to debug a URI that resolves to the wrong
  `__typename`
- [Apollo Client: normalized caching](https://www.apollographql.com/docs/react/caching/overview)
  — read the "Data normalization" section, then ask yourself where a server-side webhook would
  attach; that absence is Key Concept 6
- [Next.js: Pages Router `getStaticProps`](https://nextjs.org/docs/pages/building-your-application/data-fetching/get-static-props)
  — the API `getWordPressProps()` wraps, and the reason Faust's shape has no place to put a cache tag
- [Spike solutions, Extreme Programming](http://www.extremeprogramming.org/rules/spike.html) — two
  paragraphs, written in 1999, and still the clearest statement of why the deliverable of a spike
  is a decision rather than code
- [`license-checker`](https://www.npmjs.com/package/license-checker) — the tool behind Step 2's
  summary and the CI gate Module 24 builds from it
