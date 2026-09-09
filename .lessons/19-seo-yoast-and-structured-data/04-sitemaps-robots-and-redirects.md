---
title: 'Sitemaps, Robots & Redirects'
module: 19
lesson: 4
teaches: [next-sitemap, next-robots, canonical-host, trailing-slash, wordpress-sourced-redirects]
produces: ['next-app/src/app/sitemap.ts', 'next-app/src/app/robots.ts', 'next-app/src/app/icon.svg', 'next-app/next.config.ts']
requires: [19.2, 18.2]
---

# Lesson 19.4 — Sitemaps, Robots & Redirects

## Quick Overview

Three site-level files decide whether crawlers can find and trust your content, and all three
are the kind of thing that gets set up once, wrongly, and then produces mysterious traffic
losses for a year. `app/sitemap.ts` and `app/robots.ts` are Next.js file conventions that
export functions and produce `/sitemap.xml` and `/robots.txt`. Redirects are the harder
problem, because they are *content*: when an editor changes a slug, someone has to remember
that the old URL still exists in Google's index and on somebody's Slack message from 2019.

The core decision in this lesson is **who owns the sitemap**. Yoast already generates one, at
`/sitemap_index.xml` on the WordPress host — which is the wrong host, listing the wrong URLs,
split across paginated sub-sitemaps. You have two honest options: proxy it through a Next route
handler and rewrite every URL, or regenerate it from WPGraphQL. This course regenerates,
because the sitemap must reflect *your* routing (locale prefixes from Module 20, the
`/blog` rewrite base, the `[...slug]` catch-all) and because rewriting XML you did not
generate is a maintenance tax with no upside. The same logic decides the redirect question:
you source permanent redirects from a WordPress-managed list so editors can add one without a
deploy, then
serve them from `next.config.ts` — or from middleware, if the list is long enough that
bundling it stops being reasonable.

By the end of this lesson you will have:

- `src/app/sitemap.ts` — generated from WPGraphQL, with `lastModified` from `modifiedGmt`, split
  into multiple sitemaps if the entry count justifies it
- `src/app/robots.ts` — allowing crawl of the public site, disallowing `/api/`, and pointing at
  the sitemap
- A decided and documented canonical host, with `www` vs apex resolved in exactly one place
- A trailing-slash rule (`trailingSlash: false`) and the redirect that enforces it
- A redirect table read from WordPress, applied as **308s** — `redirects()` never emits a 301,
  and Google treats the two identically — with a fallback for when the fetch fails
- Proof that `/wp-admin`, `/graphql` and the WordPress origin are not linked, indexed or listed

## Classic WP Analogy

You already know the pieces; they were just distributed differently.

| Classic WordPress | Headless with Next.js |
|---|---|
| Yoast writes `/sitemap_index.xml` | `app/sitemap.ts` returns an array of `MetadataRoute.Sitemap` entries |
| A physical or virtual `robots.txt` | `app/robots.ts` returns rules and a `sitemap` URL |
| Redirection plugin table in the DB | A WP-managed list read at build/revalidate time, served from `next.config.ts` |
| `.htaccess` `RewriteRule` | `redirects()` and `rewrites()` in `next.config.ts`, or `middleware.ts` |
| `home_url()` decides the canonical host | `metadataBase` and `NEXT_PUBLIC_SITE_URL` decide it |
| WordPress adds trailing slashes to permalinks by default | `trailingSlash` is a config flag you must choose deliberately |

Two places the analogy breaks, and both bite in production.

**Trailing slashes.** WordPress permalinks end in `/` by default and `redirect_canonical()`
quietly fixes anything that doesn't. Next.js has no such thing. If `/incidents/dns` and
`/incidents/dns/` both render 200, you have duplicated your entire site for a crawler, and no
amount of correct canonicals fully undoes that. Pick one form, set `trailingSlash`, and let
Next 308 the other — and if you are migrating from a Classic site whose URLs *did* end in `/`,
that choice is already made for you.

**Redirects are not code.** The Redirection plugin let an editor fix a broken link at 4pm on a
Friday. A hand-maintained array in `next.config.ts` requires a pull request, a review and a
deploy — so it stops getting maintained, and then the 404s come back. Keeping the list in
WordPress preserves the workflow the team actually had. The cost, stated plainly: the redirect
list is now a network dependency of your build, so it needs a cached fallback and a "the fetch
failed, serve no redirects rather than crash" branch.

---

## Key Concepts

### 1. Two file conventions that return data instead of writing files

`app/sitemap.ts` and `app/robots.ts` export a function. Next calls it, serialises the return
value, and serves `/sitemap.xml` and `/robots.txt` with the right content type. You never write
XML and you never write a route handler.

| | Classic WordPress | Next file convention |
|---|---|---|
| `/robots.txt` | a real file, or a virtual one via the `robots_txt` filter | `app/robots.ts` returning `MetadataRoute.Robots` |
| `/sitemap.xml` | Yoast writes `/sitemap_index.xml` plus paginated children | `app/sitemap.ts` returning `MetadataRoute.Sitemap` |
| Escaping and namespaces | the plugin's problem | Next's problem |
| Where the URL list comes from | `WP_Query` inside WordPress | your own GraphQL reads, over the network |
| What decides the URLs | WordPress's rewrite rules | **your router** |

That last row is the whole reason this lesson exists. The URLs in your sitemap are the ones your
`app/` directory serves, and WordPress has never heard of `[locale]` or `[...slug]`.

Both files sit at `src/app/`, **outside** the `[locale]` segment, because `/sitemap.xml` and
`/robots.txt` are single URLs for the whole site rather than one per locale. That placement is
also safe, for a reason worth stating precisely — see Key Concept 10.

### 2. Who owns the sitemap

Yoast already generates one. Enumerate what is actually wrong with it before deciding, because
"the plugin already does this" is a real argument:

| Yoast's sitemap | Consequence |
|---|---|
| URLs built from `home_url()` | every entry is on `localhost:8080`, or your Fly.io hostname |
| No `[locale]` prefix | every path is a `307` on your site — Lesson 19.2 Key Concept 5, again |
| Split into paginated sub-sitemaps under an index | a shape you would have to reproduce or flatten while rewriting |
| Includes whatever WordPress publishes | including post types and archives your front end does not route |
| Unreachable from outside wp-admin here | the `btt-headless` theme redirects front-end requests (Lesson 02.4), so the sitemap may not even resolve — Task §1 measures it |

Two honest options:

| Option | What it costs | Verdict |
|---|---|---|
| **Proxy and rewrite.** A route handler fetches `/sitemap_index.xml`, follows the children, and string-replaces hosts and paths | XML parsing you did not write, on a document shape a plugin update can change, plus a path-rewriting function that is a duplicate of your router — and in this stack you would first have to add a pass to the theme's redirect so the XML is fetchable at all | ❌ |
| **Regenerate from WPGraphQL.** Query slugs and modification dates, build the entries from your own route shapes | four GraphQL reads and about eighty lines, and the URL list is generated by the same code that knows the routes | ✅ |

**The verdict: regenerate.** The cost, stated plainly: a route you add without adding a sitemap
entry is invisible to a crawler, and nothing warns you. Yoast's version would at least have
listed everything WordPress publishes. That trade is worth taking because a complete list of
wrong URLs is worse than an incomplete list of right ones.

