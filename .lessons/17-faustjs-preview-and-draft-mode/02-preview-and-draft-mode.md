---
title: 'Preview & Draft Mode'
module: 17
lesson: 2
teaches: [draft-mode, preview-post-link, single-use-tokens, as-preview-revisions, preview-banner]
produces: ['next-app/src/app/api/preview/route.ts', 'next-app/src/app/api/preview/exit/route.ts', 'next-app/src/components/preview/PreviewBanner.tsx', 'wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Preview.php']
requires: [15.2, 17.1]
---

# Lesson 17.2 — Preview & Draft Mode

## Quick Overview

This is the lesson in Module 17 that actually ships. Everything in it survives Lesson 17.4's
verdict, because it is built on Next's own `draftMode()` rather than on Faust. An editor clicks
Preview in wp-admin; the `preview_post_link` filter sends them to `/api/preview` on the Next app
with a single-use token; the route handler exchanges that token server-to-server at
`/wp-json/btt/v1/preview/verify`, receives the post identity and a short-lived preview JWT, calls
`draftMode().enable()`, sets `btt_preview_jwt` as an httpOnly cookie for 300 seconds, and redirects
to the real front-end route. That route sees `draftMode().isEnabled`, switches its query to
`asPreview: true` with `cache: 'no-store'` and the editor's Bearer token, and renders the draft
through the same `BlockRenderer` the published page uses. A `PreviewBanner` makes the state
unmissable with an exit link to `/api/preview/exit`.

