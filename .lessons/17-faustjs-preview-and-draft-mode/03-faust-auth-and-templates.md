---
title: 'Faust Auth & Templates'
module: 17
lesson: 3
teaches: [faust-auth, apollo-coupling, wp-controlled-routing, framework-lock-in, spike-evaluation]
produces: []
requires: [17.2]
---

# Lesson 17.3 — Faust Auth & Templates

## Quick Overview

You have now built preview twice: once with Faust's version in Lesson 17.1's spike, and once by
hand in 17.2. This lesson finishes the evaluation by putting the remaining two Faust features
under the same light — its **auth** flow and its **template hierarchy** — and measuring both
against what Module 15 and your own routes already do. Faust's auth is genuinely well made: a
`useAuth` hook, a redirect-based login against WordPress, and token handling you do not write.
Its templates are the reason people adopt it: `wp-templates/` resolves like `single-{post_type}.php`,
which means an editor changing a page's template in wp-admin changes what renders, with no deploy
and no route file.

Both come with the same string attached, and this lesson's job is to make that string visible
rather than to argue about it. Faust's data layer is **Apollo Client**, and its template resolution
is **its own router**. Every query in a Faust template flows through Apollo's cache, which is a
client-side normalised store with no relationship to Next's server-side Data Cache — so `next: { tags }`,
`revalidateTag` and on-demand ISR either do not apply or apply somewhere you cannot reach. You
will render the *same* incident three ways — your route, your route in preview mode, and the Faust
template — and compare four things that matter: what is in the HTML on first byte, what the client
bundle weighs, whether the response can be cached under a tag, and where the auth token lives. Do
the measurement before you form the opinion; Lesson 17.4 is where the opinion goes.

By the end of this lesson you will have:

- Faust auth working in the spike: login, `useAuth`, and a page that only renders for an
  authenticated WordPress user
- A second Faust template — an archive alongside the single — proving WP-controlled routing works
  as advertised
- A four-column measurement table for the same content rendered three ways: first-byte HTML,
  client JS weight, cacheability under a tag, token location