A useful consequence: once you regenerate, Yoast's XML sitemap becomes dead weight you may as
well switch off — **and that is a decision for after you have seen yours work**, which is why
Lesson 19.1 deliberately left the setting alone.

### 3. `lastModified`, and the splitting threshold you are not going to need

`lastModified` comes from `modifiedGmt`, which is the closest thing WordPress has to "when did
this page's content last change". Two details:

- WPGraphQL's `*Gmt` fields are GMT **without** an offset marker (`2024-09-02T08:00:00`), so a
  `Date` built from one is a valid instant only once you append the `Z` WordPress omits. Lesson
  19.3's `isoInstant()` already does exactly this, and the sitemap reuses it.
- A **term** has no modification date at all. `wp_term_taxonomy` does not store one. So
  scapegoat pages get an entry with no `lastModified` key — omitted, not invented. An invented
  date is a lie a crawler will act on.

The limits are 50,000 URLs and 50 MB uncompressed per sitemap file, and `generateSitemaps` is the
mechanism for splitting: export it alongside the default function, return an array of ids, and
Next serves `/sitemap/0.xml`, `/sitemap/1.xml` and an index.

**You are not going to use it.** Forty incidents, ten posts, eight reviews, three pages and ten
terms is seventy-one URLs. Building splitting for seventy-one URLs is a mechanism with no user,
and the honest engineering is to name the threshold and the tool and stop. Where the line
actually is: reach for `generateSitemaps` when a single generated file crosses about 10,000
entries, because that is when the build-time cost of enumerating them starts to matter more than
the file size does.

The related cap is subtler and worth checking: every one of these queries has a `first:`
argument, and `first: 100` on a site with 3,000 incidents silently produces a sitemap listing
100 of them. **The pagination limit is the real ceiling, not the 50,000-URL spec limit**, and it
fails quietly. Task §3 sets the numbers against the seed counts and says which line to change.

### 4. One locale today, and why the sitemap is the wrong place to guess

`sitemap.ts` sits outside `[locale]`, so unlike a page it does not receive a locale — it has to
iterate the locale list itself. Today that list has one entry.

```ts
// (illustration) — the line Lesson 20.4 changes
const LOCALES = ['en'];
```

Module 20 adds `uk` and `de`, along with the translated content that justifies them and the
`alternates` cluster that makes them discoverable. **This lesson emits `en` only, and says so in
prose and in a comment**, for a specific reason: a sitemap entry for `/de/incidents/dns-ausfall`
before that URL exists is an invitation to crawl a 404, and `alternates.languages` on a sitemap
entry whose siblings do not exist is a false claim of the exact kind Lesson 19.3 Key Concept 3
forbids. Half-built multi-locale support is worse than none.

### 5. Trailing slashes, and the duplicate site you can create by accident

WordPress permalinks end in `/`. `redirect_canonical()` quietly fixes anything that does not, so
in fifteen years of WordPress you have probably never thought about it. Next has no such
function.

```
   WordPress                         Next.js, with no decision made
   /incidents/dns/     200           /en/incidents/dns      200
   /incidents/dns      301 → /       /en/incidents/dns/     ← what happens here?
        ▲                                   ▲
   redirect_canonical()             nothing, unless trailingSlash says so
```

If both forms return `200` you have **two URLs for every page on the site**, and a crawler will
find both. Correct canonicals help and do not fully undo it: link equity splits, crawl budget
halves, and Search Console reports "Duplicate, Google chose a different canonical" on pages you
were sure were fine.

`trailingSlash: false` is Next's **default**, and this lesson sets it explicitly anyway. That is
not redundancy:

- A default you rely on and never state is a decision nobody made, and the next person to open
  `next.config.ts` cannot tell whether it was considered.
- The value is load-bearing elsewhere: every canonical `yoastToMetadata` builds, every sitemap
  entry, and every `href` in the nav assumes no trailing slash. Flipping this one key would make
  all three wrong at once.

And note what "the enforcing redirect" actually is: **Next already emits it.** With
`trailingSlash: false`, a request for `/en/incidents/incident-01/` is answered with a **308** to
the slash-free form. There is nothing to add to `redirects()` for this, and adding a hand-written
rule would be a second mechanism for the same job.

If you are migrating a Classic site whose URLs *did* end in `/`, the choice is already made for
you: set `trailingSlash: true`, and then the sitemap, the canonicals and the nav all have to
agree with it.

### 6. The canonical host, resolved in exactly one place

`www.example.com` and `example.com` are different hosts, and if both serve the site you have
duplicated it again — the same failure as trailing slashes, one level up.

| Decision | Where it is expressed | Who enforces it |
|---|---|---|
| Which host is canonical | `NEXT_PUBLIC_SITE_URL`, and nowhere else | `metadataBase`, `sitemap.ts`, `robots.ts` — all three read it |
| Redirecting the other host | your DNS and hosting layer, **not** application code | Vercel domain settings (Lesson 24.7) |
| Which protocol | `https` in production; `http` on `localhost` is correct and the lessons do not pretend otherwise | the platform |

**The verdict: apex.** `blamethe.tech`, not `www.blamethe.tech`, because there is no
cookie-scoping reason to prefer `www` here (no separate static hostname, no subdomain estate) and
a shorter canonical is a smaller thing to get wrong. The important half is not which one you
pick, it is that the host appears **once** in the codebase. Grep for it: after this module,
`NEXT_PUBLIC_SITE_URL` is read in `originsFromEnv()`, in the root layout's `metadataBase`, in
`sitemap.ts` and in `robots.ts`, and there is no literal hostname anywhere.

The host-redirect belongs at the platform, not in `redirects()`, and the reason is that a
platform redirect happens before your application starts and costs nothing, while an application
redirect requires the request to reach a serverless function first. Put a rule in `redirects()`
for it and you pay a cold start to say "go somewhere else".

### 7. Redirects are content, not code

The Redirection plugin let an editor who renamed a slug at 4pm on a Friday fix the old URL
themselves, in the admin, in thirty seconds. A hand-maintained array in `next.config.ts`
requires a branch, a pull request, a review and a deploy.

Follow what actually happens next, because it is not "the process is a bit slower":

```
   an editor renames a slug
        │
        ├─ Redirection plugin:  they add the redirect. Done. 30 seconds.
        │
        └─ array in next.config.ts:
              they file a ticket ──▶ it is triaged ──▶ someone opens a PR ──▶
              review ──▶ deploy ──▶ … or the ticket is closed as low priority
                                       │
                                       ▼
                        the redirect never gets added, and it stops
                        being anybody's job, and the 404s come back
```

The mechanism is not the problem; **the ownership is.** So the list lives in WordPress, where the
person who caused the change can fix it, and Next reads it.

The cost, stated plainly: **the redirect list is now a network dependency of your build.** That
is a real regression in build reliability, and it needs two things — a timeout, so a hanging
WordPress does not hang CI, and a fail-soft branch that serves *no* redirects rather than failing
the build. An extra 404 is a bad afternoon; a build that cannot ship is a bad week.

### 8. Where the list is stored, and why it is an options-page repeater