Two details are where the bugs live. First, the token: it is 32 random bytes, stored as a
120-second transient keyed by a **hash** of the token rather than the token itself, deleted the
moment it is redeemed, and never a session credential. This is the **one** permitted exception to
"no credential in a URL" in [appendix 04 §4](../appendix/04-env-reference.md#4-the-two-credentials),
and the rule it does not break is worth restating precisely: *no **session** credential in a URL,
ever* — URLs leak through `Referer` headers, browser history, server access logs and chat clients.
Second, and this one has cost every headless WordPress developer an afternoon: **`asPreview: true`
reads the latest *revision*.** For a post that has never been published, the draft is the post row
and a normal query finds it. For an already-published post, the editor's unsaved changes live in
`wp_posts` as a **`revision` row**, and the post row still holds the published content. Omit
`asPreview` and the query succeeds, returns the published version, and preview looks broken with no
error anywhere. Note also who decides access: the preview JWT is scoped to the previewing user, so
WordPress's own `edit_post` capability check remains the authority. Next does not decide who may
see a draft.

By the end of this lesson you will have:

- `includes/Preview.php` — the `preview_post_link` filter, a token minted per preview click, and a
  `/wp-json/btt/v1/preview/verify` endpoint guarded by `X-BTT-App-Token` and `hash_equals()`
- `src/app/api/preview/route.ts` — token exchange, `draftMode().enable()`, `btt_preview_jwt` set
  httpOnly, and a redirect that validates its own destination against an allowlist
- `src/app/api/preview/exit/route.ts` — `draftMode().disable()` and cookie cleanup
- Every content route branching on `draftMode().isEnabled` to add `asPreview: true`, `no-store` and
  the editor's Bearer token
- `PreviewBanner.tsx` rendered from the layout whenever draft mode is on, with a working exit link
- Negative proofs: a replayed token returns `401`, a token 121 seconds old returns `401`, an
  anonymous request for a draft route still returns `404`, and no preview response is ever cached

## Classic WP Analogy

You know this feature inside out from the other side. In Classic WordPress, Preview appends
`?preview=true&preview_id=123` (plus a nonce) to the permalink, `_show_post_preview()` hooks
`the_preview`, and `_set_preview()` swaps the post's fields for those of the latest autosave or
revision before the template renders. Access control is `current_user_can( 'edit_post', $id )` — the
same check the editor screen uses. And critically: **the preview content comes from
`wp_get_post_autosave()` or the revisions table, not from the post row.**

| Classic WordPress | This stack |
|---|---|
| `?preview=true&preview_id=123` + nonce | `/api/preview?token=…` — single-use, 120 s, exchanged server-side |
| `_set_preview()` / the `the_preview` filter | `asPreview: true` on the WPGraphQL query |
| `wp_get_post_autosave()` reading a revision | **the same revision**, surfaced through WPGraphQL |
| `current_user_can( 'edit_post', $id )` | unchanged — the preview JWT is scoped to that editor |
| `preview_post_link` filter | unchanged — this is exactly the hook you use |
| "Preview in new tab" | unchanged, and it must land on `:3000`, not `:8080` |
| no caching of a preview response, ever | `cache: 'no-store'` plus `draftMode()` opting the route out of ISR |

The revisions row in that table is the whole gotcha. If you have ever debugged a classic theme
where preview showed stale content because a plugin queried the post directly instead of letting
`_set_preview()` do its work, you have already had this bug once. `asPreview: true` is the same fix.

**Where the analogy breaks down:** in Classic WordPress, preview is protected by the fact that the
*same PHP process* has your logged-in cookie and can call `current_user_can()` before rendering a
byte. Here the editor's browser arrives at a completely different origin with no WordPress session,
so the authority has to be transported. Hence the token exchange: something short-lived and
single-use travels in the URL, is redeemed once server-to-server for a user-scoped JWT, and only
then does WordPress get asked "may this person see this draft?". The credential in the URL is a
bearer of *one* claim — "whoever holds this may start one preview session in the next two minutes"
— and never of an identity.

The second break: `?preview=true` is stateless per request, so nothing about it can leak into a
cache. `draftMode()` sets cookies (`__prerender_bypass`, `__next_preview_data`) that persist, and a
route that forgets to opt out of caching can serve a draft to the public. That is why the exit
route exists and why the banner is loud — an editor who wanders off with draft mode enabled is a
disclosure risk, not just a confused user.

---

## Key Concepts

### 1. `draftMode()` is persistent, and that is the whole difference

`?preview=true` is a **query parameter**: it is true for one request and gone on the next.
`draftMode()` is a **cookie**: it is true until something turns it off. Every design decision in
this lesson follows from that one sentence.

```
   CLASSIC ?preview=true                     NEXT draftMode()
   ────────────────────────────────────      ────────────────────────────────────
   GET /incident/?preview=true               GET /api/preview?token=…
     └─ preview, this request only             └─ Set-Cookie: __prerender_bypass
   GET /incident/                            GET /en/incidents/dns
     └─ published. nothing to clean up         └─ PREVIEW. cookie is still set
                                             GET /en                (a day later)
                                               └─ still preview mode
                                             GET /en/blog/whatever  (same browser)
                                               └─ still preview mode
```

An editor who clicks Preview, reads the draft, then browses the rest of the site is **still in
draft mode**, on every route, until the cookie goes away. Three consequences, and the third makes
this a security concern rather than a UX one:

| Consequence | Why it matters |
|---|---|
| Every route below the layout opts out of the Full Route Cache **for that browser** | correct, and it is what makes preview work at all |
| Other people's drafts are visible to that editor | acceptable — WordPress checks `edit_post` per node, so this is not an escalation |
| **The editor may not know they are in draft mode** | a laptop left open on a shared desk is showing unpublished content, and nothing on the page says so |

That third row is the whole reason `PreviewBanner.tsx` is loud and `/api/preview/exit` is a
first-class endpoint. **An editor who wanders off with draft mode enabled is a disclosure risk,
not just a confused user.**

> **The cost, stated plainly.** A persistent mechanism is more useful and more dangerous than a
> per-request one. You get preview that survives clicking a link inside the draft — which
> `?preview=true` never did — and you take on the obligation to make the state visible and
> reversible. Two files, and they are not optional.

### 2. The three cookies: two Next manages, one you do

[Appendix 04 §4](../appendix/04-env-reference.md#session-cookies) is the contract; the attribute
table is there, not here. What it does not carry is **who writes each cookie and what it holds**.

| Cookie | Written by | Holds | You may |
|---|---|---|---|
| `__prerender_bypass` | Next, on `draftMode().enable()` | Next's own preview-mode id | never read it, never set it, never name it in a header rule |
| `__next_preview_data` | Next | encrypted preview data, unused by this app | same |
| `btt_preview_jwt` | **you**, in `/api/preview` | the previewing editor's short-lived JWT | read it on the server only |

The split is the interesting part. Next's two cookies answer "should this route render dynamically
for this visitor?" and carry **no identity**. `btt_preview_jwt` answers "on whose behalf should
this query run?" and carries identity but no rendering instruction. Neither can do the other's job.

`btt_preview_jwt` gets `Max-Age=300`, the same as `btt_at`, because it holds the same class of
credential; Next's two are session cookies it manages itself. **The lifetimes therefore differ**,
which produces one honest rough edge that Step 8 writes into `docs/quality-gates.md` rather than
hiding: after five minutes draft mode is still on and the JWT is gone, so the route falls back to
published content with the banner still showing. Clicking Preview again fixes it.

### 3. Why reading `draftMode()` in the layout is free and reading `cookies()` is not

Lesson 15.4 Step 6 already put a cookie read into `src/app/[locale]/layout.tsx` with a cost
attached — "Module 18 is where that bill arrives" — and this lesson adds a second one. You are
entitled to ask whether the banner doubles the bill. It does not, and the reason is worth
internalising.

```
   getSession()  →  cookies().get('btt_at')        draftMode()  →  __prerender_bypass
   ──────────────────────────────────────────      ──────────────────────────────────────────
   Next has NEVER SEEN this cookie name.           Next OWNS this cookie name. It wrote the
   Its value could be anything. The only            value, from its own preview-mode id.
   correct assumption is that the response
   depends on it.                                  During a build there is no request and no
                                                    cookie, so `isEnabled` is simply `false`
   ⇒ the route CANNOT be prerendered.               and the page prerenders normally.

                                                   At request time, a cookie that matches the
                                                    preview id makes Next bypass the Full
                                                    Route Cache FOR THAT REQUEST.

   ⇒ dynamic for EVERYONE, forever.                ⇒ dynamic for the editor holding the cookie.
```

This is not a special case bolted on. It is the definition of the feature: if reading `draftMode()`
forced dynamic rendering, the API would be useless for the one job it exists to do — showing a
draft on a site whose pages are otherwise static.

| | `cookies().get('btt_at')` | `(await draftMode()).isEnabled` |
|---|---|---|
| Value during a build | there is no request; the read bails out to dynamic | `false` |
| Route markers after a build | `ƒ (Dynamic)` for every route below the layout | unchanged from before the read was added |
| Who renders dynamically at runtime | everybody | only a visitor whose `__prerender_bypass` matches |
| Who fixes it | **Lesson 18.1**, by moving the session read out of the layout | nobody; it is not broken |

> **How you check this rather than believe it.** Task Step 7 captures `npm run build`'s route table
> before mounting the banner and again after; Verification check 12 diffs the two. In Module 17
> every route below `[locale]/layout.tsx` is already `ƒ (Dynamic)` because of Lesson 15.4 Step 6, so
> the absolute number is not available to you yet and any lesson claiming otherwise is bluffing.
> What *is* available — and what matters — is that **mounting the banner changed nothing**. Lesson
> 18.1 removes the session read, and the absolute measurement arrives with it.

### 4. `asPreview: true` reads the latest *revision* — the module's signature gotcha

This one has cost every headless WordPress developer an afternoon, and it hides because the failure
is a **success with the wrong content**.

```
A POST THAT WAS NEVER PUBLISHED           AN ALREADY-PUBLISHED POST BEING EDITED
──────────────────────────────────        ──────────────────────────────────────
wp_posts                                  wp_posts
 ┌──────────────────────────────┐          ┌──────────────────────────────┐
 │ ID 900  post_type=incident   │          │ ID 41  post_type=incident    │
 │ post_status=draft            │          │ post_status=publish          │
 │ title = "Rewriting in Rust"  │◀── the   │ title = "Deployed on Friday" │◀── the
 └──────────────────────────────┘   draft  └──────────────────────────────┘  PUBLISHED
                                     IS                                       content,
 (no revisions yet)                  the    ┌──────────────────────────────┐  untouched
                                     post   │ ID 917 post_type=revision    │
                                            │ post_parent=41               │
                                            │ post_name=41-autosave-v1     │
                                            │ title = "Deployed on a Tue"  │◀── the
                                            └──────────────────────────────┘   DRAFT

WITHOUT asPreview: the query finds        WITHOUT asPreview: the query returns
ID 900 and shows the draft.               "Deployed on Friday". SUCCESSFULLY.
        ✅ looks like it works                    ❌ and it is wrong
```

So the bug is invisible in exactly the case you test first. You create a new draft, preview it, it
works, you ship. Then an editor edits a **published** page, previews it, and sees the live version —
`200`, no `errors` array, no log line, nothing to search for. This is
[appendix 06 §4](../appendix/06-troubleshooting.md)'s "Preview shows the published version, not my
draft" entry, and Verification check 11 is what makes it memorable.

| | Classic WordPress | This stack |
|---|---|---|
| Where the draft of a published post lives | a `revision` row, `post_name` ending `-autosave-v1` | **the same row** |
| What swaps it in | `_set_preview()`, hooked to `the_preview` | `asPreview: true` on the WPGraphQL query |
| What reads it directly | `wp_get_post_autosave()` | WPGraphQL, resolving to the latest revision |
| Failure mode when you forget | a plugin that queried the post row shows stale content | identical, and for the identical reason |

If you have ever debugged a classic theme where preview showed live content because a plugin called
`get_post()` instead of letting `_set_preview()` work, **you have already had this bug once**.
`asPreview: true` is the same fix in a different language.

One design consequence: `asPreview` becomes a **GraphQL variable**, not a hard-coded `true`. Partly
because one document serves both reads, and partly because the one thing you know about a resolver
you did not write is that you will need to change your mind about when to call it. A variable makes
that a one-line change at the call site instead of a second document.

### 5. The single-use token: shape, storage, and the two things it does not need

```
token = base64url(32 random bytes) . "." . hash_hmac('sha256', <the random part>, BTT_PREVIEW_SHARED_SECRET)
        └────────── the secret ──────────┘   └──────────── the proof it came from WordPress ────────────┘
```

Stored in WordPress as:

```php
// Illustrative — the real call is in the Task.
set_transient( 'btt_pv_' . hash( 'sha256', $token ), array( 'post_id' => 41, 'user_id' => 7 ), 120 );
```

Four properties, each with a reason:

| Property | Reason |
|---|---|
| 32 bytes from `random_bytes()` | a CSPRNG, not `wp_rand()`. 256 bits is not guessable and the token is short-lived anyway |
| The transient key is `hash('sha256', $token)`, **not** the token | a database dump, an SQL injection or a careless `wp option list` hands over hashes, not live previews. The same reasoning as storing password hashes, applied to a two-minute credential |
| `delete_transient()` the instant it is looked up | single use. A preview URL in browser history, a chat client or a `Referer` header is already spent |
| 120-second TTL | the gap between clicking Preview and the browser arriving is under a second; 120 is generous and still bounds everything |

**And now the two things it deliberately does not have.**

**No timestamp in the signature.** Module 18's revalidation webhook signs `ts . "." . body` and
checks a ±300-second window, and it is right to. This token does not, because the transient already
does both jobs a timestamp would do: it **expires**, so replay past 120 seconds fails, and it is
**deleted on use**, so replay inside 120 seconds fails. 18.3's webhook has no store at all —
WordPress fires and forgets — which is exactly why *it* needs `X-BTT-Timestamp`. Same threat,
different mechanism, because the storage situation differs.

**No revocation list.** Nothing needs one. The token is gone in 120 seconds or on first use.

### 6. Next verifies the HMAC locally, and that is a pre-check, not the authority

Two checks happen, in this order, and confusing their roles is the mistake to avoid.

```
   GET /api/preview?token=<random>.<hmac>&next=/en/incidents/dns
        │
        ├─ 1. NEXT, locally, no network:
        │      recompute hash_hmac('sha256', random, PREVIEW_SHARED_SECRET)
        │      timingSafeEqual against the presented half
        │      mismatch → 401, and WordPress is never contacted
        │
        └─ 2. WORDPRESS, over the network, app-token authenticated:
               get_transient( 'btt_pv_' . hash('sha256', $token) )
               absent → 401.  present → DELETE it and mint the JWT
               ── THIS IS THE AUTHORITY ──
```

What the local pre-check buys: **an unauthenticated caller cannot force one WordPress round trip
per request.** Without it, `/api/preview?token=garbage` in a loop is an amplification primitive —
one cheap request to Next becomes a REST dispatch, a transient read and a WordPress bootstrap. And
log hygiene: garbage never reaches WordPress's access log, so a real 401 from `/preview/verify`
means something worth looking at.

What it does **not** buy is authority. The HMAC proves only "this string was minted by something
holding the shared secret". It says nothing about whether the token has been used, has expired, or
which post it was for. **A signature is not a session.** Only the transient knows.

> **`timingSafeEqual` has one sharp edge.** Node throws if the two buffers differ in length, so
> compare lengths first and return `false`. That leaks nothing — the length of a hex SHA-256 digest
> is public — but forgetting it turns a malformed token into a 500.

### 7. The one credential permitted in a URL, stated precisely

[Appendix 04 §4](../appendix/04-env-reference.md#4-the-two-credentials)'s rule is not "no
credentials in URLs". It is **no *session* credential in a URL, ever** — and the distinction is
load-bearing, because URLs leak in four ways nobody controls:

| Leak path | What sees the URL |
|---|---|
| `Referer` header | every third-party asset on the page you navigate to next |
| Browser history | anyone with the machine, and history sync |
| Server and proxy access logs | your logs, your CDN's logs, your reverse proxy's logs, retained for months |
| Chat and issue trackers | "does this preview look right to you?" pasted into Slack |

A preview token survives all four because of what it is:

| | A session credential | This preview token |
|---|---|---|
| Bearer of | an identity, for its whole lifetime | **one claim**: "whoever holds this may start one preview session in the next 120 seconds" |
| Reusable | yes, that is the point | **no**, deleted on first use |
| Lifetime | 300 s, renewable for 30 days | 120 s, not renewable |
| Escalates to | everything that identity can do | one `edit_post` check on one post |
| Safe in a `Referer` header | ❌ | ✅ — by the time anyone reads the log it is spent |

**There are exactly two token-in-a-URL exceptions in this whole course:** this one, and Lesson
15.3's single-use email confirmation code. Both are single-use, short-lived, and bearers of one
claim rather than of an identity. A third should make you suspicious.

### 8. A guard that bundles the decision with the failure mode cannot be reused

A real blocker, found by trying to reuse working code — and the generalisable lesson is worth more
than the fix. `require_app_token()` (Lesson 06.2) does two things: it **decides** whether the caller
holds the token, and it **fails** by throwing `\GraphQL\Error\UserError`. In a GraphQL request
that is exactly right. Put it in a REST `permission_callback` and it becomes a bug:

```
   WPGraphQL                                  WP_REST_Server::dispatch()
   ──────────────────────────────────────     ──────────────────────────────────────
   throw new UserError('Not authorized.')     throw new UserError('Not authorized.')
        │                                          │
        ▼ WPGraphQL catches it                     ▼ NOTHING catches it
   200 { "errors": [ { "message": … } ] }      PHP Fatal error, uncaught exception
        ✅ the contract Module 10 expects       500 + a stack trace if WP_DEBUG_DISPLAY
                                                ❌ and Lesson 06.2 §8 forbids exactly that
```

A wrong app token on `/wp-json/btt/v1/preview/verify` would therefore be an uncaught exception, an
HTTP 500, and — with `WP_DEBUG_DISPLAY` on anywhere — a file path and a plugin version handed to
whoever sent the wrong token. Verification check 8 turns that into a test: **401, and not 500.**

The fix splits the two jobs, so the `hash_equals()` comparison still lives in exactly one place:

```php
// Illustrative — the real refactor is Task Step 2.
function app_token_matches(): bool { /* the DECISION, no opinion about failing */ }
function require_app_token(): void { if ( ! app_token_matches() ) { throw new UserError( … ); } }
// and, new in this lesson, in the REST permission_callback:
//   return new \WP_Error( 'btt_not_authorized', …, array( 'status' => 401 ) );
```

**The general rule, and it applies far beyond WordPress: a guard that bundles the decision with the
failure mode cannot be reused across transports.** A predicate composes; a `throw` does not, because
the right way to fail belongs to the transport, not the check. `WP_Error` for REST, `UserError` for
GraphQL, a `NextResponse` for a route handler, `notFound()` for a page — four correct failures for
one decision.

One honest behaviour change to record. Lesson 06.2's `require_app_token()` called `graphql_debug()`
when `BTT_APP_TOKEN` was unset; `app_token_matches()` cannot, because `graphql_debug()` in a REST
request has nowhere to go. The diagnostic moves into the REST branch as a distinct `WP_Error`
**code** — `btt_app_token_unset` versus `btt_not_authorized` — which is strictly better, and both
still answer 401 with no reason echoed.

### 9. Who decides who may see a draft, and it is never Next

The exchange transports authority. It never holds it.

```
   Editor ──▶ WordPress: mint a token for (post 41, user 7)
                   │  a token is not a permission; it is a receipt
                   ▼
   Next  ──▶ WordPress: redeem this token
                   │  WordPress checks user_can( 7, 'edit_post', 41 )
                   │  and mints a JWT SCOPED TO USER 7
                   ▼
   Next  ──▶ WordPress: IncidentBySlug(asPreview: true), Bearer <user 7's JWT>
                   │  WPGraphQL resolves as user 7
                   │  WordPress checks edit_post AGAIN, per node
                   ▼
             the revision, or null
```

Three independent checks, all in WordPress, none in TypeScript — the same discipline Lesson 15.5
proved with one grep: **`grep -rn 'current_user_can' src/` prints nothing, and that is correct.**

The surprising consequence: an editor whose role loses `edit_incidents` between minting the token
and using it gets `null` back, correctly, because the last check is the one that counts. And a
preview JWT is not a special credential — it is a normal user JWT for that editor, with the normal
300-second lifetime, in a cookie whose only reader is a content route's preview branch.

### 10. `preview_post_link` is the same hook, and at least two plugins want it

The WordPress side is unchanged from the classic pattern: `get_preview_post_link()` applies the
`preview_post_link` filter, and that is what both the classic Preview link and the block editor's
Preview target resolve through.

| Classic WordPress | Here |
|---|---|
| `preview_post_link` filter | **the same filter**, returning a URL on `:3000` |
| `?preview=true&preview_id=123` + a nonce | `?token=…&id=…&next=…` |
| `_show_post_preview()` on `the_preview` | `draftMode()` plus the route's `isEnabled` branch |
| `_set_preview()` swapping the post's fields | `asPreview: true` |
| `wp_get_post_autosave()` | WPGraphQL resolving the latest revision |

Two things about that filter deserve care, and both are Task Step 4.

**Filters are a queue, and the last one wins.** Lesson 17.1 activated the `faustwp` plugin, which
has its own opinion about `preview_post_link` once a front-end URL is configured. So this lesson
registers at **priority 99**, not the default 10 — because a headless install routinely has two
plugins that both want to repoint previews, and "whichever loaded first" is not a design. Lesson
17.4 removes the Faust plugin and proves the preview flow is unchanged, which is only true because
it never depended on load order.

**The link is not clickable from your browser, and that is correct.** `BTT_FRONTEND_URL` is
`http://host.docker.internal:3000` locally — how WordPress-in-a-container reaches Next-on-your-host
(Lesson 02.2 §7), not how you do. Lesson 16.4 made the same point about the moderation email. So
**assert on the link's path, not its clickability**, and swap the origin for `localhost:3000` when
you `curl` it. In production `BTT_FRONTEND_URL` is the public origin and the button works.

> **Do not check a preview by opening a WordPress permalink.** Lesson 02.4's theme 302s every
> public front-end WordPress URL to `BTT_FRONTEND_URL`, path and query preserved — so
> `http://localhost:8080/?p=900` bounces to Next with no token and lands on a 404. That is the
> redirect working, not preview failing.

---

## Task

### Step 1: Generate the shared secret, on both sides, in that order

One value, two names: `BTT_PREVIEW_SHARED_SECRET` in WordPress and `PREVIEW_SHARED_SECRET` in
Next, both assigned to this module by
[appendix 04 §9](../appendix/04-env-reference.md#9-which-module-introduces-what). Confirm the ignore
rules **before** either file holds a value, as Lesson 02.2 Step 1 established:

```bash
cd wordpress-headless && git check-ignore -v .env
cd ../next-app       && git check-ignore -v .env.local
# Expected: a rule from each. NO OUTPUT FROM EITHER MEANS STOP.
```

Generate once, write twice. Never type it twice: the two halves must be byte-identical or every
preview fails with a 401 you will misdiagnose as an expired token.

```bash
cd "$(git rev-parse --show-toplevel)"
SECRET="$(openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48)"

printf 'BTT_PREVIEW_SHARED_SECRET=%s\n' "$SECRET" >> wordpress-headless/.env
printf 'PREVIEW_SHARED_SECRET=%s\n'     "$SECRET" >> next-app/.env.local
unset SECRET
```

Then the tracked examples get the **names only**:

```bash
printf 'BTT_PREVIEW_SHARED_SECRET=__CHANGE_ME__\n' >> wordpress-headless/.env.example
printf 'PREVIEW_SHARED_SECRET=__CHANGE_ME__\n'     >> next-app/.env.example
```

A new variable needs a container **recreate**, not a restart:

```bash
cd wordpress-headless
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --force-recreate wordpress
docker compose run --rm wpcli wp eval 'echo getenv("BTT_PREVIEW_SHARED_SECRET") === "" ? "MISSING" : "present, " . strlen( getenv("BTT_PREVIEW_SHARED_SECRET") ) . " chars" . PHP_EOL;'
```

**Verify §1:**

- [ ] The `wp eval` prints `present, 48 chars`. `MISSING` means you edited `.env` but did not
      recreate the container.
- [ ] `git status --short` shows the two `.env.example` files and **neither** real env file.
- [ ] `diff <(grep -oE '^[A-Z_]+=' .env | sort) <(grep -oE '^[A-Z_]+=' .env.example | sort)` still
      prints nothing — the invariant from Lesson 02.5.

### Step 2: Split the app-token guard into a decision and a failure

The blocker from Key Concept 8. Two edits to `includes/graphql/app-token.php`, which Lesson 06.2
created — so it is an **edit**, and edits are not declared in `produces:`.

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/app-token.php
// NEW function, added directly above require_app_token().
/**
 * Does the caller hold the application token? The DECISION, with no opinion
 * about how to fail — because the failure differs per transport. Added in
 * Lesson 17.2, when the same guard had to serve a REST route.
 *
 * hash_equals() still appears exactly once in this plugin, and it appears here.
 */
function app_token_matches(): bool {
	$expected = expected_app_token();

	// Fail CLOSED on a misconfigured server: no token set authenticates nobody.
	// hash_equals( '', '' ) is true, which is why this branch exists at all.
	if ( '' === $expected ) {
		return false;
	}

	return hash_equals( $expected, presented_app_token() );
}
```

Then reduce the existing function to a wrapper. Its whole body is replaced:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/graphql/app-token.php
// REPLACES the body of require_app_token(). The docblock's argument about
// hash_equals() moves up to app_token_matches() with the comparison.
//
// The graphql_debug() call that used to fire on an unset BTT_APP_TOKEN is GONE
// from here on purpose: graphql_debug() in a REST request has nowhere to go.
// Lesson 17.2 Step 3 re-creates that diagnostic as the WP_Error code
// `btt_app_token_unset`, which is machine-readable and transport-neutral.
/**
 * Require a valid application token, or fail the GraphQL request.
 *
 * @throws \GraphQL\Error\UserError If the token is missing, empty or wrong.
 */
function require_app_token(): void {
	if ( ! app_token_matches() ) {
		// Same message for missing, empty, short, long and wrong.
		throw new UserError( __( 'Not authorized.', 'blame-the-tech-core' ) );
	}
}
```

**Verify §2:**

- [ ] `grep -c 'hash_equals' includes/graphql/app-token.php` is `1` — one comparison, one place to
      audit. A `2` means you added the function without emptying the old body.
- [ ] `grep -c 'graphql_debug' includes/graphql/app-token.php` is `0`.
- [ ] `registerDeveloper` still refuses a wrong token with an `errors` array and HTTP 200:
      `curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' -H 'X-BTT-App-Token: wrong' -d '{"query":"mutation{ registerDeveloper(input:{email:\"x@y.tld\",displayName:\"x\"}){ accepted } }"}' | jq -e '.errors' >/dev/null && echo 'GraphQL path unchanged'`
      Three mutations call `require_app_token()`, and none may change behaviour.

### Step 3: Write `includes/Preview.php`

The whole WordPress side: the filter, the mint, and the REST route with its own failure mode.

```php
<?php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Preview.php
/**
 * Editor preview, repointed at the Next.js front end.
 *
 * Three responsibilities:
 *   1. preview_post_link  — send wp-admin's Preview button to /api/preview on Next
 *   2. the token mint     — a single-use 120 s receipt, stored under a HASH of itself
 *   3. /btt/v1/preview/verify — redeem the receipt for a user-scoped preview JWT
 *
 * Contract: the Preview Flow diagram in the Module 17 README, and appendix 04 §4
 * for the cookie and credential rules. Lesson 17.2.
 *
 * @package Blame\Core
 */

declare( strict_types=1 );

namespace Blame\Core;

defined( 'ABSPATH' ) || exit;

/** Transient key prefix. The rest of the key is hash( 'sha256', $token ). */
const PREVIEW_TRANSIENT_PREFIX = 'btt_pv_';

/** Seconds. Bounds replay; single use bounds reuse. Lesson 17.2 §5. */
const PREVIEW_TOKEN_TTL = 120;

/**
 * The HMAC key, from the environment. Same shape as expected_app_token():
 * never a literal, never an option, never committed. Appendix 04 §1.
 */
function preview_secret(): string {
	$secret = getenv( 'BTT_PREVIEW_SHARED_SECRET' );

	return is_string( $secret ) ? trim( $secret ) : '';
}

/**
 * Mint a single-use preview token and record what it is a receipt FOR.
 *
 * The transient is keyed by hash( 'sha256', $token ) rather than by the token,
 * so a database dump, a stray `wp transient list` or an SQL injection yields
 * hashes and not live previews. Same reasoning as a password hash, applied to a
 * two-minute credential.
 *
 * No timestamp is signed, deliberately: the 120 s transient already bounds
 * replay and deletion-on-use already bounds reuse. Module 18's webhook has no
 * store, which is exactly why IT needs X-BTT-Timestamp. Lesson 17.2 §5.
 */
function mint_preview_token( int $post_id, int $user_id ): string {
	// base64url of 32 CSPRNG bytes. No '+', '/' or '=' — this travels in a URL.
	$random = rtrim( strtr( base64_encode( random_bytes( 32 ) ), '+/', '-_' ), '=' );
	$token  = $random . '.' . hash_hmac( 'sha256', $random, preview_secret() );

	set_transient(
		PREVIEW_TRANSIENT_PREFIX . hash( 'sha256', $token ),
		array(
			'post_id' => $post_id,
			'user_id' => $user_id,
		),
		PREVIEW_TOKEN_TTL
	);

	return $token;
}

/**
 * The front-end path for a post, as Next.js routes it.
 *
 * The map is the `rewrite` column of appendix 03 §1, which is deliberately the
 * same word as the Next segment — /incidents, /blog, /reviews. Pages go through
 * the [...slug] catch-all, so their path is the WordPress page URI.
 *
 * One locale today. Module 20 replaces the constant with the editor's locale.
 */
function preview_front_end_path( \WP_Post $post ): string {
	$segments = array(
		'incident'    => 'incidents',
		'post'        => 'blog',
		'tech_review' => 'reviews',
	);

	if ( 'page' === $post->post_type ) {
		return '/en/' . ltrim( get_page_uri( $post ), '/' );
	}

	$segment = $segments[ $post->post_type ] ?? null;

	if ( null === $segment ) {
		return '';
	}

	return '/en/' . $segment . '/' . $post->post_name;
}

/**
 * Repoint wp-admin's Preview button at Next.js.
 *
 * PRIORITY 99, not the default 10. A headless WordPress install routinely has
 * more than one plugin with an opinion about this filter — Lesson 17.1 activated
 * one — and "whichever loaded first" is not a design. Lesson 17.2 §10.
 *
 * Returns the ORIGINAL link, unchanged, whenever it cannot build a correct one.
 * A misconfigured server must degrade to WordPress's own behaviour rather than
 * to a broken URL.
 */
function filter_preview_post_link( string $link, \WP_Post $post ): string {
	$frontend = trim( (string) getenv( 'BTT_FRONTEND_URL' ) );
	$path     = preview_front_end_path( $post );

	if ( '' === $frontend || '' === preview_secret() || '' === $path ) {
		return $link;
	}

	// The post_name is empty until the first save for some post types, and a
	// preview of a post with no slug has nowhere to land.
	if ( 'page' !== $post->post_type && '' === $post->post_name ) {
		return $link;
	}

	$minted = mint_preview_token( (int) $post->ID, get_current_user_id() );

	return add_query_arg(
		array(
			// Single-use, 120 s, one claim. NOT a session credential — the one
			// permitted token in a URL, per appendix 04 §4 and Lesson 17.2 §7.
			'token' => $minted,
			// An UNTRUSTED hint. Next logs it and never looks it up: the
			// transient carries the real post id. It exists so a failed preview
			// is diagnosable from an access log without the token in hand.
			'id'    => (int) $post->ID,
			// Where to land after the exchange. Next re-validates this against a
			// same-origin path allowlist, because WordPress is not a trusted
			// client — the mirror image of Lesson 06.2's discipline.
			'next'  => $path,
		),
		rtrim( $frontend, '/' ) . '/api/preview'
	);
}
add_filter( 'preview_post_link', __NAMESPACE__ . '\\filter_preview_post_link', 99, 2 );

/**
 * REST permission callback. The DECISION comes from app_token_matches(); the
 * FAILURE is a WP_Error, because WP_REST_Server::dispatch() does not catch the
 * UserError that require_app_token() throws. Lesson 17.2 §8.
 *
 * Two distinct codes, one status. `btt_app_token_unset` replaces the
 * graphql_debug() line that used to live in app-token.php.
 *
 * @return true|\WP_Error
 */
function rest_preview_permission() {
	if ( '' === expected_app_token() ) {
		return new \WP_Error(
			'btt_app_token_unset',
			__( 'Not authorized.', 'blame-the-tech-core' ),
			array( 'status' => 401 )
		);
	}

	if ( ! app_token_matches() ) {
		return new \WP_Error(
			'btt_not_authorized',
			__( 'Not authorized.', 'blame-the-tech-core' ),
			array( 'status' => 401 )
		);
	}

	return true;
}

/**
 * Redeem a preview token. Server-to-server only.
 *
 * @return array{postId:int,previewJwt:string}|\WP_Error
 */
function rest_verify_preview( \WP_REST_Request $request ) {
	$token = (string) $request->get_param( 'token' );
	$key   = PREVIEW_TRANSIENT_PREFIX . hash( 'sha256', $token );

	$payload = get_transient( $key );

	// DELETE FIRST, unconditionally. Single use means single ATTEMPT: a token
	// that failed the capability check below is still spent. Deleting after the
	// checks would leave a token replayable by anyone who could make one check
	// fail.
	delete_transient( $key );

	if ( ! is_array( $payload ) || ! isset( $payload['post_id'], $payload['user_id'] ) ) {
		// Expired, already redeemed, or never existed. One answer for all three.
		return new \WP_Error(
			'btt_preview_token_invalid',
			__( 'This preview link has expired. Click Preview again.', 'blame-the-tech-core' ),
			array( 'status' => 401 )
		);
	}

	// The HMAC is NOT re-checked here, and that is deliberate rather than an
	// omission: the transient key IS hash( 'sha256', $token ), so producing a hit
	// requires the exact token. The signature exists for NEXT's benefit — a local
	// pre-check so an unauthenticated caller cannot force a WordPress round trip
	// per request. Lesson 17.2 §6.
	$post_id = (int) $payload['post_id'];
	$user_id = (int) $payload['user_id'];
	$user    = get_userdata( $user_id );

	if ( ! $user instanceof \WP_User || ! user_can( $user, 'edit_post', $post_id ) ) {
		// 403, not 401: the caller IS authenticated (the app token passed) and the
		// answer is still no. Next never sees a reason.
		return new \WP_Error(
			'btt_preview_forbidden',
			__( 'Not authorized.', 'blame-the-tech-core' ),
			array( 'status' => 403 )
		);
	}

	// Mint a NORMAL user JWT for that editor. WordPress's own edit_post check
	// stays the authority when the query arrives — Next transports authority and
	// never holds it. Lesson 17.2 §9.
	if ( ! is_callable( array( '\\WPGraphQL\\JWT_Authentication\\Auth', 'get_token' ) ) ) {
		return new \WP_Error(
			'btt_jwt_unavailable',
			__( 'Not authorized.', 'blame-the-tech-core' ),
			array( 'status' => 500 )
		);
	}

	// $cap_check = false: the app token has already authenticated the CALLER, and
	// there is no logged-in user in a server-to-server REST request to check.
	$jwt = \WPGraphQL\JWT_Authentication\Auth::get_token( $user, false );

	if ( ! is_string( $jwt ) || '' === $jwt ) {
		return new \WP_Error(
			'btt_jwt_unavailable',
			__( 'Not authorized.', 'blame-the-tech-core' ),
			array( 'status' => 500 )
		);
	}

	return array(
		'postId'     => $post_id,
		'previewJwt' => $jwt,
	);
}

/**
 * The route. POST, because redeeming consumes the token — this is not a
 * cacheable read and must never be reachable by a link.
 */
function register_preview_routes(): void {
	register_rest_route(
		'btt/v1',
		'/preview/verify',
		array(
			'methods'             => 'POST',
			'callback'            => __NAMESPACE__ . '\\rest_verify_preview',
			'permission_callback' => __NAMESPACE__ . '\\rest_preview_permission',
			'args'                => array(
				'token' => array(
					'required'          => true,
					'type'              => 'string',
					// Shape only. `sanitize_text_field()` would be wrong: the token
					// is never stored or printed, only hashed and compared.
					'validate_callback' => static fn( $value ): bool => is_string( $value )
						&& 1 === preg_match( '/^[A-Za-z0-9_-]{43}\.[a-f0-9]{64}$/', $value ),
				),
			),
		)
	);
}
add_action( 'rest_api_init', __NAMESPACE__ . '\\register_preview_routes' );
```

**Verify §3:**

- [ ] `grep -c 'delete_transient' includes/Preview.php` is `1`, and it sits **above** every `return
      new \WP_Error` in `rest_verify_preview()`. Single use means single attempt.
- [ ] `grep -c 'sanitize_text_field\|esc_' includes/Preview.php` is `0`. Nothing here is stored or
      printed — the token is hashed and compared, and that is all the normalisation it may get.
- [ ] `grep -c "'status' => 401" includes/Preview.php` is `3`, and there is **no** `throw` anywhere
      in the file.
- [ ] The `add_filter( 'preview_post_link', … )` priority argument is `99`, not `10`.

### Step 4: Load it, and make your filter win

`Plugin.php`'s `INCLUDES` array is how a file gets required — the shape is Lesson 16.4 Step 2's.
One line, at the end:

```php
// wordpress-headless/wp-content/plugins/blame-the-tech-core/includes/Plugin.php
// Fragment — ONE line added to the existing INCLUDES array. Every other entry is
// unchanged, in the order the previous modules left them.
	private const INCLUDES = array(
		// … every entry from Lesson 16.3, untouched …
		'includes/Preview.php',                             // Lesson 17.2
	);
```

`Preview.php` calls `app_token_matches()` and `expected_app_token()`, so it must be listed
**after** `includes/graphql/app-token.php`. It is, because it is last. Then reactivate and look at
the link:

```bash
cd wordpress-headless
docker compose run --rm wpcli wp plugin deactivate blame-the-tech-core
docker compose run --rm wpcli wp plugin activate blame-the-tech-core

docker compose run --rm wpcli wp eval '
  $p = get_page_by_path( "incident-01", OBJECT, "incident" );
  wp_set_current_user( get_user_by( "login", "editor" )->ID );
  echo get_preview_post_link( $p->ID ) . PHP_EOL;'
```

**Verify §4:**

- [ ] The URL starts `http://host.docker.internal:3000/api/preview?` and carries `token=`, `id=`
      and `next=%2Fen%2Fincidents%2Fincident-01`.
- [ ] It does **not** point at `:3001`. If it does, your filter is not at priority 99, or the file
      is not in `INCLUDES`. Lesson 17.1's Verification check 13 recorded what the value was before
      this step; compare.
- [ ] The `next=` value is **percent-encoded**, because `add_query_arg()` encodes `/`. That is not
      the case Lesson 15.5 warns about: the unescaped `?next=` Module 16 asserts belongs to Next's
      own login redirect, which assigns `search` directly. Two builders, two encodings, and
      `searchParams.get('next')` decodes either.
- [ ] **The URL is not clickable from your browser, and that is correct** — swap the origin for
      `localhost:3000` when you `curl` it.
- [ ] `docker compose logs --tail=40 wordpress` shows no `Failed opening required` and no fatal.
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8080/wp-json/btt/v1/preview/verify`
      is `401` — **not** `404`, which would mean your registration never ran, and **not** `500`.

### Step 5: Give `cookies.ts` the preview cookie, and the document its variable

`src/lib/auth/cookies.ts` is the one module that names a cookie's attributes (Lesson 15.4), so
`btt_preview_jwt` goes there. Unlike `btt_at` and `btt_rt`, its name may live in this `server-only`
module, because middleware never reads it.

```ts
// next-app/src/lib/auth/cookies.ts — appended. SECURE, AT_ATTRS etc. already exist.
/**
 * The preview JWT, for the editor currently in draft mode. Appendix 04 §4.
 *
 * `Lax`, `Path=/`, 300 s — the same shape as `btt_at`, because it holds the same
 * class of credential: a normal user JWT for one WordPress user. It is NOT
 * `Strict`: the editor arrives from a 307 issued by /api/preview, and a Strict
 * cookie set on that response would not be sent on the redirected navigation.
 */
export const PREVIEW_COOKIE = 'btt_preview_jwt';

const PREVIEW_MAX_AGE = 300;

const PREVIEW_ATTRS = {
  httpOnly: true,
  secure: SECURE,
  sameSite: 'lax',
  path: '/',
  maxAge: PREVIEW_MAX_AGE,
} as const;

/** Called by /api/preview after WordPress redeems the token. */
export async function setPreviewCookie(jwt: string): Promise<void> {
  (await cookies()).set(PREVIEW_COOKIE, jwt, PREVIEW_ATTRS);
}

/** Called by /api/preview/exit. Full attribute set, or the deletion misses (§15.4). */
export async function clearPreviewCookie(): Promise<void> {
  (await cookies()).set(PREVIEW_COOKIE, '', { ...PREVIEW_ATTRS, maxAge: 0 });
}

/** `null` when absent or empty. The preview branch treats both the same way. */
export async function readPreviewToken(): Promise<string | null> {
  const value = (await cookies()).get(PREVIEW_COOKIE)?.value;

  return value === undefined || value === '' ? null : value;
}
```

Then the document gains a variable. `asPreview` is a stock WPGraphQL argument on every single-node
query, so the committed schema already has it — and Verify §5 checks that claim rather than
trusting it.

```graphql
# next-app/src/graphql/incidents.graphql — two lines of IncidentBySlug change.
# Everything inside the selection set is untouched.
query IncidentBySlug($slug: ID!, $asPreview: Boolean) {
  incident(id: $slug, idType: SLUG, asPreview: $asPreview) {
```

`Boolean`, not `Boolean!`: omitting the variable sends `null`, WPGraphQL treats that as falsy, and
every existing `{ slug }` call site keeps type-checking unchanged. Make the identical two-line
change to `PostBySlug` in `posts.graphql` and `ReviewBySlug` in `reviews.graphql`, then:

```bash
cd next-app
grep -c 'asPreview' ../wordpress-headless/schema.graphql
npm run codegen && npm run type-check
```

**Verify §5:**

- [ ] `grep -c 'asPreview' ../wordpress-headless/schema.graphql` is greater than `0`. A `0` means
      your WPGraphQL predates the argument — run `npm run schema:pull`, review the diff, commit the
      schema, then continue.
- [ ] `npm run type-check` is silent **without** editing any existing call site. That is what the
      nullable `Boolean` bought you.
- [ ] `grep -c 'httpOnly: true' src/lib/auth/cookies.ts` is now `3`, where Lesson 15.4 Verify §1
      asserted `2`. Noticing that is what the grep is for: a third cookie, added deliberately, in
      the one module allowed to add one.
- [ ] `grep -rn 'btt_preview_jwt' src/` names **only** `src/lib/auth/cookies.ts`.

### Step 6: Write `/api/preview`

The exchange, in order: validate the destination, pre-check the signature locally, redeem
server-to-server, enable draft mode, set the cookie, redirect.

```ts
// next-app/src/app/api/preview/route.ts
// The token exchange. Modelled on /api/auth/refresh (Lesson 15.4): a route
// handler, force-dynamic, one no-store constant, and an open-redirect defence on
// every attacker-reachable path parameter.
//
// NOTHING here is cookie-authenticated, so CSRF against this endpoint is not
// blocked — it is STRUCTURALLY IMPOSSIBLE. There is no ambient credential for
// another site's page to borrow. Lesson 15.5 §8, layer three.
import { createHmac, timingSafeEqual } from 'node:crypto';

import { draftMode } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { setPreviewCookie } from '@/lib/auth/cookies';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * OPEN REDIRECT DEFENCE, the same rule as `safeNextPath` in
 * src/app/api/auth/refresh/route.ts. `?next=` arrives from WordPress, and
 * WordPress is not a trusted client — the mirror image of the discipline
 * Lesson 06.2 §3 applies in the other direction.
 *
 * A leading `//` or `/\` is an absolute URL with a host as far as a browser is
 * concerned, which is why the negative lookahead is not optional.
 */
function isSafeNextPath(raw: string | null): raw is string {
  return raw !== null && /^\/(?![/\\])[\w\-./?=&%]*$/.test(raw);
}

/**
 * The LOCAL pre-check. Not the authority — the single-use transient in WordPress
 * is. This exists so an unauthenticated caller cannot force one WordPress round
 * trip per request, and so garbage never reaches WordPress's access log.
 * Lesson 17.2 §6.
 */
function signatureMatches(token: string): boolean {
  const secret = process.env.PREVIEW_SHARED_SECRET;

  // Fail CLOSED. An unset secret authenticates nobody.
  if (secret === undefined || secret === '') {
    return false;
  }

  const dot = token.indexOf('.');

  if (dot <= 0) {
    return false;
  }

  const expected = Buffer.from(
    createHmac('sha256', secret).update(token.slice(0, dot)).digest('hex'),
    'utf8'
  );
  const presented = Buffer.from(token.slice(dot + 1), 'utf8');

  // timingSafeEqual THROWS on unequal lengths, so compare them first. The length
  // of a hex SHA-256 digest is public, so this leaks nothing.
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

/** Redeem the token at WordPress. Returns the JWT, or null for every failure. */
async function redeem(token: string): Promise<string | null> {
  const base = process.env.WP_REST_BASE;
  // The SECOND place in this application that reads WP_APP_TOKEN — Lesson 15.2
  // said `credentialHeaders()` was the only one, and this makes it two. The cost
  // of exchanging over REST instead of GraphQL, paid deliberately: the verify
  // endpoint deletes a transient and mints a JWT, neither of which belongs in a
  // public schema.
  const appToken = process.env.WP_APP_TOKEN;

  if (base === undefined || base === '' || appToken === undefined || appToken === '') {
    console.error('[btt] preview: WP_REST_BASE or WP_APP_TOKEN is not set');

    return null;
  }

  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/btt/v1/preview/verify`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-BTT-App-Token': appToken,
      },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      return null;
    }

    const data: unknown = await response.json();
    const jwt = (data as { previewJwt?: unknown }).previewJwt;

    return typeof jwt === 'string' && jwt !== '' ? jwt : null;
  } catch (error) {
    console.error('[btt] preview: WordPress refused or was unreachable', error);

    return null;
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const nextPath = params.get('next');
  const token = params.get('token') ?? '';

  // 1. The DESTINATION first, before any credential work. A tampered `next=`
  //    means the link was rewritten, and there is nothing friendly to do — unlike
  //    /api/auth/refresh, which falls back to /en because it is reached mid-session
  //    by a real browser. 400 also means this branch does not burn a token.
  if (!isSafeNextPath(nextPath)) {
    return new NextResponse(null, { status: 400, headers: NO_STORE });
  }

  // 2. The local pre-check. No network.
  if (token === '' || !signatureMatches(token)) {
    return new NextResponse(null, { status: 401, headers: NO_STORE });
  }

  // 3. The authority. Server-to-server, app-token authenticated, single use.
  const previewJwt = await redeem(token);

  if (previewJwt === null) {
    return new NextResponse(null, { status: 401, headers: NO_STORE });
  }

  // 4. draftMode() is ASYNC in Next 15. So is cookies(). Getting this wrong is
  //    the single most common stale-knowledge error in the ecosystem.
  (await draftMode()).enable();
  await setPreviewCookie(previewJwt);

  return NextResponse.redirect(new URL(nextPath, request.nextUrl.origin), {
    status: 307,
    headers: NO_STORE,
  });
}

// No POST export. Next answers 405 for a method a route file does not implement.
```

**Verify §6:**

- [ ] `grep -c 'timingSafeEqual' src/app/api/preview/route.ts` is `1`, with the length comparison on
      the same line. Without it a malformed token is a 500, not a 401.
- [ ] `grep -rn 'WP_APP_TOKEN' src/` names exactly **two** files: `src/lib/graphql/client.ts` and
      this route. A third is a mistake.
- [ ] The three guards in `GET` run in the order destination, signature, redemption. Swapping the
      first two makes the open-redirect test consume a valid token.

### Step 7: The exit route, the banner, and the two branches that use them

Three small pieces and two anchored edits. First capture what `npm run build` reports today, because
Key Concept 3 makes a claim about that table and Verification check 12 is how you test it:

```bash
# Stop `npm run dev` first — a dev server and a build fight over .next/.
cd next-app
npm run build 2>&1 | tee /tmp/btt-build-before-banner.txt | tail -30
```

Now the way out:

```ts
// next-app/src/app/api/preview/exit/route.ts
// The way out. Idempotent, and it clears BOTH mechanisms: Next's draft-mode
// cookies and our own preview JWT.
import { draftMode } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { clearPreviewCookie } from '@/lib/auth/cookies';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** One locale today. Module 20 replaces the test with the real list. */
function safeLocale(raw: string | null): string {
  return raw !== null && /^[a-z]{2}$/.test(raw) ? raw : 'en';
}

export async function GET(request: NextRequest): Promise<Response> {
  const mode = await draftMode();

  // `draftMode().isEnabled` IS the authentication here: only a browser already
  // holding Next's bypass cookie can be in draft mode, and turning your own
  // preview off needs no further proof. Disabling something already disabled is
  // a no-op, so the endpoint is safe to hit from anywhere.
  if (mode.isEnabled) {
    mode.disable();
  }

  // Cleared unconditionally, even when draft mode was already off. The two
  // cookies have different lifetimes (Lesson 17.2 §2), so "off" and "no JWT" are
  // not the same state and both must end.
  await clearPreviewCookie();

  const locale = safeLocale(request.nextUrl.searchParams.get('locale'));

  // 307 to the locale home EITHER WAY. There is no failure branch to distinguish.
  return NextResponse.redirect(new URL(`/${locale}`, request.nextUrl.origin), {
    status: 307,
    headers: NO_STORE,
  });
}
```

Then the banner. A Server Component with no `'use client'`: it ships no JavaScript, and nothing in
it *could* read a cookie.

```tsx
// next-app/src/components/preview/PreviewBanner.tsx
// Unmissable, and reversible in one click. Rendered from the root layout only
// when draft mode is on, so a public visitor never receives this markup.

export function PreviewBanner({ locale }: { readonly locale: string }) {
  return (
    <aside className="sticky top-0 z-50 flex flex-wrap items-center gap-x-3 gap-y-1 bg-amber-400 px-4 py-2 text-sm text-neutral-950">
      <strong>Draft preview</strong>
      <span>
        You are viewing unpublished content. Nobody else can see this — it is your session, not
        the site.
      </span>
      {/*
        A plain <a>, deliberately NOT next/link. The exit must be a real document
        request: the route handler's Set-Cookie has to be applied and the client
        router's cache discarded, and a client-side navigation to a route handler
        does neither.
      */}
      <a className="ml-auto font-semibold underline" href={`/api/preview/exit?locale=${locale}`}>
        Exit preview
      </a>
    </aside>
  );
}
```

Mount it in the root layout — Key Concept 3 is the argument that this read is free.

```tsx
// next-app/src/app/[locale]/layout.tsx — the import and the mount
import { draftMode } from 'next/headers';

import { PreviewBanner } from '@/components/preview/PreviewBanner';

// …inside LocaleLayout, beside the existing session read:

  // Next OWNS __prerender_bypass, so unlike cookies().get('btt_at') this read
  // does not force dynamic rendering: it is `false` during a build and the
  // cookie bypasses the Full Route Cache per request. Lesson 17.2 §3.
  const { isEnabled: isPreview } = await draftMode();

// …and as the FIRST child inside <body>, above <Header …/>:

        {isPreview ? <PreviewBanner locale={locale} /> : null}
```

Finally the branch that reads a draft. One route in full; the other two are the same three lines.

```tsx
// next-app/src/app/[locale]/incidents/[slug]/page.tsx — the preview branch
import { draftMode } from 'next/headers';

import { readPreviewToken } from '@/lib/auth/cookies';
import { fetchGraphQL, fetchGraphQLAuthed } from '@/lib/graphql/client';

// …replacing the single fetchGraphQL call inside the component:

  const { isEnabled } = await draftMode();
  const previewJwt = isEnabled ? await readPreviewToken() : null;

  // fetchGraphQLAuthed, and BOTH of its hard-coded policies are right here
  // rather than incidentally:
  //   cache: 'no-store' — a draft must never enter the shared Data Cache. One
  //     editor's unpublished text served to the public is the highest-severity
  //     bug this architecture can produce, and the client makes it
  //     unrepresentable: there is no options parameter to pass a cache into.
  //   'strict' — any `errors` entry throws. A refused preview is
  //     `{ incident: null }` WITH an errors array, and silently rendering a 404
  //     would hide a capability problem the editor needs to see.
  //
  // No `revalidate` and no `tags` on the preview path, and none can be passed:
  // Next 15's fetch is uncached by default, so omitting the options IS the opt-out.
  const data =
    previewJwt === null
      ? await fetchGraphQL(
          IncidentBySlugDocument,
          { slug },
          { revalidate: 3600, tags: [incidentTag(slug), listTag('incident')] }
        )
      : await fetchGraphQLAuthed(
          IncidentBySlugDocument,
          { slug, asPreview: true },
          { kind: 'user', jwt: previewJwt }
        );
```

| Route | Document | Variables in preview |
|---|---|---|
| `src/app/[locale]/incidents/[slug]/page.tsx` | `IncidentBySlugDocument` | `{ slug, asPreview: true }` |
| `src/app/[locale]/blog/[slug]/page.tsx` | `PostBySlugDocument` | `{ slug, asPreview: true }` |
| `src/app/[locale]/reviews/[slug]/page.tsx` | `ReviewBySlugDocument` | `{ slug, asPreview: true }` |

Capture the table again, with the banner mounted. Verification check 12 diffs the two:

```bash
npm run build 2>&1 | tee /tmp/btt-build-after-banner.txt | tail -30
```

Then start `npm run dev` again. Verification needs the **dev** server rather than `npm start`,
because `cookies.ts` derives `Secure` from `NODE_ENV` and `curl` will not send a `Secure` cookie
over `http://` (Lesson 15.4 §2).

**Verify §7:**

- [ ] `grep -rc "'use client'" src/components/preview/` is `0`, and `grep -c 'next/link'` on the
      banner is `0`: a Server Component whose exit is a plain `<a href>`.
- [ ] `grep -rn 'fetchGraphQLAuthed' src/app/` names the three detail routes and nothing else.
- [ ] `revalidate` appears only on the **published** branch. One on the preview branch would not
      compile — `fetchGraphQLAuthed` has no options parameter — which is the point of that design.
- [ ] `npm run verify` and `npm test -- --run` are both clean.

### Step 8: Write the three documents this lesson owes

**The entry-point matrix first.** Lesson 15.5 Step 6 left two `STUB` rows for this lesson, and
Module 16's README opens by warning you not to arrive at a new module with them unfilled:

```markdown
<!-- docs/quality-gates.md — replace the two STUB rows -->

| `GET /api/preview` (17.2) | a single-use 120 s token, HMAC pre-checked locally with `timingSafeEqual`, then redeemed server-to-server; the transient is the authority | n/a at this layer: WordPress checks `user_can( $user, 'edit_post', $id )` before minting, and again per node when the query arrives | `?next=` validated against a same-origin path allowlist → 400; `token` shape validated in PHP by `validate_callback` | **none — the token IS the limit.** Single use, 120 s, unguessable | **n/a: structurally impossible.** Reads no cookie, so there is no ambient credential to ride |
| `GET /api/preview/exit` (17.2) | `draftMode().isEnabled` — only a browser already holding Next's bypass cookie can be in draft mode | n/a: turning off your own preview needs no capability | `?locale=` validated as two lowercase letters | n/a: idempotent, and the worst case is being logged out of preview | n/a: a cross-site request could only end the victim's own preview session |
| `POST /wp-json/btt/v1/preview/verify` (17.2) | `X-BTT-App-Token`, compared with `hash_equals()` in `app_token_matches()` | holding the app token IS the authorisation to ask; the answer still depends on `user_can( …, 'edit_post', … )` | `token` matched against `^[A-Za-z0-9_-]{43}\.[a-f0-9]{64}$` before the callback runs | n/a: an unguessable single-use token, deleted on the first attempt | n/a: no cookie, and WordPress is a different origin from the browser's session |

### Known gaps, named rather than hidden (Lesson 17.2 additions)

5. **`btt_preview_jwt` expires before draft mode does.** The JWT lives 300 s; Next's
   `__prerender_bypass` is a session cookie. After five minutes the banner is still up and the
   route falls back to published content. Clicking Preview again fixes it. Accepted: shortening
   `__prerender_bypass` is not ours to do, and lengthening the JWT would break the 300 s rule
   appendix 04 §4 sets for every user credential.
6. **A preview response for one post enables draft mode for every route.** WordPress re-checks
   `edit_post` per node, so this is not an escalation — but an editor who forgets to exit is
   showing unpublished content to anyone looking at their screen. The banner is the whole
   mitigation, and it is a human one.
```

**Then the contract**, so the front end and any future client agree on shapes:

```markdown
<!-- docs/api-contract.md — append -->

## Preview (Lesson 17.2)

`POST /wp-json/btt/v1/preview/verify` — server-to-server only.

- Request: `{ "token": "<43 base64url chars>.<64 hex chars>" }`, header `X-BTT-App-Token`
- 200: `{ "postId": 41, "previewJwt": "<jwt>" }`
- 401 `btt_app_token_unset` / `btt_not_authorized` — the app token is unset or wrong
- 401 `btt_preview_token_invalid` — expired, already redeemed, or never existed. One answer for
  all three, on purpose
- 403 `btt_preview_forbidden` — the stored user may not `edit_post` that post
- No response body ever contains the token, the post title, or a reason.

`GET /api/preview?token=&id=&next=` — 400 on a `next` that is not a same-origin path, 401 on a
failed signature or a failed redemption, 307 to `next` on success. `id` is a logged hint and is
never looked up. Sets `__prerender_bypass`, `__next_preview_data` and `btt_preview_jwt`.

`GET /api/preview/exit?locale=` — 307 to `/{locale}` always. Clears all three cookies.

Preview reads use `fetchGraphQLAuthed(doc, { …, asPreview: true }, { kind: 'user', jwt })`, which
hard-codes `cache: 'no-store'` and the `strict` error policy. **No preview response is ever
cached, tagged, or shared between visitors.**
```

**Then the rotation procedure**, appended to `docs/runbook.md` — Lesson 15.2 created that file, so
do not create it again:

```markdown
<!-- docs/runbook.md — append -->

## Rotating the preview shared secret (Lesson 17.2)

**When:** a leaked copy of either env file, an offboarded engineer, or on a schedule.

**Effect, stated before you do it:** every preview link already sitting in a browser tab or a
Slack message stops working. No editor is signed out of anything — this secret signs preview
tokens and nothing else. Worst case, an editor clicks Preview again.

**Steps**

1. `openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48`
2. Write it to `BTT_PREVIEW_SHARED_SECRET` in `wordpress-headless/.env` **and**
   `PREVIEW_SHARED_SECRET` in `next-app/.env.local`, in the same maintenance window. A mismatch
   fails every preview with a 401 that looks exactly like an expired token.
3. `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --force-recreate wordpress`
4. Assert without printing:
   `diff <(grep -E '^BTT_PREVIEW_SHARED_SECRET=' wordpress-headless/.env | cut -d= -f2-) <(grep -E '^PREVIEW_SHARED_SECRET=' next-app/.env.local | cut -d= -f2-)`
5. In production: `fly secrets set BTT_PREVIEW_SHARED_SECRET=…` and the Vercel environment
   variable, then redeploy Next so the new value is in the running runtime.
6. Success signal, from the outside, in under a minute: click Preview in wp-admin and land on the
   draft with the banner showing.

**What this does NOT fix:** a leaked `BTT_APP_TOKEN`. That is a separate rotation (Lesson 15.2),
and `/preview/verify` fails closed until both sides match.

(Add your own note: what would tell you an old preview link was still working after rotation?)
```

**Verify §8:**

- [ ] `grep -c 'STUB' docs/quality-gates.md` went **down by two**; any remaining `STUB` belongs to
      Module 18 or later.
- [ ] The matrix has a row for `/wp-json/btt/v1/preview/verify` too. **Three** endpoints were added
      in this lesson, and the WordPress one is the one an attacker can reach without a browser.
- [ ] Every `n/a` in your three new rows carries its reason on the same line, and you filled in the
      runbook's parenthesis.
- [ ] `git add -A && git commit -m "feat(preview): repoint the WP preview link at Next"`.

---

## Verification

```bash
cd wordpress-headless
# `npm run dev` running in next-app/, in another terminal.

# 0. Read the app token into THIS shell session only. Never into a dotfile.
export BTT_APP_TOKEN="$(grep -E '^BTT_APP_TOKEN=' .env | cut -d= -f2-)"
test -n "$BTT_APP_TOKEN" && echo 'app token loaded into this session'
# Expected: app token loaded into this session

# 1. The two halves of the shared secret are identical. Asserted, never printed.
diff <(grep -E '^BTT_PREVIEW_SHARED_SECRET=' .env | cut -d= -f2-) \
     <(grep -E '^PREVIEW_SHARED_SECRET=' ../next-app/.env.local | cut -d= -f2-) \
  && echo 'secrets match'
# Expected: secrets match
#           A mismatch fails every preview with a 401 indistinguishable from an
#           expired token, which is the single hardest bug in this lesson to see.

# 2. Create a NEVER-PUBLISHED draft as the editor, and mint a link for it
DRAFT_ID=$(docker compose run --rm -T wpcli wp eval '
  $e = get_user_by( "login", "editor" );
  wp_set_current_user( $e->ID );
  echo wp_insert_post( array(
    "post_type"    => "incident",
    "post_status"  => "draft",
    "post_title"   => "Rewriting It In Rust",
    "post_name"    => "rewriting-it-in-rust",
    "post_content" => "<!-- wp:paragraph --><p>Six months, they said.</p><!-- /wp:paragraph -->",
    "post_author"  => $e->ID,
  ) );' | tr -d '\r')
echo "draft id: $DRAFT_ID"
# Expected: a numeric post id

# 3. The Preview link. NOT clickable from your browser — host.docker.internal is
#    how WordPress reaches Next, not how you do (Lesson 17.2 §10).
PREVIEW_URL=$(docker compose run --rm -T wpcli wp eval "
  wp_set_current_user( get_user_by( 'login', 'editor' )->ID );
  echo get_preview_post_link( $DRAFT_ID );" | tr -d '\r')
echo "$PREVIEW_URL" | sed 's/token=[^&]*/token=REDACTED/'
# Expected: http://host.docker.internal:3000/api/preview?token=REDACTED&id=<id>&next=%2Fen%2Fincidents%2Frewriting-it-in-rust
LOCAL_URL="${PREVIEW_URL/host.docker.internal/localhost}"

# 4. Redeem it once, end to end, and land on the draft
curl -s -c /tmp/btt-preview.jar -b /tmp/btt-preview.jar -L -o /tmp/btt-draft.html \
     -w 'status=%{http_code} url=%{url_effective}\n' "$LOCAL_URL"
# Expected: status=200 url=http://localhost:3000/en/incidents/rewriting-it-in-rust
grep -c 'Rewriting It In Rust' /tmp/btt-draft.html
# Expected: a non-zero count — the DRAFT rendered through your own components
grep -c 'Draft preview' /tmp/btt-draft.html
# Expected: 1 — PreviewBanner is on the page, with its exit link
grep -c '__prerender_bypass\|btt_preview_jwt' /tmp/btt-preview.jar
# Expected: 2 or more. All three cookies are HttpOnly; curl stores them, JS cannot
#           read them, and `grep HttpOnly /tmp/btt-preview.jar` shows the flag.

# 5. NEGATIVE — replaying the SAME token is 401. Single use.
curl -s -o /dev/null -w '%{http_code}\n' "$LOCAL_URL"
# Expected: 401. The transient was deleted the instant it was looked up, so the
#           second attempt cannot succeed even one millisecond later.

# 6. NEGATIVE — a token whose transient is gone is 401. This is the EXPIRY branch.
#    Mint a fresh one and delete its transient instead of sleeping 121 seconds:
#    it exercises the identical code path in one second rather than two minutes.
#    What it does NOT prove is that WordPress's own expiry fires — for that, swap
#    the two lines below for `sleep 121` and re-run. Both are worth doing once.
FRESH=$(docker compose run --rm -T wpcli wp eval "
  wp_set_current_user( get_user_by( 'login', 'editor' )->ID );
  echo get_preview_post_link( $DRAFT_ID );" | tr -d '\r')
# The token is base64url + '.' + hex, so add_query_arg() encodes none of it and
# the value in the URL is the value WordPress hashed. shasum on macOS;
# sha256sum on Linux.
TOKEN=$(printf '%s' "$FRESH" | sed -n 's/.*token=\([^&]*\).*/\1/p')
KEY="btt_pv_$(printf '%s' "$TOKEN" | shasum -a 256 | cut -d' ' -f1)"
docker compose run --rm -T wpcli wp transient delete "$KEY"
# Expected: Success: Transient deleted.  ← proves the key really is a HASH of the
#           token, which is Key Concept 5's storage claim, made observable
curl -s -o /dev/null -w '%{http_code}\n' "${FRESH/host.docker.internal/localhost}"
# Expected: 401

# 7. NEGATIVE — a mangled HMAC is 401 with NO WordPress round trip at all
BEFORE=$(docker compose logs wordpress 2>/dev/null | grep -c 'btt/v1/preview/verify')
# The right SHAPE (43 base64url chars, a dot, 64 hex chars) so it survives every
# structural check and fails only on the signature.
BAD="$(printf 'a%.0s' $(seq 43)).$(printf '0%.0s' $(seq 64))"
curl -s -o /dev/null -w '%{http_code}\n' --get \
  --data-urlencode "token=$BAD" --data-urlencode 'next=/en' \
  http://localhost:3000/api/preview
# Expected: 401
AFTER=$(docker compose logs wordpress 2>/dev/null | grep -c 'btt/v1/preview/verify')
echo "verify hits before=$BEFORE after=$AFTER"
# Expected: before and after are EQUAL. The local pre-check rejected it, so
#           /preview/verify was never dispatched. That is the amplification
#           defence from Key Concept 6, measured rather than asserted.

# 8. NEGATIVE — the §8 blocker, made into a test: 401, and NOT 500
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  http://localhost:8080/wp-json/btt/v1/preview/verify \
  -H 'Content-Type: application/json' -d '{"token":"x"}'
# Expected: 401
curl -s -X POST http://localhost:8080/wp-json/btt/v1/preview/verify \
  -H 'Content-Type: application/json' -H "X-BTT-App-Token: wrong-$BTT_APP_TOKEN" \
  -d '{"token":"x"}' | jq -r '.code'
# Expected: btt_not_authorized
#           A 500, an HTML body, or a `Fatal error` string means require_app_token()
#           is still in the permission_callback. Nothing in WP_REST_Server catches
#           the UserError it throws.
curl -s -X POST http://localhost:8080/wp-json/btt/v1/preview/verify \
  -H 'Content-Type: application/json' -H "X-BTT-App-Token: $BTT_APP_TOKEN" \
  -d '{"token":"nope"}' | jq -r '.code'
# Expected: rest_invalid_param — the validate_callback rejected the token's SHAPE
#           before the handler ran, so a malformed token costs no transient read

# 9. NEGATIVE — an anonymous request for the draft route is still 404
curl -s -o /dev/null -w '%{http_code}\n' \
  http://localhost:3000/en/incidents/rewriting-it-in-rust
# Expected: 404. No cookie jar, no draft mode, no draft. Unchanged from the
#           Module 17 Starting State, which asserts exactly this.

# 10. NEGATIVE — the preview render is NOT SHARED. Same URL, two callers, at the
#     same time, two different answers.
curl -s -b /tmp/btt-preview.jar http://localhost:3000/en/incidents/incident-01 \
  | grep -c 'Deployed on a Friday'
curl -s http://localhost:3000/en/incidents/incident-01 | grep -c 'Deployed on a Friday'
# Expected: a non-zero count from BOTH — the published incident is unchanged for
#           everyone. Draft mode changes WHICH revision is read, not who may read.
curl -sD - -o /dev/null -b /tmp/btt-preview.jar \
  http://localhost:3000/en/incidents/rewriting-it-in-rust | grep -i '^cache-control'
# Expected: a Cache-Control containing `no-store` (Next sends
#           `private, no-cache, no-store, max-age=0, must-revalidate` for a
#           dynamically rendered page). NEVER `public`, never `s-maxage`.

# 11. THE asPreview PROOF. A published post, edited but not saved. This is the
#     only way to make the module's signature gotcha memorable.
docker compose run --rm -T wpcli wp eval '
  $e = get_user_by( "login", "editor" );
  wp_set_current_user( $e->ID );
  $p = get_page_by_path( "incident-01", OBJECT, "incident" );
  $rev = wp_create_post_autosave( array(
    "post_ID"      => $p->ID,
    "post_title"   => "Deployed On A Tuesday, Actually",
    "post_content" => $p->post_content,
  ) );
  printf( "post row: %s | latest revision: %s\n",
    get_post( $p->ID )->post_title,
    get_post( is_wp_error( $rev ) ? $p->ID : $rev )->post_title );'
# Expected: post row: Deployed on a Friday (#1) | latest revision: Deployed On A Tuesday, Actually
#           TWO rows, two titles. The draft is NOT on the post.

curl -s -X POST http://localhost:8080/graphql -H 'Content-Type: application/json' \
  -d '{"query":"query($s:ID!){ incident(id:$s, idType:SLUG){ title } }","variables":{"s":"incident-01"}}' \
  | jq -r '.data.incident.title'
# Expected: Deployed on a Friday (#1)
#           WITHOUT asPreview the query SUCCEEDS and returns the PUBLISHED title.
#           No error, no warning, nothing to search for. That is the whole bug.

# Now the same URL, WITH asPreview and the editor's JWT. Mint a fresh preview
# link for the PUBLISHED incident and redeem it into a clean cookie jar.
PUB=$(docker compose run --rm -T wpcli wp eval '
  wp_set_current_user( get_user_by( "login", "editor" )->ID );
  echo get_preview_post_link( get_page_by_path( "incident-01", OBJECT, "incident" )->ID );' | tr -d '\r')
curl -s -c /tmp/btt-pub.jar -b /tmp/btt-pub.jar -L -o /tmp/btt-pub.html \
  "${PUB/host.docker.internal/localhost}"
grep -c 'Deployed On A Tuesday, Actually' /tmp/btt-pub.html
# Expected: a non-zero count — the REVISION rendered.
grep -c 'Deployed on a Friday' /tmp/btt-pub.html
# Expected: 0 — the published title is NOT on the preview page.
#           One URL, two answers, and the only difference is a cookie. Delete
#           `asPreview: true` from the route's preview branch and this check
#           silently flips to the published title with no error anywhere. That is
#           the bug this lesson exists to make unforgettable.

# 12. The banner changed NOTHING about the build's route table
cd ../next-app
diff <(sed -n '/Route (app)/,$p' /tmp/btt-build-before-banner.txt | grep -o '[ƒ○●◐] /[^ ]*' | sort) \
     <(sed -n '/Route (app)/,$p' /tmp/btt-build-after-banner.txt  | grep -o '[ƒ○●◐] /[^ ]*' | sort) \
  && echo 'route table identical'
# Expected: route table identical
#           Reading draftMode() in the root layout did not change any route's
#           rendering marker. Key Concept 3.
#
#           NOTE HONESTLY what this does and does not prove. Every route below
#           [locale]/layout.tsx is ALREADY dynamic in Module 17, because Lesson
#           15.4 Step 6 reads cookies() there for the session. So this proves the
#           banner is free; it cannot prove the routes are static, because they
#           are not — yet. Lesson 18.1 removes the session read, and the absolute
#           measurement arrives with it. A lesson that claimed otherwise here
#           would be bluffing.
#
#           And a second, sharper limit, measured on Next 15.5.25: this diff is
#           not an assertion even after Lesson 18.1. A layout that reads
#           cookies() prerenders ZERO pages and still prints an identical symbol
#           table — `●` means "has generateStaticParams", not "HTML exists". The
#           measurement that can actually fail is Lesson 18.1 check 5, which
#           counts prerendered HTML files on disk. This one is a smoke test.

# 13. NEGATIVE — Next's draft-mode cookies are never in a caching rule
grep -c '__prerender_bypass\|__next_preview_data' next.config.ts
# Expected: 0. A response that varies by cookie cannot be shared, so those names
#           must never appear in a headers() rule or a CDN key. Module 18.4 states
#           the rule; this is the check that it was never broken here.
grep -rc 'localStorage\|sessionStorage' src/ | grep -v ':0$' | wc -l | tr -d ' '
# Expected: 0 — no file has a hit. The preview JWT is httpOnly, like every other
#           credential in this application.

# 14. The way out works, and is idempotent
curl -s -b /tmp/btt-preview.jar -c /tmp/btt-preview.jar -o /dev/null \
  -w '%{http_code} %{redirect_url}\n' 'http://localhost:3000/api/preview/exit?locale=en'
# Expected: 307 http://localhost:3000/en
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  'http://localhost:3000/api/preview/exit?locale=en'
# Expected: 307 http://localhost:3000/en  — the same answer with no cookie at all
curl -s -b /tmp/btt-preview.jar -o /dev/null -w '%{http_code}\n' \
  http://localhost:3000/en/incidents/rewriting-it-in-rust
# Expected: 404. Draft mode is off, so the draft is invisible again — to the same
#           browser that could see it ninety seconds ago.

# 15. NEGATIVE — the open-redirect defence, both shapes, no token needed
for BAD in 'https://evil.test' '//evil.test' '/\evil.test'; do
  curl -s -o /dev/null -w "%{http_code} $BAD\n" \
    --get --data-urlencode "next=$BAD" --data-urlencode 'token=x.y' \
    http://localhost:3000/api/preview
done
# Expected: 400 for all three. The destination is validated BEFORE the signature,
#           so none of these consumed a token either.

# 16. The suites, and the whole plugin, are still fine
npm run verify && npm test -- --run && npx playwright test --project=smoke
# Expected: all green. The smoke spec is anonymous, so preview is invisible to it.
cd ../wordpress-headless
docker compose run --rm wpcli wp eval 'echo count( get_option( "active_plugins" ) ) . " active" . PHP_EOL;'
docker compose exec -T wordpress test ! -f /var/www/html/wp-content/debug.log \
  && echo 'no debug.log' \
  || docker compose exec -T wordpress tail -20 /var/www/html/wp-content/debug.log
# Expected: no debug.log, or a tail with no `Uncaught` and no `Fatal error`.
#           An uncaught UserError from the permission_callback would land here.

# 17. Clean up the draft you created, so the fixture stays deterministic
docker compose run --rm -T wpcli wp post delete "$DRAFT_ID" --force
# Expected: Success: Deleted post <id>.
#           --force, because a trashed post keeps its slug reserved and the next
#           run of this block would produce rewriting-it-in-rust-2 (Lesson 12.4).
```

If check 7 shows the counter moving, your local pre-check is not running before the exchange — fix
that first, because it is the difference between a rejected request and a free amplification
primitive. If check 11's first command prints the same title twice, `wp_create_post_autosave()`
returned a `WP_Error`: set the current user first, since an autosave belongs to a user.

## Control Questions

1. The preview token has no timestamp in its signature and Module 18's revalidation webhook has
   one. Both defend against replay. Explain what makes the timestamp unnecessary here and necessary
   there, in terms of what each endpoint has available to it.
2. Next verifies the token's HMAC locally and WordPress does not verify it at all. Say what the
   local check buys, what it does not buy, and why WordPress re-checking the signature would add
   nothing given how the transient is keyed.
3. `require_app_token()` worked perfectly for three GraphQL mutations and was a 500 waiting to
   happen in a REST route. State the general rule in one sentence, then name the four different
   correct failures one decision might need in this codebase.
4. Reading `cookies()` in `src/app/[locale]/layout.tsx` makes every route dynamic; reading
   `draftMode()` in the same file does not. Explain the difference, then say what specifically you
   ran in this lesson to check it and what that check could **not** tell you.
5. An editor previews a published incident, forgets, and comes back forty minutes later to the
   same URL. Describe exactly what they see, which of the three cookies is responsible, and which
   of the two remedies in this lesson is the right one.

## Learn More

- [Next.js: Draft Mode](https://nextjs.org/docs/app/guides/draft-mode) — the official guide to
  `draftMode()`, `enable()`, `disable()` and the two cookies; read the caching notes, because they
  are the argument in Key Concept 3
- [Next.js: `draftMode` API reference](https://nextjs.org/docs/app/api-reference/functions/draft-mode)
  — short, and the place that confirms it is asynchronous in Next 15 along with `cookies()`
- [WPGraphQL: previewing content](https://www.wpgraphql.com/docs/wpgraphql-vs-wp-rest-api) — the
  `asPreview` argument and the revision resolution behind it, which is the whole of Key Concept 4
- [`preview_post_link` filter reference](https://developer.wordpress.org/reference/hooks/preview_post_link/)
  — the hook you filtered, with the note that `get_preview_post_link()` is what applies it
- [`_set_preview()` in Trac](https://core.trac.wordpress.org/browser/trunk/src/wp-includes/revision.php)
  — read it next to `wp_get_post_autosave()`; twenty lines that explain why the draft of a published
  post is a separate row
- [`set_transient()` reference](https://developer.wordpress.org/reference/functions/set_transient/)
  — expiry semantics, the object-cache caveat, and why "expired" and "deleted" reach your code as
  the same `false`
- [`register_rest_route()` and `permission_callback`](https://developer.wordpress.org/rest-api/extending-the-rest-api/adding-custom-endpoints/)
  — the contract that makes `WP_Error` the right failure and a `throw` the wrong one
- [Node `crypto.timingSafeEqual`](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b) —
  the length-mismatch throw is documented in the second paragraph, and it is the sharp edge in
  Key Concept 6
- [OWASP: unvalidated redirects and forwards](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html)
  — why `//evil.test` is an absolute URL, and why an allowlist beats a denylist for `?next=`
- [MDN: `Referer` header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referer)
  — the default referrer policies, and therefore exactly which third parties would see a token you
  put in a URL