- A written note on where Faust's auth stores its token, and how that compares with the httpOnly
  cookie rules in [appendix 04 §4](../appendix/04-env-reference.md#session-cookies)
- The completed Faust scorecard from the module README, every row evidenced by something you ran
- A shortlist of the two or three team situations in which this trade is clearly the right one

## Classic WP Analogy

Faust's template hierarchy is the classic template hierarchy, ported. `wp-templates/single-incident.js`
is `single-incident.php`; `wp-templates/archive.js` is `archive.php`; the fallback chain behaves the
way you expect and the "seed query" that tells Faust which template to pick is `template-loader.php`
asking WordPress what this URI is. If you have ever explained to a client that changing the Page
Template dropdown changes the layout with no developer involved, Faust preserves that promise, and
your hand-written App Router routes do not.

Faust auth maps just as neatly. Its login redirect to `/wp-login.php` and back is what every
membership plugin does; `useAuth` is `is_user_logged_in()` with a loading state; and the "logged-in
users see more fields" pattern is a `current_user_can()` branch in a template. None of this is
exotic.

**Where the analogy breaks down — two places, both structural:**

The template hierarchy in Classic WordPress is free because rendering is server-side and
synchronous. Faust reproduces the *resolution* but not the *cost model*: the seed query is an extra
round trip, template resolution happens where Next would otherwise be deciding a route's rendering
strategy, and the data behind the template arrives through Apollo. A classic theme's flexibility
costs nothing at runtime. Faust's costs a request, a client cache, and your ability to declare
`revalidate` per route. This app's central claim — a static, tag-invalidated site that goes live
seconds after Publish — is built entirely out of what Faust abstracts away.

The second break is about auth storage. In Classic WordPress the auth cookie is set by PHP,
httpOnly, and unreachable from JavaScript; the browser is never trusted with anything readable.
Any client-side auth layer, Faust's included, has to keep something where the client code can reach
it, because a hook cannot read an httpOnly cookie. Module 15 spent a whole lesson keeping the token
out of JavaScript's reach; adopting a client-side auth layer would quietly hand back that property.
Check exactly where the spike stores its token before you decide how much that matters — and note
that this is a consequence of client-side rendering in general, not a bug in Faust.

---

## Key Concepts

### 1. `useAuth`, and where the gate actually is

Faust's auth is a hook plus two API routes it already mounted for you in Lesson 17.1 Step 5.

```jsx
// Illustrative — the real page is Task Step 1.
const { isAuthenticated, isReady, loginUrl } = useAuth({ strategy: 'redirect' });
```

| Piece | What it does |
|---|---|
| `useAuth()` | a client hook returning `isReady`, `isAuthenticated` and a `loginUrl` |
| `strategy: 'redirect'` | send an anonymous visitor to WordPress's own `/wp-login.php` and back |
| `strategy: 'local'` | render your own form and post credentials through Faust's API route |
| `pages/api/faust/[route].js` | the token exchange, server-side, using `FAUST_SECRET_KEY` |

It is well made, and the redirect strategy is genuinely nice: WordPress owns the login form, so
password policy, two-factor plugins and lost-password flows all keep working without you writing
any of them. Module 15 wrote all of them.

**The thing to notice is not the hook. It is where the gate sits.** `useAuth` runs in the browser.
So the page's HTML is produced and sent *before* anybody has been identified, and the redirect
happens after hydration. Step 4 measures exactly that, and the result is the most useful number in
this lesson.

```
   FAUST'S GATE                               MODULE 15'S GATE
   ────────────────────────────────────       ────────────────────────────────────
   GET /protected                             GET /en/account
     ▼                                          ▼
   HTML sent to everyone            ✅ 200     middleware: no btt_at cookie
     ▼                                          ▼
   JS hydrates, useAuth runs                  307 → /en/login?next=/en/account
     ▼                                          ▼  ← no HTML for that route was
   location = loginUrl                            ever produced
     ▼                                          requireSession() would refuse it
   the DATA never arrived, because             again, server-side, even if the
   WordPress refused the query                 middleware were deleted
```

Both are secure, and it is worth being precise about **why** each is secure, because the reasons are
different. Faust's page is safe because **WordPress refuses the query** without a valid token — not
because the page was hidden. Module 15's route is safe because the HTML does not exist for an
anonymous caller *and* `requireSession()` refuses it independently (Lesson 15.5's thesis: delete
`middleware.ts` and nothing becomes reachable).

The practical difference shows up the first time somebody puts something in the page shell that
should not be public — a customer name in a `<title>`, a count in an empty-state message. In the
client-gated model that is a leak. In the server-gated model it is unrepresentable.

### 2. A hook cannot read an httpOnly cookie, so something has to be reachable

This is the finding you will measure in Step 3, and it is important to frame it correctly:
**it is a consequence of client-side rendering, not a defect in Faust.**

`document.cookie` cannot see an `httpOnly` cookie. That is the entire point of the flag, and
Module 15 spent a lesson making sure every credential in this application has it. So a hook that
must answer "am I logged in?" in the browser needs *something the browser can read* — a
JavaScript-readable cookie, `localStorage`, `sessionStorage`, or a value held in a module variable
that was fetched from somewhere readable. There is no fourth option. Any client-side auth layer, in
any framework, faces the same wall.

| Storage | JS can read it | Survives a reload | An injected script can exfiltrate it |
|---|---|---|---|
| httpOnly cookie | ❌ | ✅ | ❌ |
| readable cookie | ✅ | ✅ | ✅ |
| `localStorage` | ✅ | ✅ | ✅ |
| `sessionStorage` | ✅ | per tab | ✅ |
| a module-level variable | ✅ | ❌ | ✅ while the page lives |

**Do not take my word for which row Faust is on. Step 3 has you look**, in the installed package and
in DevTools, and write down what you find. Then compare it against
[appendix 04 §4](../appendix/04-env-reference.md#session-cookies), which says in one line: no
`localStorage`, no `sessionStorage`, no token in a URL, no `NEXT_PUBLIC_` variable.

> **The honest weighing.** A short-lived access token in memory, refreshed through a server-side
> route, is a defensible design that many good applications ship. It is strictly weaker than an
> httpOnly cookie against XSS, and a WordPress site with a dozen plugins is a large injection
> surface — which is the sentence Lesson 15.4 opened with. The question for the ADR is not "is this
> insecure?" It is "would I knowingly give back a property I already have, and what do I get for
> it?"

### 3. The fallback chain, and the seed query that drives it

Lesson 17.1 §3 mapped the keys. This lesson makes the chain observable, which is the only way to
believe it.

```
GET /incidents/incident-01
   │
   ▼  seed query: nodeByUri('/incidents/incident-01') → Incident, databaseId 41
   │
   ▼  Faust asks wp-templates/index.js for the first key that exists:
        'single-incident'   present  ──▶  render it            ← Step 2 removes this key
        'single'            absent
        'singular'          absent
        'index'             present  ──▶  render it instead    ← and this is what you then see
```

Removing one key and watching the next one render is a thirty-second experiment and it is the whole
proof. Your own routes cannot do this, and it is worth saying why in one sentence rather than
hand-waving: **the App Router's file system is the map, and a file cannot decline a request.**
`app/[locale]/incidents/[slug]/page.tsx` matches or it does not; there is no "and if that component
is unavailable, try this one".

The seed query is what makes the chain possible. It answers "what *is* this URI?" — an Incident, a
ContentType archive, a Category, a Page — and the answer is the input to the hierarchy. Without it
Faust would have to know the URL structure in advance, which is exactly the thing it exists not to
need.

### 4. The editor-controlled-template promise is real, and you do not have it

This is the row of the scorecard where Faust wins outright, and the module has to say so plainly
rather than dismiss it.

| Change an editor wants | Classic theme | Faust | This app |
|---|---|---|---|
| Switch a page to the "Wide" template | Page Attributes dropdown, no deploy | the same dropdown, and `wp-templates/wide.js` renders | **a developer edits a route file and deploys** |
| A new post type gets a layout | drop in `single-thing.php` | drop in `wp-templates/single-thing.js`, deploy | a new route directory, deploy |
| Restructure a page tree | move pages in wp-admin | works, because URIs are resolved at request time | works — `[...slug]` + `PageByUri` (Lesson 10.5) |
| Reorder blocks in a page | the block editor | the block editor | the block editor (Module 14) |
| **Verdict** | free | **free** | **a pull request** |

Two rows of that table are ✅ for this app and two are not. The two that are not have a real cost
that lands on somebody: an editor who wants a layout variant files a ticket and waits for a deploy.
For a marketing team that iterates on landing pages weekly, that is a genuine and recurring tax,
and it is the strongest argument for adopting Faust that exists.

The counter-argument is not "editors should not do that". It is narrower and worth stating
precisely: **this application has one editor-composed page**, `/hobt`, and Module 14 already gave
editors block-level control over it. The template-switching capability would be paid for on every
route and exercised on one. That is a different trade from a fifty-page marketing site, and Lesson
17.4's second table is where that distinction becomes a decision rule.

### 5. Apollo's cache has nowhere to attach a tag, and this is structural

Lesson 17.1 §6 drew the two caches. Here is the consequence in code terms, which is what makes it
non-negotiable rather than a preference.

`revalidateTag('incident:incident-01')` purges entries in Next's Data Cache. An entry gets into the
Data Cache — with a tag — only when a `fetch` was called with Next's `next` option:

```ts
// Illustrative — this is what src/lib/graphql/client.ts does for you.
fetch(endpoint, { next: { revalidate: 3600, tags: ['incident:incident-01', 'incidents'] } });
```

Apollo's `HttpLink` calls `fetch` without that option, because `next` is a Next.js extension to the
standard `fetch` signature and Apollo is not a Next.js library. So:

| | Your route | A Faust template |
|---|---|---|
| Who calls `fetch` | `fetchGraphQL`, one file you own | Apollo's `HttpLink`, inside a dependency |
| `next: { tags }` passed | ✅ always, built by `tags.ts` | ❌ never, and there is no parameter to pass it through |
| `revalidateTag()` can purge it | ✅ | ❌ **there is no entry with that tag** |
| Freshness control you do have | per-tag, per-node, seconds after Publish | `revalidate: 60` in `getStaticProps`, whole page, time-based |
| **Verdict** | what Module 18 is | a fixed window, and you wait it out |

Step 6 measures this, and the measurement is an **absence**: no call site, no tag, nothing to purge.
That is a legitimate form of evidence and the only one available before Module 18 builds the
webhook — so Step 6 also records the positive control on your own side, and forward-references
18.2's Verification for the other half.

> **Where this breaks in the wild.** The failure is not slowness. It is a correction published at
> 14:02 that is still not visible at 14:59 because the window is an hour, with nobody able to say
> why or make it faster. "Publish, then wait" is a product decision, and adopting a framework
> should not make it for you.

### 6. WP-controlled routing costs you the authority over rendering strategy

Put the two previous concepts together and the shape of the trade appears.

```
   WHO DECIDES WHAT A URL RENDERS AS
   ─────────────────────────────────────────────────────────────────────
   THIS APP                              FAUST
   the route file, per route:            pages/[...wordpressNode].js, once:
     export const revalidate = 3600        getStaticProps → getWordPressProps({ revalidate })
     export const dynamic = 'force-dynamic'
     generateStaticParams()                getStaticPaths → fallback: 'blocking'
     tags: [incidentTag(slug)]             (no equivalent)
   ─────────────────────────────────────────────────────────────────────
   twelve independent decisions          one decision, for the whole site
```

Every capability Module 18 delivers lives in that left column: a rendering strategy per route,
`generateStaticParams` scoped to what is worth pre-rendering, tag-based invalidation from a signed
webhook, and `force-dynamic` on the personalised routes. In the right column there is one
`revalidate` number for everything, because there is one file.

That is not Faust being careless — it is what "WordPress controls routing" *means*. If WordPress
decides which component renders a URL, Next cannot also decide how that URL is rendered, because it
does not know what the URL is until it has asked.

| Capability | Yours | Faust |
|---|---|---|
| Per-route `revalidate` | ✅ twelve values, in the table in `docs/api-contract.md` | ❌ one, in one file |
| `generateStaticParams` scoped by hand | ✅ Module 18.1 | ❌ `fallback: 'blocking'` and hope |
| `force-dynamic` on `/account` | ✅ | ⚠️ a client-side gate instead |
| Server Actions | ✅ Module 16 | ❌ fights the catch-all route |
| Tag invalidation from Publish | ✅ Module 18 | ❌ |
| **Verdict** | **keep** | **decline, and Lesson 17.4 writes it down** |

### 7. Measure, do not form impressions

Four columns, and each one has a command that produces it. The rule for this lesson: **a cell you
did not run a command for does not go in the table.**

| Column | The command | Why this one |
|---|---|---|
| What is in the HTML at first byte | `curl -s URL \| grep -c '<the title>'` plus a check for `__NEXT_DATA__` | both apps render server-side, so the interesting difference is the *hydration payload*, not the content |
| Client JS weight | sum the `size_download` of every `/_next/static/**/*.js` the HTML references | the number users feel, and Module 21 turns it into a budget |
| Cacheable under a tag | `grep` for a `tags:` call site on each side | structural: a tag either exists or it does not |
| Where the auth token lives | `grep` the installed package, then DevTools | the only column you cannot infer from the outside |

Two rules that make the numbers mean something:

**Measure production builds, not dev servers.** `next dev` ships unminified, unsplit bundles with
HMR machinery attached. Comparing two dev bundles tells you about two dev servers. Step 5 builds
both apps first, and it is the difference between a real number and a made-up one.

**Report bytes, not adjectives.** "Faust felt heavier" is not admissible in an ADR. `212 kB` versus
`96 kB` is, and so is "the same, within a kilobyte", which is a perfectly good finding and the one
you should be prepared for on the public template.

### 8. The situations where this trade is clearly right

Faust is the correct choice for real projects, and an evaluation that cannot say when is not an
evaluation. Lesson 17.4 reuses this table, so make it good.

| Situation | Why Faust wins | What you give up, and why it does not matter there |
|---|---|---|
| **A WP-first team with limited Next.js depth** | the template hierarchy is knowledge they already have; `single-thing.js` needs no App Router mental model, no RSC boundary, no cache-tag vocabulary | per-route caching, which nobody on the team would have configured correctly anyway. A working site beats an optimal architecture nobody can maintain |
| **A client contract that requires editors to control routing and templates** | it is the only option on this list that delivers it. Hand-rolling means shipping a template-selection UI and a route resolver, which is a product of its own | tag invalidation. A time window is usually acceptable to a client who asked for editorial control, and it is negotiable in a way that a contractual requirement is not |
| **A conventional marketing site with no bespoke caching requirement** | delivery speed. One catch-all route, one `revalidate`, editors self-serve, and the whole thing is live in a fortnight | granularity you have no requirement for. `revalidate: 60` on everything is a defensible policy for a site whose content changes weekly |
| **A prototype or pitch that must exist next Tuesday** | it is a headless WordPress site with a working preview and login on day one | reversibility — and this is the one honest warning. Prototypes ship. Decide up front whether you are prepared to keep it |

And the mirror image, which is this application:

| Requirement | Effect on the decision |
|---|---|
| A correction must be live seconds after Publish, per node | rules out a time window. This is the whole of Module 18 |
| Server Actions for submission and moderation (Module 16) | rules out a catch-all router they fight |
| No token JavaScript can read (Module 15, appendix 04 §4) | rules out a client-side auth layer |
| One editor-composed page, not fifty | the template capability would be paid for everywhere and used once |

### 9. Reading a scorecard honestly

The module README's scorecard has ❌ in five of Faust's rows, and it would be easy to read that as
"Faust is bad". It is not what the table says, and getting this right is most of what Lesson 17.4
is for.

| A ❌ in that table means | It does not mean |
|---|---|
| "this application needs the capability and Faust does not provide it" | "the capability is universally important" |
| "we measured it" | "we assume it" |
| "the cost lands on us" | "the cost lands on everyone" |

Two rows deserve re-reading in that light. **"Server Actions: fights its routing"** is a ❌ for us
because Module 16's whole submission flow is Server Actions; a site with no writes does not care.
**"App Router currency: trails it"** is a ❌ because this course is App Router throughout; a team
starting a Pages Router project today is not paying that at all.

Fill the scorecard in with a note per row saying **which command produced it**. A scorecard with
provenance is an artifact somebody can disagree with productively. One without is a set of
opinions in a table, which is worse than no table because it looks like evidence.

---

## Task

### Step 1: Wire Faust auth, and gate a page on it

The secret key comes from the `faustwp` plugin's settings. Read it out of WordPress rather than
retyping it, so the two cannot drift:

```bash
cd wordpress-headless
docker compose run --rm wpcli wp option pluck faustwp_settings secret_key
```

Put that value in `faust-spike/.env.local` as `FAUST_SECRET_KEY`, replacing the `__CHANGE_ME__`
placeholder Lesson 17.1 Step 3 left there. It is gitignored; you proved that before the file
existed.

```jsx
// faust-spike/pages/protected.js
// A page that renders only for an authenticated WordPress user — Faust's layer
// three. Compare with next-app/src/app/[locale]/account/, which is guarded by
// middleware AND by requireSession() on the server.
//
// NOTE what is missing: getStaticProps, getServerSideProps, and any server-side
// check at all. The gate is `useAuth`, and useAuth runs in a browser. That is
// the measurement in Step 4, not an accident of how this page was written —
// there is no server-side hook to use.
import { useAuth } from '@faustwp/core';

export default function Protected() {
  const { isAuthenticated, isReady, loginUrl } = useAuth({ strategy: 'redirect' });

  if (!isReady) {
    // Every visitor — authenticated, anonymous, and curl — receives THIS.
    return <p>Loading faust auth state…</p>;
  }

  if (isAuthenticated !== true) {
    return (
      <p>
        Not signed in. <a href={loginUrl}>Sign in through WordPress</a>
      </p>
    );
  }

  return (
    <main>
      <h1>Faust protected page</h1>
      <p>You are signed in to WordPress. Faust resolved this in the browser.</p>
    </main>
  );
}
```

**Verify §1:**

- [ ] `curl -s http://localhost:3001/protected | grep -c 'Loading faust auth state'` is `1`. **You
      are anonymous and you got the page.** That is the finding, not a bug — write it down.
- [ ] In a browser, `http://localhost:3001/protected` sends you to `/wp-login.php` and back, and
      then renders the heading. Log out of wp-admin and it stops.
- [ ] `grep -c 'getServerSideProps\|getStaticProps' faust-spike/pages/protected.js` is `0`. There is
      no server-side hook in this file, because `useAuth` has no server-side form.

### Step 2: A second template, and the fallback chain made observable

Add an archive beside the single. Registering it under **two** keys costs nothing and means the
demonstration works whichever key your Faust release resolves for a post-type archive.

```jsx
// faust-spike/wp-templates/archive-incident.js
// The Faust equivalent of archive-incident.php. Registered under both
// 'archive-incident' and 'archive' in the map, so the hierarchy resolves it
// either way.
import { gql } from '@apollo/client';

export default function ArchiveIncident(props) {
  const nodes = props?.data?.incidents?.nodes ?? [];

  return (
    <main>
      <p>Rendered by Faust, from wp-templates/archive-incident.js.</p>
      <h1>Incidents</h1>
      <ul>
        {nodes.map((n) => (
          <li key={n.slug}>{n.title}</li>
        ))}
      </ul>
    </main>
  );
}

ArchiveIncident.query = gql`
  query GetIncidents {
    incidents(first: 10, where: { status: PUBLISH }) {
      nodes {
        slug
        title
      }
    }
  }
`;
```

```js
// faust-spike/wp-templates/index.js — the map, now with three entries
import archiveIncident from './archive-incident';
import index from './index-template';
import singleIncident from './single-incident';

export default {
  'single-incident': singleIncident,
  'archive-incident': archiveIncident,
  archive: archiveIncident,
  index,
};
```

Now prove the chain. Comment out the `'single-incident'` line, restart `npm run dev`, and reload
`/incidents/incident-01`:

```bash
curl -s http://localhost:3001/incidents/incident-01 | grep -c 'fell back to the index template'
# Expected: 1 — 'single-incident' is gone, 'single' does not exist, 'index' wins.
```

Then put the line back. That thirty-second experiment is the capability your route files genuinely
do not have: a file cannot decline a request.

**Verify §2:**

- [ ] `curl -s http://localhost:3001/incidents | grep -c 'archive-incident.js'` is `1`.
      If it is `0`, check `docker compose run --rm wpcli wp eval 'echo get_post_type_archive_link("incident") . PHP_EOL;'`
      — the archive exists because Lesson 03.2 set `has_archive => 'incidents'`, and a missing
      permalink structure is the usual cause.
- [ ] The fallback experiment printed `1`, and you restored the key afterwards.
- [ ] `ls faust-spike/pages/` still shows one catch-all plus `protected.js` and `api/`. **Two
      templates, one route file.**

### Step 3: Find out where Faust keeps the token

The brief for this step is: **look, and write down what you find.** Do not take a number or a
storage location from this lesson — Key Concept 2 explains why the answer is a property of
client-side rendering rather than a Faust decision, and the point of the exercise is that you can
determine it yourself for any framework.

```bash
cd "$(git rev-parse --show-toplevel)"

# 1. What does the installed package actually touch?
grep -rlo 'localStorage\|sessionStorage\|document\.cookie' \
  faust-spike/node_modules/@faustwp/core/dist 2>/dev/null | sort -u
# Expected: zero or more file paths. Record which of the three appears.

# 2. Which cookies does the auth exchange set, and are they HttpOnly?
curl -s -D - -o /dev/null 'http://localhost:3001/api/faust/auth' | grep -i '^set-cookie' \
  || echo 'no Set-Cookie on an unauthenticated call'
# Expected: either nothing (the exchange needs a WordPress session first) or one
#           or more Set-Cookie lines. Note whether each carries HttpOnly.
```

Then the half you cannot do from a shell. Sign in through `/wp-login.php`, land back on
`http://localhost:3001/protected`, and open DevTools:

| Where to look | What to record |
|---|---|
| Application → Cookies → `localhost:3001` | every cookie name, and whether `HttpOnly` is ticked |
| Application → Local Storage / Session Storage | any key at all, and its name |
| Console → `document.cookie` | what comes back — this is exactly what an injected script sees |

**Verify §3:**

- [ ] You have written down, in your own notes, one of: a cookie name plus whether it is
      `HttpOnly`, a `localStorage` key, or "in memory only, gone on reload".
- [ ] You can state which row of Key Concept 2's table Faust is on, and you got there by looking.
- [ ] For contrast, run the same Console check against `http://localhost:3000`:
      `document.cookie` returns nothing useful, because every credential in this application is
      `httpOnly` (Lesson 15.4). That contrast is the scorecard's "token location" row.

### Step 4: Column one — what is in the HTML at first byte

Both applications render on the server, so the naive "does the title appear?" check comes back
positive for both. That is a genuine finding and you should record it rather than looking for a
difference that is not there. The difference is in the **hydration payload**.

```bash
cd "$(git rev-parse --show-toplevel)"
curl -s http://localhost:3000/en/incidents/incident-01 > /tmp/btt-own.html
curl -s http://localhost:3001/incidents/incident-01    > /tmp/btt-faust.html

# a. Content at first byte — expected to be TRUE for both
grep -c 'Deployed on a Friday' /tmp/btt-own.html /tmp/btt-faust.html

# b. The hydration payload. Faust is Pages Router, so the query result is
#    serialised a SECOND time into __NEXT_DATA__ for Apollo to rehydrate.
grep -c '__NEXT_DATA__' /tmp/btt-own.html /tmp/btt-faust.html

# c. How big is that second copy?
python3 - <<'PY'
import re, pathlib
for name in ('own', 'faust'):
    html = pathlib.Path(f'/tmp/btt-{name}.html').read_text()
    m = re.search(r'id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    print(name, 'total', len(html), '__NEXT_DATA__', len(m.group(1)) if m else 0)
PY

# d. And the protected page, for comparison with a server-gated route
curl -s http://localhost:3001/protected | wc -c
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/en/account
```

**Verify §4:**

- [ ] Check (a) is non-zero for both. **Write "same" in that scorecard cell** — public Faust
      templates are server-rendered and the content is there.
- [ ] Check (b) is `1` for Faust and `0` for yours. The App Router streams its payload as RSC flight
      data instead; the interesting number is (c), the size.
- [ ] Check (d) is the real contrast: Faust serves the protected page's HTML to an anonymous caller
      with `200`, and `/en/account` answers `307 http://localhost:3000/en/login?next=/en/account`
      with no HTML for that route produced at all.

### Step 5: Column two — client JS weight, measured on production builds

A dev bundle is unminified, unsplit and carrying HMR machinery. **Comparing two dev bundles tells
you about two dev servers.** Build both first.

```bash
# Stop both dev servers first. Subshells, so the parent shell's cwd is untouched.
cd "$(git rev-parse --show-toplevel)"
( cd next-app    && npm run build && npm start ) &
( cd faust-spike && npm run build && npm start ) &
# Give both a few seconds to bind their ports, then measure.
```

```bash
cd "$(git rev-parse --show-toplevel)"

jsbytes() {
  local origin="$1" path="$2" total=0 size
  for f in $(curl -s "$origin$path" | grep -o '/_next/static/[^"]*\.js' | sort -u); do
    size=$(curl -s -o /dev/null -w '%{size_download}' "$origin$f")
    total=$(( total + size ))
  done
  printf '%s%s  %d bytes of JS across %d files\n' "$origin" "$path" "$total" \
    "$(curl -s "$origin$path" | grep -o '/_next/static/[^"]*\.js' | sort -u | wc -l)"
}

jsbytes http://localhost:3000 /en/incidents/incident-01
jsbytes http://localhost:3001 /incidents/incident-01
```

Also read it out of each build's own summary, which reports gzipped First Load JS and is the number
Module 21 will budget against:

```bash
( cd next-app    && npm run build 2>&1 | sed -n '/Route (app)/,$p'   | head -20 )
( cd faust-spike && npm run build 2>&1 | sed -n '/Route (pages)/,$p' | head -20 )
```

**Verify §5:**

- [ ] You have two byte counts and two First Load JS figures, from production builds. Record all
      four in the table.
- [ ] Whatever the numbers say, record them. If they are within a kilobyte, "the same" is the
      finding, and it is a useful one — the interesting Faust cost is not bundle size.
- [ ] Stop both production servers afterwards. `npx playwright test` starts its own dev server on
      `127.0.0.1:3000` and a stray `npm start` on the same port makes the suite lie to you.

### Step 6: Column three — cacheable under a tag, yes or no

The evidence here is an **absence**, and Key Concept 5 argued why that is legitimate. Take the
positive control on your own side first, so the comparison is symmetrical.

```bash
cd "$(git rev-parse --show-toplevel)"

# 1. POSITIVE CONTROL — your route attaches tags built by tags.ts
grep -c 'tags:' 'next-app/src/app/[locale]/incidents/[slug]/page.tsx'
# Expected: 1 or more
grep -rn 'incidentTag\|listTag' 'next-app/src/app/[locale]/incidents/[slug]/page.tsx' | wc -l
# Expected: 1 or more — and no hand-typed tag string, per Lesson 10.3

# 2. THE ABSENCE — nothing in the spike, application code or dependency, ever
#    passes Next's `next: { tags }` fetch option or calls revalidateTag
grep -rn 'revalidateTag' faust-spike/pages faust-spike/wp-templates faust-spike/faust.config.js | wc -l
# Expected: 0
grep -rl 'revalidateTag' faust-spike/node_modules/@faustwp faust-spike/node_modules/@apollo 2>/dev/null | wc -l
# Expected: 0 — there is no call site to add a tag to, in your code or in theirs

# 3. What Faust DOES give you, for contrast: one time window, one file
grep -n 'revalidate' 'faust-spike/pages/[...wordpressNode].js'
# Expected: the single `revalidate: 60` from Lesson 17.1 Step 5

# 4. And the granularity you have on your side, for the same content
grep -rn 'revalidate:' 'next-app/src/app/[locale]' | wc -l
# Expected: one per route — the table in docs/api-contract.md, Lesson 10.3 Step 4
```

**Verify §6:**

- [ ] Check 1 is non-zero and check 2 is `0`. That pair *is* the scorecard row.
- [ ] You can state the structural reason in one sentence: `next: { tags }` is a Next.js extension
      to `fetch`, Apollo's `HttpLink` does not pass it, and `revalidateTag` can only purge an entry
      that carries a tag.
- [ ] Note in the table that the **positive** half — WordPress publishes and the tagged entry is
      purged seconds later — is proved in Module 18, not here. A forward reference is honest; an
      unproven claim is not.

### Step 7: Assemble the four-column table

One table, four columns, every cell traceable to a command you ran.

```markdown
<!-- docs/architecture.md — append, under the Lesson 17.1 evidence log -->

## The same incident, rendered three ways (Lesson 17.3)

Measured on production builds. Content: seeded `incident-01`, "Deployed on a Friday (#1)".

| | Your route | Your route, in preview | Faust template |
|---|---|---|---|
| URL | `:3000/en/incidents/incident-01` | the same, with the preview cookies | `:3001/incidents/incident-01` |
| Title present at first byte | yes | yes | yes |
| `__NEXT_DATA__` hydration payload | absent (RSC flight data instead) | absent | present — (write the byte count) |
| Client JS, sum of referenced chunks | (bytes) | (bytes) | (bytes) |
| First Load JS, from the build summary | (kB) | (kB) | (kB) |
| Cacheable under a tag | yes — `incident:incident-01`, `incidents` | **no, deliberately** — `no-store`, and `fetchGraphQLAuthed` has no options parameter | no — no call site passes `next: { tags }` |
| Where the auth token lives | httpOnly `btt_at`, unreadable from JS | httpOnly `btt_preview_jwt` | (write what you found in Step 3) |
| Who gates the page | middleware + `requireSession()`, server-side | a single-use token exchanged server-to-server | `useAuth`, in the browser |

Commands that produced each row: Step 4 (a)-(c), Step 5 `jsbytes` and the build summaries,
Step 6 checks 1-2, Step 3.
```

Then finish the module README's scorecard in the same file, one line per row saying what evidenced
it:

```markdown
<!-- docs/architecture.md — append -->

## Faust scorecard, evidenced (Lesson 17.3)

| Scorecard row | Evidenced by |
|---|---|
| WP template hierarchy in React | 17.3 Step 2: removed the `single-incident` key, `index` rendered instead. No route file involved |
| Editor preview | 17.2, working, and the whole of its Verification block |
| Login / auth flows | 17.3 Step 1 and Step 4 (d): Faust's gate is client-side, `/en/account` is a 307 with no HTML |
| Data layer | 17.1: `@apollo/client` is the transport under every layer and is not swappable |
| `revalidateTag` / on-demand ISR | 17.3 Step 6: positive control on our side, zero call sites on theirs |
| Server Actions | one catch-all `getStaticProps` route; nothing to post an action to |
| App Router currency | 17.1 Step 2: (write the version, date and peer ranges you saw) |
| Verdict | adopt the preview patterns only — argued and recorded in ADR 0009, Lesson 17.4 |
```

**Verify §7:**

- [ ] Every parenthesised cell is replaced with a value you measured.
- [ ] The "Cacheable under a tag" row has **three different** answers, and you can say why the
      middle one is a `no` you *want*: a draft in the shared Data Cache is one editor's unpublished
      text served to the public.
- [ ] `git add docs/architecture.md faust-spike && git commit -m "spike(faust): measure auth, templates and cacheability three ways"`.

### Step 8: Confirm the spike still costs your application nothing

Two lessons of spike work, and the claim is that `next-app` is untouched. Check it rather than
assume it — this is the same pair of checks Lesson 17.1 ran, and it is the pair Lesson 17.4's
deletion depends on.

```bash
cd next-app
npm run verify && npm test -- --run && npx playwright test --project=smoke
grep -c '@faustwp\|@apollo/client' package.json package-lock.json
grep -rc 'localStorage\|sessionStorage' src/ | grep -v ':0$' | wc -l | tr -d ' '
```

**Verify §8:**

- [ ] All three suites green, and `npm run dev` running for Playwright rather than `npm start`.
- [ ] Both `grep -c` counts are `0`.
- [ ] The `localStorage` sweep is `0` files. Whatever Step 3 found in the spike, **it did not leak
      into your application** — and that is a property of the sibling-app decision, not of your
      restraint.

---

## Verification

```bash
cd "$(git rev-parse --show-toplevel)"
# Production builds of BOTH apps running: :3000 and :3001. Step 5 started them.

# 1. Both templates resolve, from one catch-all route file
curl -s http://localhost:3001/incidents/incident-01 | grep -c 'single-incident.js'
# Expected: 1
curl -s http://localhost:3001/incidents | grep -c 'archive-incident.js'
# Expected: 1
ls faust-spike/pages/ | tr '\n' ' '
# Expected: [...wordpressNode].js _app.js api protected.js
#           Two templates, one router file. That is the capability.

# 2. The four measurements, with the commands that produced them
grep -c 'Deployed on a Friday' /tmp/btt-own.html /tmp/btt-faust.html
# Expected: non-zero for BOTH — public Faust templates are server-rendered
grep -c '__NEXT_DATA__' /tmp/btt-own.html /tmp/btt-faust.html
# Expected: 0 for own, 1 for faust — the Pages Router hydration payload
for u in http://localhost:3000/en/incidents/incident-01 http://localhost:3001/incidents/incident-01; do
  n=$(curl -s "$u" | grep -o '/_next/static/[^"]*\.js' | sort -u | wc -l | tr -d ' ')
  echo "$u  $n js files"
done
# Expected: two counts. Step 5's jsbytes gave you the byte totals; record both.

# 3. NEGATIVE — the Faust auth page's HTML is served to an anonymous caller
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/protected
# Expected: 200. Anonymous, and you got the page.
curl -s http://localhost:3001/protected | grep -ci 'signed in to WordPress'
# Expected: 0 — the CONTENT is not there, because WordPress refused the query.
#           The page shell is public; the data is not. Key Concept 1.

# 4. NEGATIVE — the same question asked of a server-gated route
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/en/account
# Expected: 307 http://localhost:3000/en/login?next=/en/account
#           No HTML for /en/account was produced at all, for anybody. And
#           `grep -rn 'requireSession' src/app/` shows the second, independent
#           server-side check that holds even if middleware.ts is deleted
#           (Lesson 15.5's thesis).

# 5. NEGATIVE — revalidateTag has nothing to attach to on the Faust side
grep -c 'tags:' 'next-app/src/app/[locale]/incidents/[slug]/page.tsx'
# Expected: 1 or more — the POSITIVE control
grep -rn 'revalidateTag' faust-spike/pages faust-spike/wp-templates faust-spike/faust.config.js | wc -l | tr -d ' '
# Expected: 0
grep -rl 'revalidateTag' faust-spike/node_modules/@faustwp faust-spike/node_modules/@apollo 2>/dev/null | wc -l | tr -d ' '
# Expected: 0. Not "we did not use it" — there is NO CALL SITE, in your code or
#           in theirs, because `next: { tags }` is a Next.js extension to fetch
#           and Apollo's HttpLink does not pass it. Key Concept 5.
#           The positive half — Publish purges the tagged entry seconds later —
#           is proved in Module 18, and saying so is more honest than faking it.

# 6. The one freshness control Faust does give you, for the record
grep -n 'revalidate' 'faust-spike/pages/[...wordpressNode].js'
# Expected: revalidate: 60 — one number, one file, the whole site
grep -rc 'revalidate:' 'next-app/src/app/[locale]' | grep -v ':0$' | wc -l | tr -d ' '
# Expected: one file per route with its own value — the table in
#           docs/api-contract.md that Lesson 10.3 Step 4 wrote

# 7. NEGATIVE — grep proves the token location you found in Step 3
grep -rlo 'localStorage\|sessionStorage\|document\.cookie' \
  faust-spike/node_modules/@faustwp/core/dist 2>/dev/null | sort -u
# Expected: whatever you recorded in Step 3, reproduced. If the list is empty,
#           your finding was "in memory only" or "a cookie set by the API route",
#           and the DevTools half of Step 3 is the evidence instead.
grep -rc 'localStorage\|sessionStorage' next-app/src/ | grep -v ':0$' | wc -l | tr -d ' '
# Expected: 0 — no file in your application has a hit. The spike's storage
#           choice did not leak into the app you ship, and that is a property of
#           the sibling-app decision from Lesson 17.1 §9.

# 8. NEGATIVE — next-app is still untouched after two lessons of spike work
grep -c '@faustwp\|@apollo/client' next-app/package.json next-app/package-lock.json
# Expected: 0 for both files
git status --short next-app/package.json next-app/package-lock.json
# Expected: no output — neither file is modified. If
#           /tmp/btt-lockfile-before.txt from Lesson 17.1 Step 1 survived, diff
#           it against a fresh `shasum -a 256` of the two files as well.

# 9. NEGATIVE — both of next-app's suites are still green
# Stop the two production servers first: Playwright starts its own dev server on
# 127.0.0.1:3000 and a stray `npm start` there makes the suite lie to you.
cd next-app && npm run verify && npm test -- --run && npx playwright test --project=smoke
# Expected: type-check, lint and format clean; all Vitest tests pass; smoke passes.

# 10. WordPress is unchanged by any of it
cd ../wordpress-headless
curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ generalSettings { title } }"}' | jq -r '.data.generalSettings.title'
# Expected: Blame The Tech
docker compose run --rm wpcli wp eval '
  $p = get_page_by_path( "incident-01", OBJECT, "incident" );
  wp_set_current_user( get_user_by( "login", "editor" )->ID );
  echo ( false !== strpos( get_preview_post_link( $p->ID ), "/api/preview?" ) ? "preview link: ours" : "preview link: NOT ours" ) . PHP_EOL;'
# Expected: preview link: ours
#           Lesson 17.2's filter is at priority 99 and still wins, with the Faust
#           plugin active and configured. Lesson 17.4 removes the plugin and this
#           check must give the same answer afterwards.
```

If check 3 returns a `200` with the signed-in content in it, you are still logged in to
`localhost:3001` in that shell's cookie jar — `curl` without `-b` sends no cookies, so this should
not happen; check you are not passing a jar from Step 3.

## Control Questions

1. `curl http://localhost:3001/protected` returns `200` with the page shell, and
   `curl http://localhost:3000/en/account` returns `307` with no HTML. Both applications are
   secure. Explain what makes each one secure, and name the specific kind of mistake that is a leak
   in the first model and unrepresentable in the second.
2. Faust stores its auth token somewhere JavaScript can reach. State why that is a consequence of
   client-side rendering rather than a design error, then say what would have to change about
   `useAuth` for an httpOnly cookie to be possible.
3. You removed one key from `wp-templates/index.js` and a different template rendered. Describe the
   equivalent experiment in `next-app` and say why it is not possible.
4. `revalidateTag` cannot purge an Apollo query result. Give the mechanical reason in terms of the
   `fetch` signature, then say which of Module 18's four deliverables survives adopting Faust and
   which do not.
5. Pick one of the three team situations in Key Concept 8 and argue the opposite case: name the one
   requirement that, if added to that project, would flip the recommendation back to hand-written
   routes.

## Learn More

- [Faust.js: authentication](https://faustjs.org/docs/how-to/authentication/) — `useAuth`,
  the `redirect` and `local` strategies, and the API route that does the exchange; read it before
  you decide how much Step 3's finding matters
- [Faust.js: templates and the hierarchy](https://faustjs.org/blog/understanding-the-templating-system-in-faust-js/) —
  the resolution order Step 2's fallback experiment walks, in the maintainers' own words
- [Faust.js: `getWordPressProps`](https://faustjs.org/docs/reference/get-wordpress-props/)
  — the function that runs the seed query, and the only place a `revalidate` can be set
- [Apollo Client: `HttpLink`](https://www.apollographql.com/docs/react/api/link/apollo-link-http)
  — the `fetchOptions` surface, so you can confirm for yourself that Next's `next: { tags }` has no
  route through it
- [Next.js: `revalidateTag`](https://nextjs.org/docs/app/api-reference/functions/revalidateTag) —
  the second paragraph is the whole of Key Concept 5: a tag purges entries that were *created* with
  that tag
- [Next.js: `fetch` and the `next` option](https://nextjs.org/docs/app/api-reference/functions/fetch)
  — the extension to the standard signature, which is the mechanical reason the two caches do not
  compose
- [Next.js: measuring bundle size](https://nextjs.org/docs/app/guides/package-bundling) — why First
  Load JS from a production build is the only comparable number, and Module 21's starting point
- [MDN: `HttpOnly` cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies#restrict_access_to_cookies)
  — two paragraphs that explain exactly why a client hook cannot use one
- [OWASP: HTML5 security, local storage](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#local-storage)
  — the standard argument against storing a token in `localStorage`, worth reading in full before
  you weigh Step 3's finding rather than after