Nothing in the course has created a redirect store, so this is a decision:

| Option | Cost | Verdict |
|---|---|---|
| The Redirection plugin | a large plugin with its own tables, its own REST API and a UI built for a rendering WordPress; you would consume it through a custom endpoint | ❌ too much surface for three fields |
| A custom post type | one post per redirect, revisions, an editor screen — and a `WP_Query` to read them | ❌ a redirect is not content with a body |
| **A `btt_redirects` repeater on the Site Settings options page** | one JSON edit to Module 04's field group; values land in one `wp_options` row; exposed on the GraphQL root query the layout already uses | ✅ |

**The verdict: the options-page repeater**, because Lesson 04.3 already established
`acf_add_options_page()` and repeaters, the field group is already `show_in_graphql`, and three
fields — `from`, `to`, `permanent` — is the whole model.

Lesson 04.3's own warning applies and is worth repeating: an options page loads as **one
serialized `wp_options` row**, so a 200-row repeater is a tax on every request that touches
site settings. That is the reversal condition. Past a few dozen redirects, move the list to its
own store and read it with a query that can paginate.

> **Do not add `bttRedirects` to the `SiteChrome` query.** `SiteChrome` runs in the root layout on
> every render, and the redirect table is build-time-only data that nothing on the page displays
> — the exact overfetch Lesson 10.5 §6 taught you to audit for. `next.config.ts` reads it with its
> own request, which it has to anyway (Key Concept 9).

### 9. `next.config.ts` runs outside the Next runtime, and `redirects()` runs at build time

Two facts about that file, and both change what you may write in it.

**It is a plain Node module, evaluated by the Next CLI.** No `@/` path alias, no
`import 'server-only'`, no `fetchGraphQL`. So the redirect fetch is a **raw `fetch` with a
hand-written query string** — the second and last place in the course that is correct, after
`/api/health` in Lesson 09.5, and for the same reason: the code runs where the typed client does
not exist.

**`redirects()` is evaluated once, at build time.** This is the sharpest point in the lesson: an
editor who adds a redirect does not get it until the next build.

```
   build time                                    request time
   ┌────────────────────────────┐                ┌──────────────────────────┐
   │ next build                 │                │ every request            │
   │  └ redirects() runs ONCE   │                │  └ the compiled rule set │
   │     fetch WordPress        │                │     is matched — no I/O  │
   │     compile to a rule set  │                │                          │
   └────────────────────────────┘                └──────────────────────────┘
     an editor's 4pm redirect lands ──────────────────▶ at the NEXT build
```

The alternative is middleware: a lookup on every request, or a cached list held in memory per
instance. Its costs are real and different.

| | `redirects()` at build time | `middleware.ts` at request time |
|---|---|---|
| Latency per request | none — the rule set is compiled | a map lookup, or a fetch on a cold instance |
| Editor's change is live | at the next build | within the cache TTL |
| List size limit | it is in the bundle; hundreds is fine, tens of thousands is not | bounded by memory, not bundle size |
| Staleness | bounded by deploy frequency | bounded per instance, so two instances can disagree |
| Failure mode | a bad fetch is a build-time decision you control | a bad fetch is a request-time decision under load |

**The verdict: build time, for this list.** Where the line is: move to middleware when the list
outgrows a few hundred entries, **or** when "live within minutes" becomes a requirement — and if
you do, the cache is a `revalidateTag`-driven read using the tag vocabulary from Module 18, not a
bare in-memory map. And note the constraint that decides it for you here: Lesson 15.5 froze
`middleware.ts` at zero `fetch` calls, and `grep -c 'fetch(' src/middleware.ts` returning `0` is
an assertion Module 20 still relies on.

Two more details that bite:

- **`permanent: true` emits a 308, not a 301.** Next's `redirects()` uses 308 for permanent and
  307 for temporary, both of which preserve the request method. Google treats 301 and 308
  identically for canonicalisation, so 308 is the right default; `statusCode: 301` is available
  per-rule if something in your estate mishandles 308. This is a different status from Lesson
  09.5's middleware redirects, which are 307 because that is `NextResponse.redirect()`'s default.
- **A redirect whose `source` equals its `destination` is an infinite loop.** Validate it, in
  code, before the rule reaches the config — an editor typing the same path into both fields is
  not a hypothetical.

### 10. `robots.ts`, and the extension rule that decides where a public file lives

`robots.txt` does one job: it tells a crawler what not to **fetch**. It says nothing about
indexing, and conflating the two is the most common robots mistake there is.

| | `Disallow` in `robots.txt` | `<meta name="robots" content="noindex">` |
|---|---|---|
| Stops the page being fetched | ✅ | ❌ |
| Stops the page being indexed | **❌** | ✅ |
| Works on a page reachable only by an external link | it is not fetched, and can still be indexed from the link text | ✅ |
| Can be seen by a crawler that was disallowed | — | **no — it never fetched the page to read the tag** |

The third and fourth rows are the trap: a page you `Disallow` **and** mark `noindex` stays
indexed forever, because the crawler cannot fetch the page to discover the `noindex`. Choose one
per URL. This site does: `/api/` is disallowed because nothing there should ever be fetched by a
crawler, and the authenticated routes are `force-dynamic` behind a session, so they are
unreachable rather than merely discouraged.

What `robots.ts` must **not** do is mention the WordPress origin. Not as a `Sitemap:` line, not
in a comment, not anywhere — the whole point of Lesson 02.4's redirect and Module 24's hardening
is that `localhost:8080`, or its production equivalent, is not a thing a crawler should learn
about from you.

Finally, the placement rule, which this lesson gets to demonstrate twice in the same directory.
Lesson 19.2 moved `opengraph-image.tsx` **into** `[locale]/` because the path has no file
extension and Lesson 09.5's matcher `/((?!api|_next|favicon\.ico|.*\..*).*)` therefore selects
it. The three files here go the other way:

```
   src/app/sitemap.ts   →  /sitemap.xml   has a dot  →  matcher EXCLUDES it  →  root is correct
   src/app/robots.ts    →  /robots.txt    has a dot  →  matcher EXCLUDES it  →  root is correct
   src/app/icon.svg     →  /icon.svg      has a dot  →  matcher EXCLUDES it  →  root is correct
   src/app/[locale]/opengraph-image.tsx  →  no dot   →  matcher MATCHES it   →  must be nested
```

Same directory, opposite answers, and the thing that decides it is a dot. **A public asset must
either carry a file extension or live under a real route segment** — which is cheaper to remember
than an exception in a regex that three modules have agreed not to edit, and it is the reason
`/robots.txt` resolves without a locale prefix at all.

---

## Task

### Step 1: Settle the Yoast sitemap question you deferred in Lesson 19.1

You measured who answers `/sitemap_index.xml` in Lesson 19.1 Task §2 and wrote the answer down.
Now that you are about to generate your own, Yoast's is dead weight — and worse, a second sitemap
on a host you do not want crawled.

```bash
cd wordpress-headless

# 1. The current state of the setting, before you touch it.
docker compose run --rm wpcli wp option get wpseo --format=json | jq '.enable_xml_sitemap'
# Expected: true (or 1)
```

Turn it off in the UI rather than by patching the option, because Yoast validates its whole
option array on save and a hand-patched key can be silently coerced back:
`http://localhost:8080/wp-admin/admin.php?page=wpseo_page_settings` → **Site features** → switch
**XML sitemaps** off → **Save changes**.

```bash
# 2. Confirm it from the option, not from the screen.
docker compose run --rm wpcli wp option get wpseo --format=json | jq '.enable_xml_sitemap'
# Expected: false (or 0)

# 3. And confirm it from the outside.
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/sitemap_index.xml
# Expected: 404, or a 302 to :3000 from the btt-headless theme redirect. Either
#           answer means Yoast is no longer publishing a sitemap.
```

**Verify §1:**

- [ ] The option reads `false`.
- [ ] Nothing in `next-app/` changed. This step is entirely WordPress-side.
- [ ] You have **not** turned off Yoast's meta output, its analysis, or anything else. Only the
      sitemap, and only because you are replacing it in Step 4.

### Step 2: Add the `btt_redirects` repeater to Module 04's field group

An **edit** to `group_site_settings.json`, so not a `produces:` entry. Three sub-fields is the
whole model (Key Concept 8). Insert this object into the `fields` array, immediately after
`field_settings_social_links`:

```json
{
	"key": "field_settings_btt_redirects",
	"label": "Redirects",
	"name": "btt_redirects",
	"type": "repeater",
	"instructions": "Old path -> new path. Applied at BUILD time by next.config.ts, so a new row goes live at the next deploy. Both paths start with a slash. Keep this list under a few dozen rows: an options page loads as one serialized wp_options row.",
	"required": 0,
	"conditional_logic": 0,
	"wrapper": { "width": "", "class": "", "id": "" },
	"layout": "table",
	"pagination": 0,
	"min": 0,
	"max": 50,
	"collapsed": "",
	"button_label": "Add redirect",
	"rows_per_page": 20,
	"sub_fields": [
		{
			"key": "field_settings_btt_redirects_from",
			"label": "From",
			"name": "from",
			"type": "text",
			"instructions": "The old path, starting with a slash. Include the locale prefix: /en/blog/old-slug",
			"required": 1,
			"conditional_logic": 0,
			"wrapper": { "width": "40", "class": "", "id": "" },
			"default_value": "",
			"maxlength": 500,
			"parent_repeater": "field_settings_btt_redirects"
		},
		{
			"key": "field_settings_btt_redirects_to",
			"label": "To",
			"name": "to",
			"type": "text",
			"instructions": "The new path, starting with a slash — or a full https:// URL to send traffic off-site.",
			"required": 1,
			"conditional_logic": 0,
			"wrapper": { "width": "40", "class": "", "id": "" },
			"default_value": "",
			"maxlength": 500,
			"parent_repeater": "field_settings_btt_redirects"
		},
		{
			"key": "field_settings_btt_redirects_permanent",
			"label": "Permanent",
			"name": "permanent",
			"type": "true_false",
			"instructions": "On = 308 (permanent). Off = 307 (temporary). Both preserve the request method.",
			"required": 0,
			"conditional_logic": 0,
			"wrapper": { "width": "20", "class": "", "id": "" },
			"message": "",
			"default_value": 1,
			"ui": 1,
			"ui_on_text": "308",
			"ui_off_text": "307",
			"parent_repeater": "field_settings_btt_redirects"
		}
	]
}
```

Then bump the group's `modified` timestamp at the bottom of the file, so ACF notices:

```json
	"modified": 1750000000
```

Open `http://localhost:8080/wp-admin/admin.php?page=btt-site-settings`, add two rows, and press
**Update**:

| From | To | Permanent |
|---|---|---|
| `/en/blog/the-old-slug` | `/en/blog/blog-01` | on |
| `/en/incidents/legacy` | `/en/incidents` | off |

```bash
# The values land in the single wp_options row the options page owns.
docker compose run --rm wpcli wp option get options_btt_redirects
# Expected: 2 — ACF stores the row COUNT under the parent key and each cell under
#           options_btt_redirects_0_from and so on. That shape is why Key Concept 8
#           caps the list at a few dozen.
```

**Verify §2:**

- [ ] The **Redirects** table renders on the Site Settings screen with an "Add redirect" button.
      If it does not, your install synced this group to the database at some point — go to
      `edit.php?post_type=acf-field-group`, click **Sync** on Site Settings, and reload.
- [ ] `git diff` on `includes/acf-json/group_site_settings.json` shows the new field and the new
      `modified` value, and nothing else. That diff is the review artifact (Lesson 04.2 §4).
- [ ] Both rows are visible after a page reload — i.e. they saved.

### Step 3: Refresh the schema, and notice what does *not* change

```bash
cd ../next-app

# 1. The new field sits inside siteSettings.siteChrome, because it belongs to the
#    FIELD GROUP (graphql_field_name: siteChrome), not to the options page.
curl -s -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ siteSettings { siteChrome { bttRedirects { from to permanent } } } }"}' | jq '.'
# Expected: your two rows. `permanent` is a Boolean; `from` and `to` are Strings.

# 2. Commit the contract change.
npm run schema:pull
git diff ../wordpress-headless/schema.graphql | grep -E '^\+.*(bttRedirects|SiteChromeBttRedirects)'
# Expected: the new field and its generated repeater type

# 3. And now the interesting part: regenerate, and watch src/gql/ NOT change.
npm run codegen && npm run codegen:check
# Expected: no output. No document in src/graphql/ selects bttRedirects, so codegen
#           has nothing new to type — a schema change without a client change.
```

> **`bttRedirects` deliberately does not go into `SiteChrome`.** That document runs in the root
> layout on every render, and the redirect table is build-time-only data nothing on the page
> displays — the overfetch Lesson 10.5 §6 taught you to audit for. `next.config.ts` reads it with
> its own request in Step 6, which it has to anyway because it runs outside the Next runtime.

**Verify §3:**

- [ ] `grep -c 'bttRedirects' src/graphql/siteSettings.graphql` is `0`.
- [ ] `grep -c 'bttRedirects' ../wordpress-headless/schema.graphql` is `1` or more.
- [ ] `git status --short src/gql/` is empty. A schema pull that changes no generated code is a
      normal and healthy outcome.

### Step 4: Generate the sitemap

First, four one-line document edits so the slug queries carry a modification date. **Edits**, not
`produces:` entries.

```graphql
# next-app/src/graphql/incidents.graphql (fragment) — ONE line added to IncidentSlugs,
# which selects only `slug` today. Same edit in posts.graphql (PostSlugs),
# reviews.graphql (ReviewSlugs) and pages.graphql (PageUris).
      slug
      modifiedGmt
```

Then the file:

```ts
// next-app/src/app/sitemap.ts
// /sitemap.xml, generated from WPGraphQL. It sits OUTSIDE the [locale] segment
// because /sitemap.xml is one URL for the whole site — and that placement is safe
// because the path has a file extension, so Lesson 09.5's middleware matcher
// excludes it (Key Concept 10).
import type { MetadataRoute } from 'next';

import {
  IncidentSlugsDocument,
  PageUrisDocument,
  PostSlugsDocument,
  ReviewSlugsDocument,
  ScapegoatLeaderboardDocument,
} from '@/gql/graphql';
import { fetchGraphQL } from '@/lib/graphql/client';
import { listTag } from '@/lib/graphql/tags';
import { isoInstant } from '@/lib/seo/jsonLd';
import { originsFromEnv } from '@/lib/seo/yoastToMetadata';

// ONE locale. Lesson 20.4 iterates routing.locales and adds the `alternates`
// cluster; listing /de/... before that content exists would invite a crawl of a
// 404, and advertising a `de` alternate that does not exist is a false claim.
const LOCALES = ['en'] as const;

// First segments a dedicated route file owns, so a WordPress page at one of these
// URIs is unreachable through [...slug]. The same set as Lesson 14.4's RESERVED.
const RESERVED = new Set(['hobt', 'blog', 'incidents', 'reviews', 'scapegoats']);

// `first:` is the REAL ceiling, not the 50,000-URL spec limit (Key Concept 3).
// These numbers are the seed counts with headroom. Past a few thousand entries you
// need cursor pagination here, or generateSitemaps.
const PAGE_SIZE = 1000;

const settled = <T,>(result: PromiseSettledResult<T>): T | null =>
  result.status === 'fulfilled' ? result.value : null;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { siteUrl } = originsFromEnv();
  const url = (path: string): string => new URL(path, siteUrl).toString();

  // NO `priority` and NO `changeFrequency` anywhere below. Google has said for years
  // that it ignores both, so they are noise in a file whose only job is to be read
  // by a machine. `lastModified` IS used, which is why it is worth getting right.
  const staticEntries: MetadataRoute.Sitemap = LOCALES.flatMap((locale) =>
    ['', '/incidents', '/blog', '/reviews', '/scapegoats', '/hobt'].map((path) => ({
      url: url(`/${locale}${path}`),
    }))
  );

  // allSettled, not all: one WordPress hiccup should cost you a section of the
  // sitemap, not the whole file. An incomplete sitemap is a soft failure; a 500 on
  // /sitemap.xml is an error every crawler retries and logs.
  const [incidents, posts, reviews, pages, terms] = await Promise.allSettled([
    fetchGraphQL(IncidentSlugsDocument, { first: PAGE_SIZE }, { revalidate: 3600, tags: [listTag('incident')] }),
    fetchGraphQL(PostSlugsDocument, { first: PAGE_SIZE }, { revalidate: 3600, tags: [listTag('post')] }),
    fetchGraphQL(ReviewSlugsDocument, { first: PAGE_SIZE }, { revalidate: 3600, tags: [listTag('review')] }),
    fetchGraphQL(PageUrisDocument, { first: PAGE_SIZE }, { revalidate: 3600, tags: [listTag('page')] }),
    // NO TAG. tags.ts has termTag(taxonomy, slug) but no LIST tag for a taxonomy
    // (Lesson 10.3's vocabulary), so a brand-new scapegoat does not reach this file
    // until the 3600 s window elapses. Naming the gap beats hand-typing a tag
    // string, which Lesson 10.3 forbids outright.
    fetchGraphQL(ScapegoatLeaderboardDocument, { first: PAGE_SIZE }, { revalidate: 3600 }),
  ]);

  const entries: MetadataRoute.Sitemap = [...staticEntries];

  const push = (path: string, modified: string | null | undefined): void => {
    const iso = isoInstant(modified);
    // OMIT lastModified rather than invent one. An invented date is a lie a crawler
    // will act on: it re-fetches a page that has not changed and skips one that has.
    entries.push(iso === null ? { url: url(path) } : { url: url(path), lastModified: iso });
  };

  for (const locale of LOCALES) {
    for (const node of settled(incidents)?.incidents?.nodes ?? []) {
      if (node?.slug != null) push(`/${locale}/incidents/${node.slug}`, node.modifiedGmt);
    }
    for (const node of settled(posts)?.posts?.nodes ?? []) {
      if (node?.slug != null) push(`/${locale}/blog/${node.slug}`, node.modifiedGmt);
    }
    for (const node of settled(reviews)?.techReviews?.nodes ?? []) {
      if (node?.slug != null) push(`/${locale}/reviews/${node.slug}`, node.modifiedGmt);
    }
    for (const node of settled(terms)?.scapegoats?.nodes ?? []) {
      // A TERM has no modification date — wp_term_taxonomy does not store one — so
      // this entry has no lastModified. Key Concept 3.
      if (node?.slug != null) push(`/${locale}/scapegoats/${node.slug}`, null);
    }
    for (const node of settled(pages)?.pages?.nodes ?? []) {
      const segments = (node?.uri ?? '').split('/').filter((segment) => segment !== '');
      const first = segments[0];
      // length 0 is the front page, which [locale]/page.tsx owns and staticEntries
      // already lists. A RESERVED first segment is owned by a dedicated route file,
      // so [...slug] never renders it — listing it would advertise a URL that
      // resolves to a different page than the sitemap claims.
      if (segments.length === 0 || first === undefined || RESERVED.has(first)) continue;
      push(`/${locale}/${segments.join('/')}`, node?.modifiedGmt);
    }
  }

  return entries;
}
```

Routes deliberately **absent** from the sitemap, and why:

| Route | Why not |
|---|---|
| `/[locale]/login`, `/register`, `/verify` | forms, not content; nothing to rank |
| `/[locale]/account`, `/[locale]/incidents/submit` | behind a session, `force-dynamic`; a crawler gets a redirect |
| `/api/*` | not pages, and `robots.txt` disallows them in Step 5 |
| `/[locale]/opengraph-image` | an asset, referenced from `<head>`, not a destination |
| Anything on the WordPress origin | the entire point of Module 19 |
| `/uk/…`, `/de/…` | **Lesson 20.4.** The content does not exist yet |

**Verify §4:**

- [ ] `npm run type-check` is silent after the four document edits and `npm run codegen`.
- [ ] `npm run build` then `curl -s http://localhost:3000/sitemap.xml | head -5` shows an
      `<urlset>` opening tag.
- [ ] `curl -s http://localhost:3000/sitemap.xml | grep -c '<loc>'` is around 70 — six static
      entries, 40 incidents, 10 posts, 8 reviews, up to 10 terms and the non-reserved pages.
- [ ] Not one `<loc>` ends in `/`, because `trailingSlash` is `false` and Step 6 makes that
      explicit.

### Step 5: `robots.txt`

```ts
// next-app/src/app/robots.ts
// /robots.txt. Also outside [locale], also safe because the path has an extension.
//
// robots.txt controls FETCHING, not indexing (Key Concept 10). Every entry below is
// a path a crawler should not spend budget on, and NOT a path we are trying to keep
// out of the index — the noindex directives in Lesson 19.2 do that job, and a URL
// must never be given both.
import type { MetadataRoute } from 'next';

import { originsFromEnv } from '@/lib/seo/yoastToMetadata';

export default function robots(): MetadataRoute.Robots {
  const { siteUrl } = originsFromEnv();

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          // Route handlers. Nothing here is a page, and /api/revalidate and
          // /api/preview are signature-guarded endpoints (Modules 17 and 18).
          '/api/',
          // Locale-agnostic wildcards, so Module 20 needs no edit here.
          '/*/account',
          '/*/incidents/submit',
        ],
      },
    ],
    // Absolute, from the ONE place the public origin is decided (Key Concept 6).
    sitemap: new URL('/sitemap.xml', siteUrl).toString(),
    // NOTE what is absent: no Sitemap: line for the WordPress origin, no reference
    // to :8080 in any form. A robots.txt is a public document and it is a poor place
    // to tell the world where your CMS lives.
  };
}
```

**Verify §5:**

- [ ] `curl -s http://localhost:3000/robots.txt` prints `User-Agent: *`, the three `Disallow`
      lines and one `Sitemap:` line.
- [ ] The `Sitemap:` URL is on `:3000` and there is no second `Sitemap:` line.
- [ ] `curl -s http://localhost:3000/robots.txt | grep -c 8080` is `0`.

### Step 6: `next.config.ts` — `trailingSlash` and `redirects()`

**Two keys, added to the existing config object.** The file already holds `images`
(Lessons 09.1 and 14.5) and `async headers()` (Lesson 18.4). Do not retype it; add these.

```ts
// next-app/next.config.ts (fragment) — TWO new keys on the existing config object.
// The `images` block and `async headers()` are already there and do not move.

  // Already Next's default. Stated explicitly because a default you rely on and
  // never wrote down is a decision nobody made — and because every canonical from
  // Lesson 19.2, every <loc> in sitemap.ts and every nav href assumes it. Next
  // emits the enforcing 308 itself; there is nothing to add to redirects() for it.
  trailingSlash: false,

  async redirects() {
    // A RAW fetch and a hand-written query string, on purpose. next.config.ts is a
    // plain Node module evaluated by the Next CLI: no `@/` alias, no 'server-only',
    // no fetchGraphQL. This is the second and last place in the course where that is
    // correct — /api/health in Lesson 09.5 was the first, for the same reason.
    //
    // Evaluated ONCE, at build time. An editor's 4pm redirect goes live at the next
    // build. Key Concept 9 states the alternative and where the line is.
    const endpoint = process.env.WP_GRAPHQL_ENDPOINT;

    if (endpoint === undefined || endpoint === '') {
      console.warn('[redirects] WP_GRAPHQL_ENDPOINT is unset — serving no redirects.');
      return [];
    }

    type Row = { from?: unknown; to?: unknown; permanent?: unknown };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: '{ siteSettings { siteChrome { bttRedirects { from to permanent } } } }',
        }),
        // A hanging WordPress must not hang CI. The redirect list is a network
        // dependency of the build now, and this is half of what that costs.
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      // WPGraphQL answers 200 with an `errors` array, so read the body, never the
      // status — the same rule as everywhere else in the course.
      const payload = (await response.json()) as {
        data?: { siteSettings?: { siteChrome?: { bttRedirects?: Row[] | null } | null } | null };
        errors?: unknown[];
      };

      if (payload.errors !== undefined && payload.errors.length > 0) {
        throw new Error(`GraphQL errors: ${JSON.stringify(payload.errors)}`);
      }

      const rows = payload.data?.siteSettings?.siteChrome?.bttRedirects ?? [];

      const redirects = rows.flatMap((row) => {
        const source = typeof row.from === 'string' ? row.from.trim() : '';
        const destination = typeof row.to === 'string' ? row.to.trim() : '';

        // Validate at the boundary, because an editor typed this.
        //  · a source must be a path, or Next refuses the whole config
        //  · a destination is a path or an absolute http(s) URL
        //  · source === destination is an INFINITE LOOP, not a typo to tolerate
        if (!source.startsWith('/')) return [];
        if (!destination.startsWith('/') && !/^https?:\/\//.test(destination)) return [];
        if (source === destination) return [];

        // `permanent: true` emits 308, `false` emits 307 — NOT 301. Both preserve
        // the method, and Google treats 301 and 308 identically. Key Concept 9.
        return [{ source, destination, permanent: row.permanent === true }];
      });

      console.log(`[redirects] ${redirects.length} rule(s) from WordPress.`);
      return redirects;
    } catch (error) {
      // FAIL SOFT. Zero redirects and a successful build beats a build that cannot
      // ship. The warning is loud so the gap is visible in CI logs.
      console.warn(
        `[redirects] WordPress unreachable (${String(error)}) — serving no redirects rather than failing the build.`
      );
      return [];
    }
  },
```

**Verify §6:**

- [ ] `npm run build` prints `[redirects] 2 rule(s) from WordPress.`
- [ ] `grep -c 'async headers' next.config.ts` is `1` — Lesson 18.4's key is still there. If it
      is `0` you replaced the file instead of adding to it.
- [ ] `grep -c 'trailingSlash' next.config.ts` is `1`.
- [ ] Stop WordPress (`docker compose -f ../wordpress-headless/docker-compose.yml stop wordpress`)
      and build again. The build **succeeds** and prints the `[redirects] WordPress unreachable`
      warning. Start it again afterwards. Verification check 12 does this properly.

### Step 7: The icon set, and closing Lesson 12.3's allowlist

Lesson 12.3 shipped `e2e/smoke.spec.ts` with a `CONSOLE_ALLOWLIST` containing exactly one entry
and a comment naming this lesson as the one that deletes it. Chromium reports a missing
`/favicon.ico` as a console error, and there has been no icon until now.

```svg
<!-- next-app/src/app/icon.svg -->
<!-- Next's icon file convention: this file becomes <link rel="icon"> on every route.
     It lives at src/app/, OUTSIDE [locale], and that is correct for the opposite
     reason to opengraph-image.tsx — /icon.svg has a file extension, so Lesson 09.5's
     matcher `.*\..*` excludes it and no locale redirect ever touches it.
     Same directory, opposite answer, and the dot is what decides. Key Concept 10. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="Blame The Tech">
  <rect width="32" height="32" rx="6" fill="#0b1020" />
  <path d="M9 22 L16 8 L23 22 Z" fill="none" stroke="#f8fafc" stroke-width="2.5" stroke-linejoin="round" />
  <circle cx="16" cy="19" r="1.6" fill="#f8fafc" />
</svg>
```

> **No `favicon.ico`.** An `.ico` is a binary file, and a docs-first course cannot put one in a
> code fence honestly. `icon.svg` supersedes it for every browser that matters, because Next emits
> a `<link rel="icon">` and a browser with a declared icon never requests `/favicon.ico`. The
> cost, stated plainly: a handful of very old clients and some feed readers still ask for
> `/favicon.ico` unconditionally and will get a 404 — a line in your access log and nothing more.
> Add a real `.ico` at `src/app/favicon.ico` if that matters to you; the convention picks it up
> with no code change.

Now delete the allowlist entry, which is an **edit** to Lesson 12.3's file:

```ts
// next-app/e2e/smoke.spec.ts (fragment) — the whole entry and its comment are DELETED.
// The array goes back to EMPTY, which is where Lesson 12.3's doc comment said to start:
// "Start this array EMPTY. Run the suite. Read what comes out. Only then add."
// Deleting the last entry closes the loop that lesson opened.
const CONSOLE_ALLOWLIST: readonly RegExp[] = [];
```

```bash
npm run build
npx playwright test --project=smoke
# Expected: all specs pass with the allowlist EMPTY. That is the proof the icon
#           resolved — a much stronger check than fetching the icon yourself,
#           because it is the browser's own subresource request being satisfied.
```

**Verify §7:**

- [ ] `grep -c 'favicon' e2e/smoke.spec.ts` is `0`.
- [ ] `grep -A1 'CONSOLE_ALLOWLIST' e2e/smoke.spec.ts` shows an empty array.
- [ ] `curl -s http://localhost:3000/en | grep -o 'rel="icon"[^>]*'` shows a link to `/icon.svg`.
      If it shows nothing, your Next release resolves icon conventions only from the segment
      holding the root layout — move the file to `src/app/[locale]/icon.svg` and re-run. The
      extension argument above is unaffected either way.
- [ ] `npx playwright test --project=smoke` passes on all nine routes with **zero** allowed
      console errors.

### Step 8: Write the decisions down, then commit

Append to the `## The canonical host (Lesson 19.2)` section you started in Lesson 19.2 — it is
the same decision, finished:

```markdown
- **Apex, not `www`.** `NEXT_PUBLIC_SITE_URL` is `https://blamethe.tech`. The `www` host is
  redirected at the platform (Lesson 24.7), never in `redirects()`: a platform redirect happens
  before the application starts, an application redirect pays a cold start to say "go elsewhere".
- **`trailingSlash: false`,** stated explicitly in `next.config.ts` although it is Next's
  default. Every canonical, every `<loc>` in `sitemap.ts` and every nav `href` assumes it, and
  Next emits the enforcing 308 itself.
- **The sitemap is regenerated, not proxied.** Yoast's XML sitemap is switched off. The URL list
  is produced by the code that knows the routes; the cost is that a new route needs a new sitemap
  entry and nothing warns you.
- **Redirects live in WordPress** (`siteSettings.siteChrome.bttRedirects`) and are compiled into
  `next.config.ts` at build time. An editor's new redirect goes live at the next build. The fetch
  has a 5 s timeout and fails soft: no redirects, successful build.
```

```bash
npm run type-check && npm run lint && npm run test:run
git add -A
git commit -m "feat(next): sitemap, robots, trailing-slash rule and wordpress-sourced redirects"
```

**Verify §8:**

- [ ] `grep -c 'Apex, not' ../docs/architecture.md` is `1`.
- [ ] The section from Lesson 19.2 is still there. You appended; you did not replace.
- [ ] `git status --short` is clean, and the ACF JSON change is in the same commit as the code
      that consumes it. A field the front end reads and a field group that does not declare it
      are two halves of one change.

---

## Verification

```bash
cd next-app

# 1. Types, lint, unit tests
npm run type-check && npm run lint && npm run test:run
# Expected: no output from the first two; all unit tests pass

# 2. The two keys are in next.config.ts, and Lesson 18.4's is still there
grep -cE 'trailingSlash|async redirects|async headers' next.config.ts
# Expected: 3 — you ADDED two keys, you did not replace the file

# 3. A cold build, with the redirect list read from WordPress
rm -rf .next
npm run build 2>&1 | tee /tmp/btt-sitemap-build.log | grep -E '\[redirects\]|sitemap|robots'
# Expected: "[redirects] 2 rule(s) from WordPress." and /sitemap.xml plus /robots.txt
#           in the route table

npm run start > /tmp/btt-sitemap-start.log 2>&1 & SERVER_PID=$!
sleep 6

# 4. /sitemap.xml is served as XML and lists the seeded content
curl -s -o /dev/null -w '%{http_code}  %{content_type}\n' http://localhost:3000/sitemap.xml
# Expected: 200  application/xml
curl -s http://localhost:3000/sitemap.xml | grep -c '<loc>'
# Expected: around 70 — six static, 40 incidents, 10 posts, 8 reviews, the scapegoat
#           terms, and the non-reserved WordPress pages
curl -s http://localhost:3000/sitemap.xml | grep -c 'incidents/incident-01<'
# Expected: 1
curl -s http://localhost:3000/sitemap.xml | grep -c 'blog/blog-01<'
# Expected: 1
curl -s http://localhost:3000/sitemap.xml | grep -c 'reviews/review-01<'
# Expected: 1
curl -s http://localhost:3000/sitemap.xml | grep -c '<lastmod>'
# Expected: 58 or so — every node entry has one; the six static entries and the
#           scapegoat terms do not, because a term has no modification date

# 5. /robots.txt is plain text, disallows the API, and names exactly one sitemap
curl -s -o /dev/null -w '%{http_code}  %{content_type}\n' http://localhost:3000/robots.txt
# Expected: 200  text/plain
curl -s http://localhost:3000/robots.txt
# Expected: User-Agent: *, Allow: /, three Disallow lines, one Sitemap: line on :3000
curl -s http://localhost:3000/robots.txt | grep -c '^Sitemap:'
# Expected: 1

# 6. A configured redirect actually redirects, with the status Next emits
curl -s -o /dev/null -w '%{http_code}  %{redirect_url}\n' \
  http://localhost:3000/en/blog/the-old-slug
# Expected: 308  http://localhost:3000/en/blog/blog-01
#           308, NOT 301 — `permanent: true` in redirects() emits 308, and Google
#           treats the two identically for canonicalisation.
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/incidents/legacy
# Expected: 307 — the second row has `permanent` off

# 7. NEGATIVE — the trailing-slash form does NOT return 200. If it did, every page on
#    the site would have two URLs and a crawler would find both.
curl -s -o /dev/null -w '%{http_code}  %{redirect_url}\n' \
  http://localhost:3000/en/incidents/incident-01/
# Expected: 308 and a redirect_url with NO trailing slash. A 200 here is the bug this
#           whole key exists to prevent. (If your Next release answers 307 instead,
#           the assertion that matters is still met: it is a redirect, not a 200.)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/incidents/incident-01
# Expected: 200 — the canonical form, unchanged

# 8. NEGATIVE — nothing in the sitemap points at WordPress, wp-admin or GraphQL
curl -s http://localhost:3000/sitemap.xml | grep -c 'localhost:8080'
# Expected: 0
curl -s http://localhost:3000/sitemap.xml | grep -cE 'wp-admin|wp-login|/graphql|wp-json'
# Expected: 0
curl -s http://localhost:3000/robots.txt | grep -cE '8080|wp-admin|graphql'
# Expected: 0 — a robots.txt is a public document and a poor place to advertise a CMS

# 9. NEGATIVE — no URL in the sitemap carries a trailing slash, and none is relative
curl -s http://localhost:3000/sitemap.xml | grep -o '<loc>[^<]*</loc>' | grep -c '/</loc>'
# Expected: 0
curl -s http://localhost:3000/sitemap.xml | grep -o '<loc>[^<]*</loc>' | grep -vc '<loc>http'
# Expected: 0 — every entry is absolute

# 10. NEGATIVE — this is YOUR sitemap, not Yoast's. There is no index, no paginated
#     children, and the Yoast URL is gone from both hosts.
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/sitemap_index.xml
# Expected: 404 — Next has no such route, and middleware let the request through
#           because the path contains a dot
curl -s http://localhost:3000/sitemap.xml | grep -c '<sitemapindex'
# Expected: 0 — one flat urlset, not an index of children
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/sitemap_index.xml
# Expected: 404, or a 302 to :3000. Either way Yoast is no longer publishing one.

# 11. NEGATIVE — /robots.txt and /sitemap.xml resolve with NO locale prefix, and are
#     NOT redirected. This is the only reason they work, and it is worth asserting:
#     both paths contain a dot, so Lesson 09.5's matcher `.*\..*` excludes them.
for p in /robots.txt /sitemap.xml /icon.svg; do
  printf '%s  ' "$p"
  curl -s -o /dev/null -w '%{http_code}  redirect="%{redirect_url}"\n' "http://localhost:3000$p"
done
# Expected: 200 and an EMPTY redirect for all three
# And the contrast that makes the rule visible — no dot, so middleware DOES match:
curl -s -o /dev/null -w '%{http_code}  %{redirect_url}\n' http://localhost:3000/opengraph-image
# Expected: 307 to /en/opengraph-image. Same directory, opposite answer, and the dot
#           is what decides. Key Concept 10.

# 12. The icon resolved, and Lesson 12.3's console allowlist is empty again
curl -s http://localhost:3000/en | grep -o 'rel="icon"[^>]*'
# Expected: a link whose href contains /icon.svg
grep -c 'favicon' e2e/smoke.spec.ts
# Expected: 0
npx playwright test --project=smoke
# Expected: all specs pass with CONSOLE_ALLOWLIST empty. The browser's own
#           subresource request being satisfied is a stronger check than fetching
#           the icon yourself.

kill "$SERVER_PID"

# 13. NEGATIVE — a failed redirect fetch produces ZERO redirects and a SUCCESSFUL
#     build. Simulated by breaking the query, which isolates the failure to this one
#     request: stopping WordPress would break generateStaticParams too and fail the
#     build for an unrelated reason (Lesson 09.4 §5).
#     A `.bak` copy, not `git checkout --`: this lesson created the key and the module
#     commits AFTER verification.
sed -i.bak 's/bttRedirects { from to permanent }/notAField { from }/' next.config.ts
grep -c 'notAField' next.config.ts
# Expected: 1 — if 0 the sed missed and the rest of this check means nothing

rm -rf .next
npm run build 2>&1 | tee /tmp/btt-failsoft.log | grep -E '\[redirects\]'
# Expected: "[redirects] WordPress unreachable (…) — serving no redirects rather
#           than failing the build."
echo "build exit: $?"
grep -c 'Compiled successfully\|Generating static pages' /tmp/btt-failsoft.log
# Expected: 1 or more — the build COMPLETED. That is the whole point of fail-soft.

mv next.config.ts.bak next.config.ts
grep -c 'bttRedirects' next.config.ts
# Expected: 1 — restored

# 14. NEGATIVE — the redirect list did not leak into the layout's per-render query
grep -c 'bttRedirects' src/graphql/siteSettings.graphql
# Expected: 0 — build-time data has no business in SiteChrome
grep -rc 'bttRedirects' src/ | grep -v ':0$' ; echo "exit=$?"
# Expected: no matches, exit=1 — the only reader is next.config.ts, outside src/

# 15. Middleware is still untouched, and still does no I/O
grep -c 'fetch(' src/middleware.ts
# Expected: 0 — Lesson 15.5's assertion, which Module 20 still relies on
grep -c 'favicon' src/middleware.ts
# Expected: 1 — the matcher is unchanged. Three modules have agreed not to edit it.

# 16. Leave the tree clean and the redirect list live again
rm -rf .next && npm run build 2>&1 | grep -E '\[redirects\]'
# Expected: "[redirects] 2 rule(s) from WordPress." — back to normal
git status --short
# Expected: no .bak, no .next, nothing unexpected

# 17. The decisions are written down
grep -c 'Apex, not' ../docs/architecture.md
# Expected: 1
grep -c 'canonical host' ../docs/architecture.md
# Expected: 1 — the section Lesson 19.2 opened, which you appended to
```

If check 4's `<loc>` count is much lower than 70, read the `first:` argument in `sitemap.ts`
before anything else — a pagination cap is the failure mode that looks like a working sitemap
(Key Concept 3). If check 7 returns `200`, stop and re-read `next.config.ts`: two URLs per page
is the most expensive thing in this lesson and it is entirely silent.

## Control Questions

1. Yoast already generates a sitemap and this lesson replaces it. Give the four concrete defects
   in Yoast's version, then name the one thing Yoast's version does better than yours and say why
   that trade is still worth taking.
2. `trailingSlash: false` is already Next's default, and the lesson sets it explicitly anyway.
   Give both reasons, and describe precisely what a crawler sees if `/en/incidents/incident-01`
   and `/en/incidents/incident-01/` both return `200`.
3. `redirects()` is evaluated once, at build time. State the consequence for the editor who added
   a redirect at 4pm, describe the middleware alternative with its own two costs, and say where
   the line between them is for this application.
4. The redirect fetch has a five-second timeout and returns `[]` on any failure. Explain why the
   simulation in Verification check 13 breaks the *query* rather than stopping WordPress, and say
   what a build with WordPress stopped would actually fail on.
5. `/robots.txt`, `/sitemap.xml` and `/icon.svg` live at `src/app/`, while
   `opengraph-image.tsx` lives at `src/app/[locale]/`. Give the single property that decides it,
   say what you would have had to change to keep them all together, and name the two lessons that
   would have been broken by that change.

## Learn More

- [Next.js — `sitemap.ts`](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap)
  — the `MetadataRoute.Sitemap` shape, plus `generateSitemaps` for the day Key Concept 3's
  threshold actually applies to you
- [Next.js — `robots.ts`](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots)
  — the `MetadataRoute.Robots` shape, including the `rules` array form for per-agent rules
- [Next.js — `redirects`](https://nextjs.org/docs/app/api-reference/config/next-config-js/redirects)
  — read the status-code section carefully: `permanent: true` is **308**, not 301, and
  `statusCode` is the per-rule escape hatch
- [Next.js — `trailingSlash`](https://nextjs.org/docs/app/api-reference/config/next-config-js/trailingSlash)
  — short, and worth reading alongside the note that the enforcing redirect is emitted for you
- [Next.js — `icon` and `apple-icon`](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons)
  — the file convention Step 7 uses, and the generated `<link>` tags it produces
- [sitemaps.org protocol](https://www.sitemaps.org/protocol.html) — the 50,000-URL and 50 MB
  limits, and the authoritative statement that `priority` and `changefreq` are optional
- [Google Search Central — sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
  — including the explicit note that Google ignores `priority` and `changefreq`, which is why
  `sitemap.ts` omits both
- [Google Search Central — `robots.txt` specification](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt)
  — the matching rules for `*` and `$`, and the sentence about `Disallow` not preventing indexing
  that Key Concept 10's table is built on
- [Google Search Central — redirects and Google Search](https://developers.google.com/search/docs/crawling-indexing/301-redirects)
  — which status codes Google treats as permanent, which answers the 301-versus-308 question
  directly
- [ACF — repeater field](https://www.advancedcustomfields.com/resources/repeater/) — the storage
  shape behind `options_btt_redirects_0_from`, which is what Key Concept 8's size limit is about
